import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "../src/db/client";
import {BASE_RELEASE,sha,stableJson} from "../src/lib/dictionary/model";
import {activeRelease,entryById,releaseManifest,rows,saveDraft,searchDictionary} from "../src/lib/dictionary/store";
import {saveDictionarySense,savedSenseIds} from "../src/lib/dictionary/save";
import {advancePublish,beginPublish,rollback} from "../src/lib/dictionary/publish";

const enabled=process.env.DICTIONARY_RELEASE_TESTS==="1";
test("full frozen catalog: exact-sense save, draft isolation, bounded publish, immutable release and rollback preserve learner state",{skip:!enabled,timeout:600000},async()=>{
 const target=new URL(process.env.DATABASE_URL!);
 assert.ok(["localhost","127.0.0.1"].includes(target.hostname)&&target.pathname==="/learners_qa2");
 const {active_release_id:base}=await activeRelease();assert.equal(base,BASE_RELEASE);
 const manifest=await releaseManifest(base);
 assert.equal(manifest.senses,105488);assert.equal(manifest.examples,81099);assert.equal(manifest.lexemes,62376);
 assert.equal(manifest.sense_set_sha256,"832090bb4bda84901f94ddcc5a8c95e368606f3be35d9912bc68dddca5d42766");
 assert.equal(manifest.example_set_sha256,"dbd1773b0b6db7221cbce5674f4f8c3ed3a0a721daaaf52b5c9cc665386c9595");
 const owner=randomUUID(),student=randomUUID();
 await db.execute(sql`insert into users(id,name,role,is_owner,account_status) values(${owner}::uuid,'Dictionary release QA owner','owner',true,'active'),(${student}::uuid,'Dictionary release QA learner','student',false,'active')`);
 let candidate:string|null=null;
 try{
  const en=await searchDictionary("bank","EN",base);assert.equal(en[0]!.display_lemma,"bank");assert.ok(en.length<=20);
  const form=await searchDictionary("ran","EN",base);assert.ok(form.some(x=>x.display_lemma==="run"&&x.match_type==="form"));
  const uz=await searchDictionary("shishmoq","UZ",base);assert.ok(uz.some(x=>x.display_lemma==="swell"));
  assert.equal((await searchDictionary("%' OR 1=1 --","EN",base)).length,0);
  const selected=await entryById(uz.find(x=>x.display_lemma==="swell")!.lexeme_id,base);assert.ok(selected&&selected.senses.length>1);
  const sense=selected.senses.find(s=>s.translations.some(t=>t.text==="shishmoq"))!;assert.ok(sense);
  const another=selected.senses.find(s=>s.sense_id!==sense.sense_id)!;
  const saved=await saveDictionarySense(student,selected.lexeme_id,sense.sense_id,base,null);assert.equal(saved.ok,true);
  const second=await saveDictionarySense(student,selected.lexeme_id,another.sense_id,base,null);assert.equal(second.ok,true);
  const before=await rows(sql`select * from user_vocabulary where user_id=${student}::uuid order by id`);assert.equal(before.length,2);
  const duplicate=await saveDictionarySense(student,selected.lexeme_id,sense.sense_id,base,null);assert.equal(duplicate.ok,true);
  assert.deepEqual(await rows(sql`select * from user_vocabulary where user_id=${student}::uuid order by id`),before);
  assert.equal((await savedSenseIds(student,selected.senses.map(s=>s.sense_id))).length,2);
  await assert.rejects(()=>saveDictionarySense(student,selected.lexeme_id,randomUUID(),base,null),/sense_not_found/);
  const replacement="shishmoq (mahalliy nashr sinovi)";
  await saveDraft(owner,{operation:"edit_sense",lexemeId:selected.lexeme_id,senseId:sense.sense_id,translationUz:replacement});
  assert.equal((await entryById(selected.lexeme_id,base))!.senses.find(s=>s.sense_id===sense.sense_id)!.translations[0]!.text,sense.translations[0]!.text);
  let job=await beginPublish(owner);candidate=job.candidate_release_id;
  await assert.rejects(()=>beginPublish(owner),/publish_already_running/);
  await assert.rejects(()=>advancePublish(student,job.id),/job_not_found/);
  let steps=0,last="";
  while(job.phase!=="complete"){
   if(job.phase!==last){console.log("phase",job.phase);last=job.phase;}
   assert.notEqual(job.phase,"failed");assert.ok(steps++<1200);
   assert.equal((await activeRelease()).active_release_id,base);
   job=await advancePublish(owner,job.id);
  }
  console.log("completed bounded steps",steps);
  assert.equal((await activeRelease()).active_release_id,candidate);
  assert.deepEqual(await rows(sql`select * from user_vocabulary where user_id=${student}::uuid order by id`),before);
  const published=await entryById(selected.lexeme_id,candidate);
  assert.equal(published!.senses.find(s=>s.sense_id===sense.sense_id)!.translations[0]!.text,replacement);
  assert.equal(published!.senses.find(s=>s.sense_id===sense.sense_id)!.definition_en,sense.definition_en);
  assert.equal((await entryById(selected.lexeme_id,base))!.senses.find(s=>s.sense_id===sense.sense_id)!.translations[0]!.text,sense.translations[0]!.text);
  await assert.rejects(()=>saveDictionarySense(student,selected.lexeme_id,sense.sense_id,base,null),/release_mismatch/);
  await assert.rejects(()=>db.execute(sql`update dictionary_entries set content_sha='corrupt' where release_id=${candidate} and lexeme_id=${selected.lexeme_id}::uuid`));
  await assert.rejects(()=>db.execute(sql`delete from dictionary_search_terms where release_id=${candidate}`));
  await assert.rejects(()=>db.execute(sql`update dictionary_releases set manifest_sha='corrupt' where id=${candidate}`));
  const [record]=await rows<{manifest:unknown;manifest_sha:string}>(sql`select manifest,manifest_sha from dictionary_releases where id=${candidate}`);
  assert.equal(sha(stableJson(record!.manifest)),record!.manifest_sha);
  await rollback(owner);
  assert.equal((await activeRelease()).active_release_id,base);
  assert.deepEqual(await rows(sql`select * from user_vocabulary where user_id=${student}::uuid order by id`),before);
  const [appSense]=await rows<{translation_uz:string}>(sql`select l.translation_uz from lexemes l join dictionary_sense_mappings m on m.app_sense_id=l.id where m.sense_id=${sense.sense_id}::uuid`);
  assert.equal(appSense!.translation_uz,sense.translations[0]!.text);
  assert.equal((await savedSenseIds(student,selected.senses.map(s=>s.sense_id))).length,2);
 }finally{
  if(candidate&&(await activeRelease()).active_release_id===candidate)await rollback(owner);
  await db.execute(sql`delete from dictionary_publish_jobs where owner_user_id=${owner}::uuid`);
  await db.execute(sql`delete from dictionary_drafts where owner_user_id=${owner}::uuid`);
  await db.execute(sql`delete from dictionary_owner_events where owner_user_id=${owner}::uuid`);
  await db.execute(sql`delete from users where id in (${owner}::uuid,${student}::uuid)`);
 }
});
