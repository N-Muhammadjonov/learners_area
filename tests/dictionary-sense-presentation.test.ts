import test from 'node:test';
import assert from 'node:assert/strict';
import{readFileSync,existsSync}from'node:fs';
import{gunzipSync}from'node:zlib';
import{buildPresentations}from'../scripts/dictionary/build-sense-presentation';
import{applyDraft,entryContentHash,type Entry}from'../src/lib/dictionary/model';
import{dictionaryPresentation}from'../src/lib/dictionary/presentation';
import{exampleUsesEntry}from'../src/lib/dictionary/example-match';
import{decodeShard,bytesHash}from'../src/lib/dictionary/shards';
import type{StoredPresentation}from'../src/lib/dictionary/presentation-types';
const release='rel-v1-111111111111111111111111';
const word=(lemma:string,definition:string)=>applyDraft([],{operation:'add_lexeme',lemma,partOfSpeech:'n',lexicalType:lemma.includes(' ')?'phrase':'word',definitionEn:definition,definitionUz:'Sinov ma’nosi',translationUz:'sinov',examples:[]},release);

test('synonyms and phrase links belong to their exact meaning, with target sense IDs',()=>{
 let bank=word('bank','A financial institution');bank=applyDraft([bank],{operation:'add_sense',lexemeId:bank.lexeme_id,definitionEn:'Land beside a river',definitionUz:'Qirg‘oq',translationUz:'qirg‘oq',examples:[]},release);
 const lender=word('lender','A financial institution'),shore=word('shore','Land beside a river'),account=word('bank account','Money held at a bank');
 account.relations.push({relation_type:'hypernym',target_lexeme_id:bank.lexeme_id,target_sense_id:bank.senses[0]!.sense_id,display_lemma:'bank',part_of_speech:'n',lexical_type:'word'});
 const {result}=buildPresentations([bank,lender,shore,account],{examples:[],collocations:[]}),view=result.get(bank.lexeme_id)!;
 assert.deepEqual(view.senses[bank.senses[0]!.sense_id]!.synonyms.map(x=>x.text),['lender']);assert.deepEqual(view.senses[bank.senses[1]!.sense_id]!.synonyms.map(x=>x.text),['shore']);
 assert.equal(view.senses[bank.senses[0]!.sense_id]!.synonyms[0]!.senseId,lender.senses[0]!.sense_id);
 assert.equal(view.senses[bank.senses[0]!.sense_id]!.collocations[0]!.text,'bank account');assert.equal(view.senses[bank.senses[1]!.sense_id]!.collocations.length,0);
 assert.equal(view.contentSha,entryContentHash(bank));
 const single=word('cloud','Visible water droplets'),idiom=word('cloud nine','A state of great happiness');
 assert.equal(buildPresentations([single,idiom],{examples:[],collocations:[]}).result.get(single.lexeme_id)!.senses[single.senses[0]!.sense_id]!.collocations.length,0,'shared spelling alone cannot attach an idiom');
});

test('unrelated shared examples are suppressed; regular/irregular and split phrasal forms remain valid',()=>{
 const entry={...word('prefigure','Predict'),part_of_speech:'v'};
 assert.equal(exampleUsesEntry(entry,'These signs bode bad news.'),false);assert.equal(exampleUsesEntry(entry,'I had prefigured that outcome.'),true);
 assert.equal(exampleUsesEntry({...entry,display_lemma:'take into account',lexical_type:'phrasal_verb'},'We took the extra costs into account.'),true);
 assert.equal(exampleUsesEntry({...entry,display_lemma:'run'},'She ran home.'),true);assert.equal(exampleUsesEntry({...entry,display_lemma:'bank'},'A banker spoke.'),false);
 entry.senses[0]!.examples=[{example_id:'33333333-3333-4333-8333-333333333333',text_en:'These signs bode bad news.',text_uz:'Bu belgilar yomon xabarni bildiradi.'}];
 const {result}=buildPresentations([entry],{examples:[],collocations:[]});assert.deepEqual(result.get(entry.lexeme_id)!.senses[entry.senses[0]!.sense_id]!.exampleIds,[]);
});

