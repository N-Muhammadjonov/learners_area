import test from "node:test";
import assert from "node:assert/strict";
import { applyDraft, draftSchema, entrySchema, entryTerms, normalizeSearch, projectId, stableJson, type Entry } from "../src/lib/dictionary/model";

const id=(kind:string)=>projectId("qa-model",kind);
const release="rel-v1-111111111111111111111111";
const entry:Entry={schema_version:"1.0.0",release_id:release,lexeme_id:id("bank"),display_lemma:"bank",normalized_search_form:"bank",lexical_type:"word",part_of_speech:"n",homograph_group:null,is_satellite:false,pronunciations:[],forms:[{surface_form:"banks"}],senses:[{sense_id:id("money"),definition_en:"A financial institution",definition_uz:"Pul bilan ishlaydigan muassasa",translations:[{translation_id:id("translation"),text:"bank",order:0}],examples:[{example_id:id("example"),text_en:"The bank lends money.",text_uz:"Bank pul qarz beradi."}]}],relations:[],collocations:[],attribution:[{source_name:"QA fixture",snapshot_id:"qa",creator:"QA",source_url:"",license_reference:"QA",license_url:"",attribution_text:"Test-only fixture"}]};
for(const [input,expected] of [["ＢＡＮＫ","bank"],["Straße","strasse"],["Σςσ","σσσ"],["  A\tB\nC  ","a b c"],["oʻtmoq","o'tmoq"],["oʼtmoq","o'tmoq"],["o’tmoq","o'tmoq"],["self—care","self-care"],["self‑care","self-care"],["ﬃ","ffi"],["İ","i̇"]]){
 test(`frozen normalization: ${JSON.stringify(input)}`,()=>assert.equal(normalizeSearch(input!),expected));
}
test("strict public entry rejects internal provenance/debug fields",()=>{
 for(const field of ["raw_payload","admin_notes","source_path","password","review_status","pipeline_debug"])assert.equal(entrySchema.safeParse({...entry,[field]:"hidden"}).success,false);
 assert.equal(entrySchema.safeParse({...entry,senses:[{...entry.senses[0],internal_note:"hidden"}]}).success,false);
});
test("owner changes preserve immutable English, canonical sense/example/translation IDs and base object",()=>{
 const before=stableJson(entry);
 const changed=applyDraft([entry],draftSchema.parse({operation:"edit_sense",lexemeId:entry.lexeme_id,senseId:entry.senses[0]!.sense_id,translationUz:"moliyaviy bank",definitionUz:"Pul saqlaydigan muassasa",examples:[{exampleId:entry.senses[0]!.examples[0]!.example_id,textUz:"Bank qarz beradi."}]}),release);
 assert.equal(changed.senses[0]!.definition_en,entry.senses[0]!.definition_en);
 assert.equal(changed.senses[0]!.sense_id,entry.senses[0]!.sense_id);
 assert.equal(changed.senses[0]!.translations[0]!.translation_id,entry.senses[0]!.translations[0]!.translation_id);
 assert.equal(changed.senses[0]!.examples[0]!.text_en,entry.senses[0]!.examples[0]!.text_en);
 assert.equal(changed.senses[0]!.examples[0]!.example_id,entry.senses[0]!.examples[0]!.example_id);
 assert.equal(stableJson(entry),before);
 for(const forbidden of ["definitionEn","senseIdOverride","exampleSentence","releaseId"])assert.equal(draftSchema.safeParse({operation:"edit_sense",lexemeId:entry.lexeme_id,senseId:entry.senses[0]!.sense_id,[forbidden]:"altered"}).success,false);
});
test("new sense remains distinct under same lemma and gets deterministic stable project IDs",()=>{
 const draft=draftSchema.parse({operation:"add_sense",lexemeId:entry.lexeme_id,definitionEn:"The land beside a river",translationUz:"qirg‘oq",definitionUz:"Daryo yonidagi yer",examples:[{textEn:"They sat on the bank.",textUz:"Ular qirg‘oqda o‘tirdi."}]});
 const changed=applyDraft([entry],draft,release);
 assert.equal(changed.senses.length,2);assert.notEqual(changed.senses[0]!.sense_id,changed.senses[1]!.sense_id);
 assert.deepEqual(applyDraft([entry],draft,release),changed);
 assert.throws(()=>applyDraft([changed],draft,release),/duplicate_sense/);
});
test("search indexes lemma, form, every Uzbek translation and definition without leaking English definitions into UZ",()=>{
 const terms=entryTerms(entry);
 assert.ok(terms.some(t=>t.direction==="EN"&&t.term==="bank"&&t.rank===0));
 assert.ok(terms.some(t=>t.direction==="EN"&&t.term==="banks"&&t.rank===2));
 assert.ok(terms.some(t=>t.direction==="UZ"&&t.term==="pul"));
 assert.ok(!terms.some(t=>t.direction==="UZ"&&t.term.includes("financial")));
 assert.equal(new Set(terms.map(t=>t.direction+":"+t.term)).size,terms.length);
});
test("Latin Uzbek validation rejects Cyrillic for all editable fields",()=>{
 for(const field of ["translationUz","definitionUz"])assert.equal(draftSchema.safeParse({operation:"edit_sense",lexemeId:entry.lexeme_id,senseId:entry.senses[0]!.sense_id,[field]:"банк"}).success,false);
 assert.equal(draftSchema.safeParse({operation:"edit_sense",lexemeId:entry.lexeme_id,senseId:entry.senses[0]!.sense_id,examples:[{exampleId:id("example"),textUz:"банк"}]}).success,false);
});
test("canonical JSON is order-independent and retains arrays in semantic order",()=>{
 assert.equal(stableJson({b:2,a:1}),stableJson({a:1,b:2}));
 assert.notEqual(stableJson([1,2]),stableJson([2,1]));
 assert.deepEqual(JSON.parse(stableJson({a:["é",1,null],b:true})),{a:["é",1,null],b:true});
});

test("canonical POS alias cannot create a duplicate noun under an existing n entry",()=>{
const draft=draftSchema.parse({operation:"add_lexeme",lemma:"BANK",partOfSpeech:"noun",lexicalType:"word",definitionEn:"A new description",translationUz:"bank",definitionUz:"Moliyaviy joy",examples:[]});
assert.throws(()=>applyDraft([entry],draft,release),/duplicate_lexeme/);
assert.equal(draftSchema.safeParse({...draft,partOfSpeech:"idiom"}).success,false);
});
