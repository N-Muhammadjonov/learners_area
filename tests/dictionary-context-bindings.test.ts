import test from "node:test";
import assert from "node:assert/strict";
import {createTestDatabase} from "./support/pglite";
import {applyDraft,sha,senseMeaningHash} from "../src/lib/dictionary/model";
import {writeEntries} from "../src/lib/dictionary/store";
import {applyContextBindings,type ContextBindingPlan} from "../src/lib/dictionary/context-bindings";

test("reviewed occurrence bindings select their exact sense in all three sources and preserve learner data",async t=>{
 const env=await createTestDatabase();
 try{
  const release="rel-v1-111111111111111111111111";
  let bank=applyDraft([],{operation:"add_lexeme",lemma:"bank",partOfSpeech:"n",lexicalType:"word",definitionEn:"A financial institution",definitionUz:"Moliya muassasasi",translationUz:"bank",examples:[{textEn:"The bank lends money.",textUz:"Bank qarz beradi."}]},release);
  bank=applyDraft([bank],{operation:"add_sense",lexemeId:bank.lexeme_id,definitionEn:"Land beside a river",definitionUz:"Daryo yonidagi yer",translationUz:"qirg‘oq",examples:[{textEn:"We sat on the bank.",textUz:"Biz qirg‘oqda o‘tirdik."}]},release);
  bank.lexical_type="other"; // Valid source label; not a legal app lexical-unit type.
  await env.query("insert into dictionary_releases(id,state) values($1,'building')",[release]);
  await writeEntries([bank],env.db);
  await env.query("insert into dictionary_channels(name,active_release_id) values('stable',$1)",[release]);
  const [user]=await env.query<{id:string}>("insert into users(name,role,account_status) values('Context QA learner','student','active') returning id");
  const body="The bank lends money beside the bank.",first=body.indexOf("bank"),last=body.lastIndexOf("bank");
  const [reading]=await env.query<{id:string}>("insert into reading_passages(title,body_text) values('Two meanings',$1) returning id",[body]);
  const [retention]=await env.query<{id:string}>("insert into retention_texts(level,internal_label,sequence) values('A2','A2 context QA',1) returning id");
  const [version]=await env.query<{id:string}>("insert into retention_text_versions(retention_text_id,version_number,body_text,word_count,scoring_structure) values($1,1,$2,8,'{}') returning id",[retention!.id,body]);
  const [listening]=await env.query<{id:string}>("insert into listening_tests(created_by_user_id,title,audio_type) values($1,'Two meanings','audio') returning id",[user!.id]);
  await env.query("insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash) values($1,'context-qa',$2::jsonb,'qa-only','qa')",[listening!.id,JSON.stringify({sections:[{number:1,transcript:body},{number:2,transcript:body}],questions:[]})]);
  const sources:ContextBindingPlan["materials"]=([
   {source:"reading",sourceId:reading!.id},
   {source:"retention",sourceId:version!.id},
   {source:"listening",sourceId:listening!.id,sectionNumber:1,segmentKey:"s1"},
   {source:"listening",sourceId:listening!.id,sectionNumber:2,segmentKey:"s2"},
  ] as const).map(m=>({...m,bodySha:sha(body),spans:[first,last].map((start,index)=>({start,end:start+4,surface:"bank",entryId:bank.lexeme_id,senseId:bank.senses[index]!.sense_id,meaningSha:senseMeaningHash(bank,bank.senses[index]!)}))}));
  const plan:ContextBindingPlan={version:1,releaseId:release,reviewer:"AI contextual review; no human certification",materials:sources};
  await t.test("different occurrences of bank use their authored meanings without a learner choice",async()=>{
   const result=await applyContextBindings(plan,env.db);
   assert.deepEqual(result,{materials:4,reviewedSpans:8,inserted:8,updated:0,unchanged:0,learnerDataChanged:false,semanticReviewAutomated:false});
   const rows=await env.query<{start_char:number;definition_en:string;section_number:number|null;segment_key:string|null}>("select o.start_char,l.definition_en,o.section_number,o.segment_key from lexical_occurrences o join lexemes l on l.id=o.lexeme_id order by o.start_char");
   assert.equal(rows.length,8);
   assert.deepEqual((await env.query<{lexical_type:string}>("select distinct lexical_type from lexical_units")).map(r=>r.lexical_type),["word"]);
   assert.ok(rows.filter(r=>r.start_char===first).every(r=>r.definition_en==="A financial institution"));
   assert.ok(rows.filter(r=>r.start_char===last).every(r=>r.definition_en==="Land beside a river"));
   assert.equal(rows.filter(r=>r.segment_key==="s2"&&r.section_number===2).length,2,"Listening offsets stay relative to their own section");
   const again=await applyContextBindings(plan,env.db);assert.equal(again.unchanged,8);assert.equal(again.inserted,0);
   assert.equal((await env.query("select * from user_vocabulary")).length,0,"binding source words must not create learner words");
  });
  await t.test("changed source, wrong meaning hash, wrong form and unknown segment abort without partial updates",async()=>{
   for(const [edit,message]of [
    [(p:ContextBindingPlan)=>{p.materials[0]!.bodySha=sha("stale");},/context_source_changed/],
    [(p:ContextBindingPlan)=>{p.materials[0]!.spans[0]!.meaningSha=sha("stale");},/context_meaning_changed/],
    [(p:ContextBindingPlan)=>{p.materials[0]!.spans[0]!.surface="Bank";},/context_surface_changed/],
    [(p:ContextBindingPlan)=>{Object.assign(p.materials[0]!.spans[0]!,{start:9,end:14,surface:"lends"});},/context_surface_not_dictionary_form/],
    [(p:ContextBindingPlan)=>{Object.assign(p.materials[0]!.spans[0]!,{start:5,end:8,surface:"ank"});},/context_partial_word/],
    [(p:ContextBindingPlan)=>{p.materials[0]!.spans.push({...p.materials[0]!.spans[0]!});},/context_binding_overlap/],
    [(p:ContextBindingPlan)=>{p.materials[2]!.segmentKey="s9";},/context_source_changed/],
    [(p:ContextBindingPlan)=>{p.materials[0]!.segmentKey="s1";},/context_binding_segment_invalid/],
    [(p:ContextBindingPlan)=>{p.releaseId="old-release";},/release_mismatch/],
   ]as const){const altered=structuredClone(plan);edit(altered);await assert.rejects(()=>applyContextBindings(altered,env.db),message);}
   assert.equal((await env.query("select * from lexical_occurrences")).length,8);
  });
  await t.test("a correction requires the previous occurrence identity and does not rewrite a learner's saved sense",async()=>{
   const [old]=await env.query<{id:string;lexeme_id:string}>("select id,lexeme_id from lexical_occurrences where passage_id=$1 and start_char=$2",[reading!.id,last]);
   const financial=bank.senses[0]!.sense_id,river=bank.senses[1]!.sense_id;
   // Simulate a bad old source link, while an already saved river meaning stays intact.
   await env.query("update lexical_occurrences set lexeme_id=$1 where id=$2",[financial,old!.id]);
   await env.query("insert into user_vocabulary(user_id,lexeme_id,srs_stage) values($1,$2,3)",[user!.id,river]);
   const saved=await env.query("select * from user_vocabulary");
   const patch:ContextBindingPlan={...plan,materials:[{...sources[0]!,spans:[sources[0]!.spans[1]!]}]};
   await assert.rejects(()=>applyContextBindings(patch,env.db),/context_previous_link_changed/);
   patch.materials[0]!.spans[0]!.before={id:old!.id,lexemeId:financial,status:"resolved"};
   const result=await applyContextBindings(patch,env.db);assert.equal(result.updated,1);
   assert.deepEqual(await env.query("select * from user_vocabulary"),saved);
   assert.equal((await env.query<{lexeme_id:string}>("select lexeme_id from lexical_occurrences where id=$1",[old!.id]))[0]!.lexeme_id,river);
  });
 }finally{await env.close();}
});
