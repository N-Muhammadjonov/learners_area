import 'server-only';
import {entrySchema,type Entry} from './model';
import {dictionaryProof} from './worker-protocol';
import {hitSchema,indexDescriptorSchema,type IndexDescriptor} from './search-index';
import {shardDescriptorSchema,type ShardDescriptor,type EntryRange} from './shards';
import {z} from 'zod';
export const workerIndexManifestSchema=z.object({version:z.literal('prefix-sorted-postings-v3'),directory:indexDescriptorSchema,routes:z.record(indexDescriptorSchema).optional(),objects:z.array(indexDescriptorSchema).min(1).max(10000),logicalTerms:z.number().int().positive()}).strict();
export type WorkerIndexManifest=z.infer<typeof workerIndexManifestSchema>;
export async function dictionaryWorker(input:{action:'search';release:string;directory:IndexDescriptor;query:string;direction:'EN'|'UZ'}|{action:'entry';release:string;lexemeId:string;shard:ShardDescriptor;range?:EntryRange;contentSha?:string}){
 const endpoint=process.env.DICTIONARY_WORKER_URL,secret=process.env.DICTIONARY_SIGNING_SECRET;if(!endpoint||!secret)throw Error('dictionary_worker_unavailable');
 const url=new URL(endpoint);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(process.env.NODE_ENV!=='production'&&url.hostname==='127.0.0.1')))throw Error('dictionary_worker_unavailable');
 if(input.action==='entry')shardDescriptorSchema.parse(input.shard);else indexDescriptorSchema.parse(input.directory);
 const body=JSON.stringify(input),proof=await dictionaryProof(secret,body,Math.floor(Date.now()/1000));
 const response=await fetch(new URL('/v1/dictionary',url),{method:'POST',body,headers:{'Content-Type':'application/json','X-LA-Dictionary-Proof':proof},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(response.status===404&&input.action==='entry')return null;
 if(!response.ok||!response.body)throw Error('dictionary_worker_unavailable');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2*1024*1024)throw Error('dictionary_object_limit');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(input.action==='search'){const result=z.object({release_id:z.literal(input.release),results:z.array(hitSchema).max(20)}).strict().parse(value);return result.results;}
 const entry=entrySchema.parse(value.entry);if(entry.lexeme_id!==input.lexemeId||entry.release_id!==input.release)throw Error('dictionary_entry_checksum_mismatch');return entry;
}
export async function workerEntry(release:string,lexemeId:string,shard:ShardDescriptor,range?:EntryRange,contentSha?:string):Promise<Entry|null>{return await dictionaryWorker({action:'entry',release,lexemeId,shard,...(range?{range,contentSha}:{})}) as Entry|null;}
