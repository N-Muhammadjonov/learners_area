import 'server-only';
import {appendFile,stat,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {entryTerms,normalizeSearch,stableJson,type Entry} from './model';
import {bytesHash} from './shards';
import {INDEX_VERSION,encodeIndex,searchPage,type IndexPage,type SearchPreview,type DirectoryDraft,compactDirectory,encodeRoutingDirectories,type IndexDescriptor,type SearchHit} from './search-index';
import type {WorkerIndexManifest} from './worker-gateway';
type Row=[string,string,number];
const TARGET=128*1024,MAX_FILE=2*1024*1024,MAX_PREVIEWS=64*1024*1024,MAX_POSTINGS=3_000_000;
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const collation=new Intl.Collator('en-US');
/** Publication/offline only. Full entry payloads and the complete term map are
 * never retained. Compact previews have a hard budget; postings spill to private
 * ephemeral disk and recursively split into bounded prefix files. */
export async function buildIndexBounded(options:{release:string;groups:AsyncIterable<Entry[]>;order:Map<string,number>;workdir:string;emit:(name:string,body:Buffer,descriptor:IndexDescriptor)=>Promise<void>;heartbeat?:()=>Promise<void>}):Promise<WorkerIndexManifest>{
 const {release,groups,order,workdir,emit}=options,previews:Record<string,SearchPreview>={};let previewBytes=0,logicalTerms=0;
 const files=new Map<string,{direction:'EN'|'UZ';prefix:string;file:string}>();
 const fileFor=(direction:'EN'|'UZ',prefix:string)=>join(workdir,bytesHash(Buffer.from(direction+':'+prefix))+'.jsonl');
 for await(const entries of groups){const buffers=new Map<string,string[]>();
  for(const e of entries){if(e.release_id!==release||!order.has(e.lexeme_id))throw Error('dictionary_index_identity_mismatch');
   const uz=[...new Map(e.senses.flatMap(s=>s.translations.map(t=>[normalizeSearch(t.text),t.text] as const))).entries()].sort(([a],[b])=>collation.compare(a,b)||compare(a,b));
   const p:SearchPreview=[e.display_lemma,order.get(e.lexeme_id)!,e.part_of_speech,e.senses[0]!.translations.map(t=>t.text).join(', '),uz];
   previewBytes+=Buffer.byteLength(stableJson(p))*2;if(previewBytes>MAX_PREVIEWS)throw Error('dictionary_index_preview_budget');previews[e.lexeme_id]=p;
   for(const term of entryTerms(e)){if(++logicalTerms>MAX_POSTINGS)throw Error('dictionary_index_posting_budget');const value=term.term.slice(0,81),prefix=value.slice(0,1),key=term.direction+':'+prefix;
    files.set(key,{direction:term.direction,prefix,file:fileFor(term.direction,prefix)});const lines=buffers.get(key)??[];lines.push(JSON.stringify([value,e.lexeme_id,term.rank]));buffers.set(key,lines);
   }
  }
  for(const [key,lines] of buffers)await appendFile(files.get(key)!.file,lines.join('\n')+'\n',{mode:0o600});
  await options.heartbeat?.();
 }
 const directory:DirectoryDraft={version:INDEX_VERSION,release_id:release,normalization:'unicode-nfkc-casefold-apostrophe-hyphen-whitespace-v1',leaves:{},branches:{},term_count:0},descriptors:IndexDescriptor[]=[];
 let pages:Record<string,IndexPage>={},pageBytes=0;const branchResults:Record<string,SearchHit[]>={};
 async function flushPages(){if(!Object.keys(pages).length)return;const name='part-'+bytesHash(Buffer.from('leaves:'+Object.keys(pages).join('\n'))).slice(0,24),e=encodeIndex(name,{version:INDEX_VERSION,release_id:release,pages});await emit(name,e.body,e.descriptor);descriptors.push(e.descriptor);for(const key of Object.keys(pages))directory.leaves[key]=e.descriptor;pages={};pageBytes=0;}
 async function addPage(key:string,page:IndexPage){const bytes=Buffer.byteLength(stableJson(page))+Buffer.byteLength(key)+8;if(pageBytes+bytes>TARGET)await flushPages();pages[key]=page;pageBytes+=bytes;directory.term_count+=page.terms.length;}
 const rankCompare=(a:[string,number],b:[string,number])=>a[1]-b[1]||previews[a[0]]![1]-previews[b[0]]![1]||compare(a[0],b[0]);
 async function* lines(file:string){for await(const text of createInterface({input:createReadStream(file),crlfDelay:Infinity})){if(text.length>400)throw Error('dictionary_index_spool_corrupt');yield JSON.parse(text) as Row;}}
 async function partition(direction:'EN'|'UZ',prefix:string,file:string):Promise<void>{
  await options.heartbeat?.();
  if((await stat(file)).size<=MAX_FILE){const terms=new Map<string,Map<string,number>>();
   for await(const [term,id,rank] of lines(file)){const map=terms.get(term)??new Map<string,number>();map.set(id,Math.min(map.get(id)??3,rank));terms.set(term,map);}
   const selected:Record<string,SearchPreview>={};const packed:IndexPage['terms']=[...terms].sort(([a],[b])=>compare(a,b)).map(([term,all])=>{const kept=new Map<string,number>();for(const rank of [0,1,2])for(const [id,r] of [...all].filter(([,r])=>r===rank).sort((a,b)=>previews[a[0]]![1]-previews[b[0]]![1]||compare(a[0],b[0])).slice(0,20)){kept.set(id,r);selected[id]=previews[id]!;}return [term,[...kept].sort(([a],[b])=>compare(a,b))];});
   const page:IndexPage={version:INDEX_VERSION,release_id:release,direction,prefix,terms:packed,previews:selected};
   if(Buffer.byteLength(stableJson(page))<=TARGET){await addPage(direction+':'+prefix,page);await unlink(file);return;}
  }
  const top=new Map<string,number>(),children=new Map<string,string[]>(),childFiles=new Map<string,string>();let buffered=0;
  async function flush(){for(const [key,rows] of children){await appendFile(childFiles.get(key)!,rows.join('\n')+'\n',{mode:0o600});}children.clear();buffered=0;}
  for await(const [term,id,rank] of lines(file)){
   const score=term===prefix?rank:3;top.set(id,Math.min(top.get(id)??4,score));if(top.size>21){const sorted=[...top].sort(rankCompare);top.clear();for(const [id,r] of sorted.slice(0,20))top.set(id,r);}
   if(prefix.length<80&&term.length>prefix.length){const key=term.slice(0,prefix.length+1),rows=children.get(key)??[],row=JSON.stringify([term,id,rank]);rows.push(row);buffered+=row.length;children.set(key,rows);childFiles.set(key,fileFor(direction,key));if(buffered>256*1024)await flush();}
  }
  await flush();
  const chosen:Record<string,SearchPreview>={};for(const [id] of top)chosen[id]=previews[id]!;
  // searchPage applies identical exact-before-prefix ranking and the matching
  // Uzbek preview rule to this bounded already-ranked branch candidate set.
  const page:IndexPage={version:INDEX_VERSION,release_id:release,direction,prefix,terms:[...top].map(([id,score]):IndexPage['terms'][number]=>[score===3?prefix+'\uffff':prefix,[[id,score===3?0:score]]]).sort(([a],[b])=>compare(a,b)),previews:chosen};
  branchResults[direction+':'+prefix]=searchPage(page,prefix);
  await unlink(file);for(const [key,child] of [...childFiles].sort(([a],[b])=>compare(a,b)))await partition(direction,key,child);
 }
 for(const [,item] of [...files].sort(([a],[b])=>compare(a,b)))await partition(item.direction,item.prefix,item.file);
 await flushPages();let branches:Record<string,SearchHit[]>={},size=0;
 async function flushBranches(){if(!Object.keys(branches).length)return;const name='part-'+bytesHash(Buffer.from('branches:'+Object.keys(branches).join('\n'))).slice(0,24),e=encodeIndex(name,{version:INDEX_VERSION,release_id:release,branches});await emit(name,e.body,e.descriptor);descriptors.push(e.descriptor);for(const key of Object.keys(branches))directory.branches[key]=e.descriptor;branches={};size=0;}
 for(const [key,hits] of Object.entries(branchResults).sort(([a],[b])=>compare(a,b))){const bytes=Buffer.byteLength(stableJson(hits))+Buffer.byteLength(key)+8;if(size+bytes>TARGET)await flushBranches();branches[key]=hits;size+=bytes;}await flushBranches();
 const compact=compactDirectory(directory),root=encodeIndex('directory',compact);await emit('directory',root.body,root.descriptor);const routing=encodeRoutingDirectories(compact),routes:Record<string,IndexDescriptor>={};for(const item of routing.objects){await emit(item.descriptor.name,item.body,item.descriptor);descriptors.push(item.descriptor);routes[item.initial]=item.descriptor;}for(const initial of routing.fallbacks)routes[initial]=root.descriptor;
 return {version:INDEX_VERSION,directory:root.descriptor,routes,objects:[root.descriptor,...descriptors],logicalTerms};
}
