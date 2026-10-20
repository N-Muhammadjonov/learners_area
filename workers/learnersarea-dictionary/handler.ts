import {Buffer} from 'node:buffer';
import {z} from 'zod';
import {verifyDictionaryProof} from '../../src/lib/dictionary/worker-protocol';
import {normalizeSearch} from '../../src/lib/dictionary/model';
import {indexDescriptorSchema,directorySchema,indexPageSchema,indexBundleSchema,branchPageSchema,indexKey,decodeIndex,routeSearch,searchPage,type IndexDescriptor} from '../../src/lib/dictionary/search-index';
import {bytesHash,decodeShard,shardKey,releasePattern,shardDescriptorSchema,entryRangeSchema,decodeEntryRange,type EntryRange,type ShardDescriptor} from '../../src/lib/dictionary/shards';

type BucketObject={size:number;range?:{offset?:number;length?:number};body:ReadableStream<Uint8Array>};
type EdgeCache={match(request:Request):Promise<Response|undefined>;put(request:Request,response:Response):Promise<void>};
export type DictionaryEnvironment={DICTIONARY_SIGNING_SECRET:string;DICTIONARY_BUCKET:{get(key:string,options?:{range:{offset:number;length:number}}):Promise<BucketObject|null>}};
const requestSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('search'),release:z.string().regex(releasePattern),directory:indexDescriptorSchema,query:z.string().max(80),direction:z.enum(['EN','UZ'])}).strict(),
 z.object({action:z.literal('entry'),release:z.string().regex(releasePattern),lexemeId:z.string().uuid(),shard:shardDescriptorSchema,range:entryRangeSchema.optional(),contentSha:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict(),
]);
type IndexValue={value:unknown;bytes:number;expires:number};
class Runtime {
 private values=new Map<string,IndexValue>();private pending=new Map<string,Promise<unknown>>();private bytes=0;private loadingBytes=0;
 constructor(private bucket:DictionaryEnvironment['DICTIONARY_BUCKET'],private edge?:EdgeCache){}
 private async stream(body:ReadableStream<Uint8Array>,max:number){const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0;try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>max)throw Error('dictionary_object_limit');chunks.push(next.value);}return Buffer.concat(chunks);}finally{await reader.cancel().catch(()=>{});}}
 private deadline(work:Promise<unknown>){return Promise.race([work,new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('dictionary_storage_timeout')),8000);void work.finally(()=>clearTimeout(timer)).catch(()=>{});})]);}
 private async load(key:string,d:{sha256:string;compressed_bytes:number;raw_bytes:number},decode:(body:Buffer)=>unknown,retrieve?:()=>Promise<BucketObject|null>){
  const cacheId=key+':'+d.sha256,found=this.values.get(cacheId);if(found){this.values.delete(cacheId);if(found.expires>Date.now()){this.values.set(cacheId,found);return found.value;}this.bytes-=found.bytes;}
  const existing=this.pending.get(cacheId);if(existing)return this.deadline(existing);const loadingBytes=d.raw_bytes*8+d.compressed_bytes*2;if(this.pending.size>=4||this.loadingBytes+loadingBytes>48*1024*1024)throw Error('dictionary_retrieval_busy');this.loadingBytes+=loadingBytes;
  const work=(async()=>{
   const cacheUrl=new URL('https://dictionary-private-cache.invalid/'+key);cacheUrl.searchParams.set('sha',d.sha256);const cacheKey=new Request(cacheUrl);
   const cached=await this.edge?.match(cacheKey);let body:Buffer;
   if(cached?.body)body=await this.stream(cached.body,d.compressed_bytes);else{const object=await (retrieve?retrieve():this.bucket.get(key));if(!object)throw Error('dictionary_object_missing');if(object.size!==d.compressed_bytes)throw Error('dictionary_object_limit');body=await this.stream(object.body,d.compressed_bytes);}
   if(body.length!==d.compressed_bytes||(!retrieve&&bytesHash(body)!==d.sha256))throw Error('dictionary_object_checksum');const value=decode(body);
   // Only checksum-, schema- and identity-validated immutable objects enter either cache.
   if(!cached&&this.edge)await this.edge.put(cacheKey,new Response(Uint8Array.from(body),{headers:{'Cache-Control':'public, max-age=31536000, immutable'}}));
   const bytes=d.raw_bytes*6;while(this.bytes+bytes>24*1024*1024&&this.values.size){const first=this.values.keys().next().value!;this.bytes-=this.values.get(first)!.bytes;this.values.delete(first);}if(bytes<=24*1024*1024){this.values.set(cacheId,{value,bytes,expires:Date.now()+300000});this.bytes+=bytes;}return value;
  })();this.pending.set(cacheId,work);void work.finally(()=>{this.pending.delete(cacheId);this.loadingBytes-=loadingBytes;}).catch(()=>{});return this.deadline(work);
 }
 async index(release:string,d:IndexDescriptor){return this.load(indexKey(release,d.name),d,body=>{const raw=decodeIndex(d,body),value=d.name==='directory'?directorySchema.parse(raw):z.union([directorySchema,indexBundleSchema,branchPageSchema]).parse(raw);if(value.release_id!==release)throw Error('dictionary_index_release_mismatch');return value;});}
 async entry(release:string,id:string,d:ShardDescriptor,range?:EntryRange,contentSha?:string){
  if(range){if(d.format!=='entry-jsonl-gzip-v1'||!contentSha||range.offset+range.length>d.compressed_bytes)throw Error('dictionary_entry_range_mismatch');const key=shardKey(release,d.shard);
   return this.load(key+'?entry='+id,{sha256:contentSha,compressed_bytes:range.length,raw_bytes:range.raw_bytes},body=>decodeEntryRange(release,id,range,body,contentSha),async()=>{const object=await this.bucket.get(key,{range:{offset:range.offset,length:range.length}});if(!object)return null;if(object.size!==d.compressed_bytes||object.range?.offset!==range.offset||object.range?.length!==range.length)throw Error('dictionary_entry_range_mismatch');return {size:range.length,body:object.body};});
  }
  return (await this.load(shardKey(release,d.shard),d,body=>decodeShard(release,d,body)) as ReturnType<typeof decodeShard>).get(id);
 }
}
const runtimes=new WeakMap<DictionaryEnvironment['DICTIONARY_BUCKET'],Runtime>();
/** Only the authenticated Next.js gateway can call this Worker. It rechecks
 * account/session authority per request and supplies the authoritative release;
 * there is no second cached active pointer and no additional authority hop. */
