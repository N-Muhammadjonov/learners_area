import {Buffer} from 'node:buffer';
import {gzipSync,gunzipSync} from 'node:zlib';
import {z} from 'zod';
import {normalizeSearch,entryTerms,stableJson,type Entry} from './model';
import {bytesHash,releasePattern} from './shards';

export const INDEX_VERSION='prefix-sorted-postings-v3';
export const INDEX_MAX_RAW=2*1024*1024;
export const INDEX_MAX_COMPRESSED=512*1024;
const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const indexDescriptorSchema=z.object({name:z.string().regex(/^(directory|part-[a-f0-9]{24})$/),sha256:hash,raw_sha256:hash,compressed_bytes:z.number().int().positive().max(INDEX_MAX_COMPRESSED),raw_bytes:z.number().int().positive().max(INDEX_MAX_RAW)}).strict();
export type IndexDescriptor=z.infer<typeof indexDescriptorSchema>;
const previewSchema=z.tuple([z.string().max(120),z.number().int().nonnegative(),z.string().max(30),z.string().max(6000),z.array(z.tuple([z.string().max(6000),z.string().max(6000)])).max(1500)]);
export type SearchPreview=z.infer<typeof previewSchema>;
export const hitSchema=z.object({lexeme_id:id,display_lemma:z.string(),part_of_speech:z.string(),translation_uz:z.string(),match_type:z.enum(['exact_lemma','canonical_normalized','form','prefix'])}).strict();
export type SearchHit=z.infer<typeof hitSchema>;
const termSchema=z.tuple([z.string().max(81),z.array(z.tuple([id,z.number().int().min(0).max(2)])).max(60)]);
export const indexPageSchema=z.object({version:z.literal(INDEX_VERSION),release_id:z.string().regex(releasePattern),direction:z.enum(['EN','UZ']),prefix:z.string().max(80),terms:z.array(termSchema).max(30000),previews:z.record(previewSchema)}).strict();
export type IndexPage=z.infer<typeof indexPageSchema>;
export const indexBundleSchema=z.object({version:z.literal(INDEX_VERSION),release_id:z.string().regex(releasePattern),pages:z.record(indexPageSchema)}).strict();
export const branchPageSchema=z.object({version:z.literal(INDEX_VERSION),release_id:z.string().regex(releasePattern),branches:z.record(z.array(hitSchema).max(20))}).strict();
export const directorySchema=z.object({version:z.literal(INDEX_VERSION),release_id:z.string().regex(releasePattern),normalization:z.string(),objects:z.array(indexDescriptorSchema).max(10000),leaves:z.record(z.number().int().nonnegative()),branches:z.record(z.number().int().nonnegative()),term_count:z.number().int().nonnegative()}).strict().superRefine((d,ctx)=>{if([...Object.values(d.leaves),...Object.values(d.branches)].some(i=>i>=d.objects.length))ctx.addIssue({code:z.ZodIssueCode.custom,message:'invalid_index_reference'});});
export type SearchDirectory=z.infer<typeof directorySchema>;
export type DirectoryDraft=Omit<SearchDirectory,'objects'|'leaves'|'branches'>&{leaves:Record<string,IndexDescriptor>;branches:Record<string,IndexDescriptor>};
export function compactDirectory(d:DirectoryDraft):SearchDirectory{const objects=[...new Map([...Object.values(d.leaves),...Object.values(d.branches)].map(value=>[value.name,value])).values()],index=new Map(objects.map((value,i)=>[value.name,i]));return {...d,objects,leaves:Object.fromEntries(Object.entries(d.leaves).map(([key,value])=>[key,index.get(value.name)!])),branches:Object.fromEntries(Object.entries(d.branches).map(([key,value])=>[key,index.get(value.name)!]))};}
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
// Encode the verified production ICU en-US ordering once; Workers compare integers,
// so runtime ICU/version changes cannot silently reorder an immutable release.
const collation=new Intl.Collator('en-US');
export const compareDictionaryText=(a:string,b:string)=>collation.compare(a,b)||compare(a,b);
const routeKey=(direction:'EN'|'UZ',prefix:string)=>direction+':'+prefix;
export function indexKey(release:string,name:string){if(!releasePattern.test(release)||!indexDescriptorSchema.shape.name.safeParse(name).success)throw Error('invalid_dictionary_index_key');return `dictionary/releases/${release}/search/${name}.json.gz`;}
export function encodeIndex(name:string,value:unknown){const raw=Buffer.from(stableJson(value)),body=gzipSync(raw,{level:9});const descriptor=indexDescriptorSchema.parse({name,sha256:bytesHash(body),raw_sha256:bytesHash(raw),compressed_bytes:body.length,raw_bytes:raw.length});return {body,descriptor};}
export function decodeIndex(descriptor:IndexDescriptor,body:Uint8Array){indexDescriptorSchema.parse(descriptor);if(body.byteLength!==descriptor.compressed_bytes||bytesHash(body)!==descriptor.sha256)throw Error('dictionary_index_checksum_mismatch');const raw=gunzipSync(body,{maxOutputLength:INDEX_MAX_RAW});if(raw.length!==descriptor.raw_bytes||bytesHash(raw)!==descriptor.raw_sha256)throw Error('dictionary_index_checksum_mismatch');return JSON.parse(raw.toString('utf8')) as unknown;}
function matchPreview(id:string,score:number,query:string,direction:'EN'|'UZ',p:SearchPreview):SearchHit{return {lexeme_id:id,display_lemma:p[0],part_of_speech:p[2],translation_uz:direction==='UZ'?((p[4].find(([norm])=>norm===query)??p[4].find(([norm])=>norm.startsWith(query)))?.[1]??p[3]):p[3],match_type:score===0?'exact_lemma':score===1?'canonical_normalized':score===2?'form':'prefix'};}
function lowerBound(terms:IndexPage['terms'],q:string){let lo=0,hi=terms.length;while(lo<hi){const mid=(lo+hi)>>>1;if(terms[mid]![0]<q)lo=mid+1;else hi=mid;}return lo;}
export function searchPage(page:IndexPage,query:string):SearchHit[]{
 const scores=new Map<string,number>();
 for(let at=lowerBound(page.terms,query);at<page.terms.length;at++){const [term,postings]=page.terms[at]!;if(!term.startsWith(query))break;for(const [id,rank] of postings){const score=term===query?rank:3;scores.set(id,Math.min(scores.get(id)??4,score));}}
 return [...scores].sort(([a,sa],[b,sb])=>sa-sb||page.previews[a]![1]-page.previews[b]![1]||compare(a,b)).slice(0,20).map(([id,score])=>matchPreview(id,score,query,page.direction,page.previews[id]!));
}
/** No scans of other partitions: a branch has precomputed exact top-20 results;
 * any longer query is routed directly to its one leaf partition. */
