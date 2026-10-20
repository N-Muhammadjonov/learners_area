import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDraft,entryTerms,normalizeSearch,type Entry} from '../src/lib/dictionary/model';
import {buildSearchIndex,decodeIndex,directorySchema,branchPageSchema,indexBundleSchema,indexPageSchema,routeSearch,searchPage,type SearchHit,compareDictionaryText} from '../src/lib/dictionary/search-index';
const release='rel-v1-555555555555555555555555';
const entries:Entry[]=Array.from({length:180},(_,i)=>applyDraft([],{operation:'add_lexeme',lemma:'bank '+String(i).padStart(3,'0'),partOfSpeech:i%2?'v':'n',lexicalType:'phrase',definitionEn:'A distinct fixture meaning '+i,translationUz:'shishmoq',definitionUz:'Hajmi ortmoq',examples:[]},release));
for(const [lemma,uz] of [['bank','bank'],['run','yugurmoq'],['find out','bilib olmoq'],['read',"o'qimoq"]])entries.push(applyDraft([],{operation:'add_lexeme',lemma:lemma!,partOfSpeech:'v',lexicalType:'phrase',definitionEn:'Fixture meaning of '+lemma,translationUz:uz!,definitionUz:uz!+' ma’nosi',examples:[]},release));
entries.find(e=>e.display_lemma==='run')!.forms.push({surface_form:'ran'});
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
function exhaustive(q:string,direction:'EN'|'UZ'):SearchHit[]{q=normalizeSearch(q);if(!q||q.length>80)return [];return entries.flatMap(e=>{const terms=entryTerms(e).filter(t=>t.direction===direction&&t.term.startsWith(q));if(!terms.length)return [];const score=Math.min(...terms.map(t=>t.term===q?t.rank:3));const uz=e.senses.flatMap(s=>s.translations).map(t=>[normalizeSearch(t.text),t.text]).filter(([n])=>n!.startsWith(q)).sort(([a],[b])=>cmp(a!,b!));return [{e,score,translation:direction==='UZ'?(uz[0]?.[1]??e.senses[0]!.translations.map(t=>t.text).join(', ')):e.senses[0]!.translations.map(t=>t.text).join(', ')}];}).sort((a,b)=>a.score-b.score||compareDictionaryText(normalizeSearch(a.e.display_lemma),normalizeSearch(b.e.display_lemma))||cmp(a.e.lexeme_id,b.e.lexeme_id)).slice(0,20).map(({e,score,translation})=>({lexeme_id:e.lexeme_id,display_lemma:e.display_lemma,part_of_speech:e.part_of_speech,translation_uz:translation!,match_type:score===0?'exact_lemma':score===1?'canonical_normalized':score===2?'form':'prefix'}));}
test('adaptive index preserves exhaustive top-20 ranking, forms, phrases and matching UZ previews',()=>{
 const built=buildSearchIndex(entries,release,16384),directory=directorySchema.parse(decodeIndex(built.descriptor,built.objects.get('directory')!));
 for(const [q,direction] of [['bank','EN'],['b','EN'],['ba','EN'],['bank 001','EN'],['bank 00','EN'],['banK','EN'],['ran','EN'],['find out','EN'],['shishmoq','UZ'],['shish','UZ'],["o'qimoq",'UZ'],['oʻqimoq','UZ'],['o‘qimoq','UZ'],['missing','EN'],['','EN']] as const){const norm=normalizeSearch(q),route=routeSearch(directory,norm,direction);let result;if('results'in route)result=route.results;else if(route.kind==='branch')result=branchPageSchema.parse(decodeIndex(route.descriptor,built.objects.get(route.descriptor.name)!)).branches[direction+':'+norm];else{const page=indexBundleSchema.parse(decodeIndex(route.descriptor,built.objects.get(route.descriptor.name)!)).pages[direction+':'+route.prefix]!;assert.equal(page.prefix,route.prefix);result=searchPage(page,norm);}assert.deepEqual(result,exhaustive(q,direction),q);}
 assert.ok(Object.keys(directory.branches).length>0);assert.ok(Object.keys(directory.leaves).length>1);
});
test('index encoding is deterministic, rejects altered bytes and binds routing to immutable descriptors',()=>{
 const a=buildSearchIndex(entries,release,16384),b=buildSearchIndex(entries.toReversed(),release,16384);assert.deepEqual(a.descriptor,b.descriptor);assert.deepEqual(a.directory,b.directory);
 const body=Buffer.from(a.objects.get('directory')!);body[20]=body[20]!^1;assert.throws(()=>decodeIndex(a.descriptor,body),/checksum/);
 assert.throws(()=>buildSearchIndex(entries,'rel-v1-000000000000000000000000',16384),/release_mismatch/);
});