export async function serveDictionary(request:Request,env:DictionaryEnvironment,edge?:EdgeCache):Promise<Response>{
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Type':'application/json'};
 const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(request.method!=='POST'||new URL(request.url).pathname!=='/v1/dictionary')return response({error:'not_found'},404);
 const length=Number(request.headers.get('Content-Length'));if(Number.isFinite(length)&&length>16384)return response({error:'invalid_input'},400);
 let raw='';try{const reader=request.body?.getReader();if(!reader)return response({error:'invalid_input'},400);let size=0;const chunks=[];while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();return response({error:'invalid_input'},400);}chunks.push(part.value);}raw=Buffer.concat(chunks).toString('utf8');}catch{return response({error:'invalid_input'},400);}
 if(!await verifyDictionaryProof(env.DICTIONARY_SIGNING_SECRET,raw,request.headers.get('X-LA-Dictionary-Proof')??''))return response({error:'forbidden'},403);
 let input;try{input=requestSchema.parse(JSON.parse(raw));}catch{return response({error:'invalid_input'},400);}
 let runtime=runtimes.get(env.DICTIONARY_BUCKET);if(!runtime){runtime=new Runtime(env.DICTIONARY_BUCKET,edge);runtimes.set(env.DICTIONARY_BUCKET,runtime);}
 const start=performance.now();
 try{
  let body:unknown;
  if(input.action==='search'){
   const directory=await runtime.index(input.release,input.directory) as import('../../src/lib/dictionary/search-index').SearchDirectory;if(directory.release_id!==input.release)throw Error('dictionary_index_release_mismatch');
   const q=normalizeSearch(input.query),route=routeSearch(directory,q,input.direction);let results;
   if('results'in route)results=route.results;else if(route.kind==='branch'){const page=await runtime.index(input.release,route.descriptor) as z.infer<typeof branchPageSchema>;results=page.branches[input.direction+':'+q];if(!results)throw Error('dictionary_index_route_mismatch');}else{const bundle=await runtime.index(input.release,route.descriptor) as z.infer<typeof indexBundleSchema>,page=bundle.pages[input.direction+':'+route.prefix];if(!page)throw Error('dictionary_index_route_mismatch');if(page.release_id!==input.release||page.direction!==input.direction||page.prefix!==route.prefix)throw Error('dictionary_index_route_mismatch');results=searchPage(page,q);}
   body={release_id:input.release,results};
  }else{
   if(input.lexemeId.slice(0,2)!==input.shard.shard)return response({error:'invalid_input'},400);
   const entry=await runtime.entry(input.release,input.lexemeId,input.shard,input.range,input.contentSha);if(!entry)return response({error:'entry_not_found'},404);body={entry};
  }
  const result=response(body);result.headers.set('Server-Timing',`dictionary;dur=${(performance.now()-start).toFixed(2)}`);return result;
 }catch(error){console.error('dictionary_storage_failure',error instanceof z.ZodError?error.issues.map(i=>i.path.join('.')+':'+i.code).join(',').slice(0,300):error instanceof Error?error.message.slice(0,120):'unknown');return response({error:'dictionary_storage_unavailable'},503);}
}