export function routeSearch(directory:SearchDirectory,query:string,direction:'EN'|'UZ'):{results:SearchHit[]}|{descriptor:IndexDescriptor;prefix:string;kind:'leaf'|'branch'}{
 const q=normalizeSearch(query);if(!q||q.length>80)return {results:[]};
 const branch=directory.branches[routeKey(direction,q)];if(branch!==undefined)return {descriptor:directory.objects[branch]!,prefix:q,kind:'branch'};
 for(let length=0;length<=q.length;length++){const prefix=q.slice(0,length),descriptor=directory.leaves[routeKey(direction,prefix)];if(descriptor!==undefined)return {descriptor:directory.objects[descriptor]!,prefix,kind:'leaf'};}
 return {results:[]};
}

/** Offline only. Per-term top-20 per score is sufficient for all possible
 * prefix/exact top-20 queries, so high-frequency function words stay bounded. */
export function buildSearchIndex(entries:Entry[],release:string,targetBytes=128*1024){
 if(!entries.length||!releasePattern.test(release)||targetBytes<16384||targetBytes>INDEX_MAX_RAW/2)throw Error('invalid_index_build');
 const order=new Map(entries.toSorted((a,b)=>compareDictionaryText(normalizeSearch(a.display_lemma),normalizeSearch(b.display_lemma))||compare(a.lexeme_id,b.lexeme_id)).map((e,i)=>[e.lexeme_id,i]));
 const previews:Record<string,SearchPreview>={},maps={EN:new Map<string,Map<string,number>>(),UZ:new Map<string,Map<string,number>>()};
 for(const e of entries){if(e.release_id!==release)throw Error('dictionary_index_release_mismatch');
  const uz=[...new Map(e.senses.flatMap(s=>s.translations.map(t=>[normalizeSearch(t.text),t.text] as const))).entries()].sort(([a],[b])=>compareDictionaryText(a,b));
  previews[e.lexeme_id]=[e.display_lemma,order.get(e.lexeme_id)!,e.part_of_speech,e.senses[0]!.translations.map(t=>t.text).join(', '),uz];
  for(const t of entryTerms(e)){const term=t.term.slice(0,81),postings=maps[t.direction].get(term)??new Map<string,number>();postings.set(e.lexeme_id,Math.min(postings.get(e.lexeme_id)??3,t.rank));maps[t.direction].set(term,postings);}
 }
 const objects=new Map<string,Buffer>(),leafPages=new Map<string,IndexPage>(),branchResults:Record<string,SearchHit[]>={},directory:DirectoryDraft={version:INDEX_VERSION,release_id:release,normalization:'unicode-nfkc-casefold-apostrophe-hyphen-whitespace-v1',leaves:{},branches:{},term_count:maps.EN.size+maps.UZ.size};
 const pack=(direction:'EN'|'UZ',prefix:string,terms:IndexPage['terms']):IndexPage=>{const selected:Record<string,SearchPreview>={};for(const [,postings] of terms)for(const [id] of postings)selected[id]=previews[id]!;return {version:INDEX_VERSION,release_id:release,direction,prefix,terms,previews:selected};};
 function partition(direction:'EN'|'UZ',prefix:string,terms:IndexPage['terms']){
  const page=pack(direction,prefix,terms),size=Buffer.byteLength(stableJson(page));
  if(size<=targetBytes){leafPages.set(routeKey(direction,prefix),page);return;}
  if(prefix.length>80)throw Error('dictionary_index_partition_limit');
  // These are immutable short/common-prefix answers, not an incomplete filter
  // of a longer prefix's results. Exact/form ranking uses the original term.
  branchResults[routeKey(direction,prefix)]=searchPage(page,prefix);
  const children=new Map<string,IndexPage['terms']>();
  for(const row of terms){if(row[0].length<=prefix.length)continue;const key=row[0].slice(0,prefix.length+1),group=children.get(key)??[];group.push(row);children.set(key,group);}
  for(const [key,group] of children)partition(direction,key,group);
 }
 for(const direction of ['EN','UZ'] as const){const terms:IndexPage['terms']=[...maps[direction]].sort(([a],[b])=>compare(a,b)).map(([term,all])=>{const selected=new Map<string,number>();for(const rank of [0,1,2])for(const [id,r] of [...all].filter(([,r])=>r===rank).sort(([a],[b])=>previews[a]![1]-previews[b]![1]||compare(a,b)).slice(0,20))selected.set(id,r);return [term,[...selected].sort(([a],[b])=>compare(a,b))];});partition(direction,'',terms);}
 let pages:Record<string,IndexPage>={},pageBytes=0;
 const flushPages=()=>{if(!Object.keys(pages).length)return;const name='part-'+bytesHash(Buffer.from('leaves:'+Object.keys(pages).join('\n'))).slice(0,24),encoded=encodeIndex(name,{version:INDEX_VERSION,release_id:release,pages});objects.set(name,encoded.body);for(const key of Object.keys(pages))directory.leaves[key]=encoded.descriptor;pages={};pageBytes=0;};
 for(const [key,page] of [...leafPages].sort(([a],[b])=>compare(a,b))){const bytes=Buffer.byteLength(stableJson(page))+Buffer.byteLength(key)+8;if(pageBytes+bytes>targetBytes)flushPages();pages[key]=page;pageBytes+=bytes;}flushPages();
 let chunk:Record<string,SearchHit[]>={},size=0;
 const flush=()=>{if(!Object.keys(chunk).length)return;const name='part-'+bytesHash(Buffer.from('branches:'+Object.keys(chunk).join('\n'))).slice(0,24),encoded=encodeIndex(name,{version:INDEX_VERSION,release_id:release,branches:chunk});objects.set(name,encoded.body);for(const key of Object.keys(chunk))directory.branches[key]=encoded.descriptor;chunk={};size=0;};
 for(const [key,hits] of Object.entries(branchResults).sort(([a],[b])=>compare(a,b))){const bytes=Buffer.byteLength(stableJson(hits))+Buffer.byteLength(key)+8;if(size+bytes>targetBytes)flush();chunk[key]=hits;size+=bytes;}flush();
 const compact=compactDirectory(directory),root=encodeIndex('directory',compact);objects.set('directory',root.body);const routing=encodeRoutingDirectories(compact),routes:Record<string,IndexDescriptor>={};for(const item of routing.objects){objects.set(item.descriptor.name,item.body);routes[item.initial]=item.descriptor;}for(const initial of routing.fallbacks)routes[initial]=root.descriptor;
 return {directory:compact,routes,descriptor:root.descriptor,objects,compressedBytes:[...objects.values()].reduce((n,b)=>n+b.length,0)};
}

/** Small per-initial routing objects keep cold searches from parsing the global
 * release directory. Only immutable object descriptors, never hits or previews,
 * are sent by the authenticated gateway. */
export function encodeRoutingDirectories(directory:SearchDirectory){
 const groups=new Map<string,DirectoryDraft>(),fallbacks=new Set<string>();
 for(const kind of ['leaves','branches'] as const)for(const [key,at] of Object.entries(directory[kind])){
  if(key.length===3){if(kind==='leaves')fallbacks.add(key.slice(0,2)+':*');continue;}
  const initial=key.slice(0,4),draft=groups.get(initial)??{version:INDEX_VERSION,release_id:directory.release_id,normalization:directory.normalization,leaves:{},branches:{},term_count:0};draft[kind][key]=directory.objects[at]!;groups.set(initial,draft);
 }
 return {fallbacks,objects:[...groups].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([initial,draft])=>{const name='part-'+bytesHash(Buffer.from('routing:'+initial)).slice(0,24);return {initial,...encodeIndex(name,compactDirectory(draft))};})};
}
