import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyDraft,normalizeSearch} from '../src/lib/dictionary/model';
import {buildIndexBounded} from '../src/lib/dictionary/build-index';
import {buildSearchIndex,decodeIndex,directorySchema,indexBundleSchema,branchPageSchema,searchPage,routeSearch,compareDictionaryText,type SearchHit,type IndexDescriptor} from '../src/lib/dictionary/search-index';
test('disk-spooled publication preserves complete in-memory reference results across hot and leaf partitions',async()=>{
 const release='rel-v1-666666666666666666666666',entries=Array.from({length:3200},(_,i)=>applyDraft([],{operation:'add_lexeme',lemma:'bank '+String(i).padStart(4,'0'),partOfSpeech:'n',lexicalType:'phrase',definitionEn:'Fixture '+i,translationUz:i%3?'o‘qimoq':'shishmoq',definitionUz:'Aynan shu ma’no '+i,examples:[]},release));
 const ordered=entries.toSorted((a,b)=>compareDictionaryText(normalizeSearch(a.display_lemma),normalizeSearch(b.display_lemma))||a.lexeme_id.localeCompare(b.lexeme_id)),order=new Map(ordered.map((e,i)=>[e.lexeme_id,i]));
 const dir=await mkdtemp(join(tmpdir(),'dictionary-bounded-qa-')),objects=new Map<string,Buffer>();
 try{
  const manifest=await buildIndexBounded({release,order,workdir:dir,groups:(async function*(){for(let i=0;i<entries.length;i+=50)yield entries.slice(i,i+50);})(),async emit(name,body){objects.set(name,body);}}),reference=buildSearchIndex(entries,release);
  function lookup(descriptor:IndexDescriptor,read:Map<string,Buffer>,q:string,direction:'EN'|'UZ'):SearchHit[]{const d=directorySchema.parse(decodeIndex(descriptor,read.get('directory')!)),route=routeSearch(d,q,direction);if('results'in route)return route.results;const data=decodeIndex(route.descriptor,read.get(route.descriptor.name)!);return route.kind==='branch'?branchPageSchema.parse(data).branches[direction+':'+normalizeSearch(q)]!:searchPage(indexBundleSchema.parse(data).pages[direction+':'+route.prefix]!,normalizeSearch(q));}
  for(const [q,direction] of [['b','EN'],['bank','EN'],['bank 00','EN'],['bank 0099','EN'],['bank 1399','EN'],['shish','UZ'],['shishmoq','UZ'],["o'qimoq",'UZ'],['not present','EN']] as const)assert.deepEqual(lookup(manifest.directory,objects,q,direction),lookup(reference.descriptor,reference.objects,q,direction),q);
  assert.ok(Object.keys(directorySchema.parse(decodeIndex(manifest.directory,objects.get('directory')!)).branches).length>0);assert.deepEqual(await readdir(dir),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