test('a source grouping can be corrected without deleting its canonical senses or suppressing another meaning',()=>{
 const bus=word('bus','A passenger vehicle'),double=word('double-decker','A passenger vehicle'),omnibus=word('omnibus','A passenger vehicle');
 const before=JSON.stringify([bus,double,omnibus]);
 const {result}=buildPresentations([bus,double,omnibus],{examples:[],collocations:[],excludedSynonyms:[{lemma:'bus',definition:'A passenger vehicle',term:'double-decker',reason:'A two-level bus is a specific subtype, not an unrestricted synonym.',reference:'https://dictionary.cambridge.org/dictionary/english/double-decker'}]});
 assert.deepEqual(result.get(bus.lexeme_id)!.senses[bus.senses[0]!.sense_id]!.synonyms.map(row=>row.text),['omnibus']);
 assert.ok(result.get(omnibus.lexeme_id)!.senses[omnibus.senses[0]!.sense_id]!.synonyms.some(row=>row.text==='double-decker'),'the exclusion is scoped to the reviewed head and meaning');
 assert.equal(JSON.stringify([bus,double,omnibus]),before,'canonical source content and all identities stay unchanged');
});

test('the shipped presentation audit covers all 64,616 entries and 109,487 senses with valid relation targets',()=>{
 const base='content/dictionary/presentation/',manifest=JSON.parse(readFileSync(base+'manifest.json','utf8'));
 const entries=new Set<string>(),senses=new Map<string,string>(),links:{lexemeId?:string;senseId?:string}[]=[];let sourceSenses=0;
 assert.equal(manifest.stats.entries,64616);assert.equal(manifest.stats.senses,109487);assert.equal(manifest.stats.sourceExamples,81099);assert.equal(Object.keys(manifest.shards).length,256);
 for(const [name,descriptor]of Object.entries(manifest.shards)as[string,{sha256:string;bytes:number;entries:number}][]){const raw=readFileSync(base+name+'.json.gz');assert.equal(bytesHash(raw),descriptor.sha256);assert.equal(raw.length,descriptor.bytes);const shard=JSON.parse(gunzipSync(raw).toString())as Record<string,StoredPresentation>;assert.equal(Object.keys(shard).length,descriptor.entries);for(const[id,entry]of Object.entries(shard)){entries.add(id);assert.match(entry.contentSha,/^[a-f0-9]{64}$/);for(const[sense,row]of Object.entries(entry.senses)){assert.ok(!senses.has(sense));senses.set(sense,id);sourceSenses++;links.push(...row.synonyms,...row.collocations);}}}
 assert.equal(entries.size,64616);assert.equal(sourceSenses,109487);for(const link of links){if(link.lexemeId)assert.ok(entries.has(link.lexemeId));if(link.senseId)assert.equal(senses.get(link.senseId),link.lexemeId);}
});

// The full source is a private build input, not a production runtime dependency.
const prepared='../dictionary-worker-enriched-final';
test('prefigure correction is visible without changing its immutable canonical bytes or IDs',{skip:!existsSync(prepared+'/release-plan.json')},()=>{
 const plan=JSON.parse(readFileSync(prepared+'/release-plan.json','utf8'));
 let target:Entry|undefined;
 for(const d of plan.shards){const group=decodeShard(plan.release,d,readFileSync(prepared+'/shards/'+d.shard+'.json.gz'));target=[...group.values()].find(e=>e.display_lemma==='prefigure');if(target)break;}
 assert.ok(target);const before=entryContentHash(target),view=dictionaryPresentation(target);
 assert.match(view.senses[target.senses[0]!.sense_id]!.examples[0]!.text_en,/prefigure/);assert.ok(!view.senses[target.senses[0]!.sense_id]!.examples.some(ex=>ex.text_en.includes('bode')));assert.equal(entryContentHash(target),before);
});
