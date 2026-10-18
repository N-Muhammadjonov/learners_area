import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { saveGeneralProgress } from "../src/lib/data/general-reading";
test("READ-GENERAL Check alone returns authored evidence/explanation; draft passage and cross-user progress remain private",async()=>{
 const env=await createTestDatabase();
 try {
  const [u,v]=await env.query<{id:string}>("insert into users(name) values ('A'),('B') returning id");
  const [s]=await env.query<{id:string}>("insert into general_reading_sets(title) values ('Set') returning id");
  const [p]=await env.query<{id:string}>("insert into reading_passages(title,body_text) values ('Passage','Text') returning id");
  await env.query("insert into general_reading_passages(set_id,passage_id,passage_no) values($1,$2,1)",[s!.id,p!.id]);
  const [q]=await env.query<{id:string}>("insert into reading_questions(passage_id,\"order\",type,question_text,correct_answer,explanation,evidence_quote) values($1,1,'short_answer','Question','answer','Authored explanation','Authored evidence') returning id",[p!.id]);
  const input={userId:u!.id,role:'student' as const,passageId:p!.id,answers:{[q!.id]:'answer'},check:false};
  assert.equal((await saveGeneralProgress(input,env.db))!.result,null);
  const checked=await saveGeneralProgress({...input,check:true},env.db);
  assert.equal(checked!.result![0]!.explanation,'Authored explanation');
  assert.equal(checked!.result![0]!.evidenceQuote,'Authored evidence');
  assert.equal(checked!.progress.score,1);
  const other=await saveGeneralProgress({...input,userId:v!.id,answers:{}},env.db);
  assert.deepEqual(other!.progress.answers,{});
  assert.equal(other!.result,null);
  const [legacy]=await env.query<{id:string}>("insert into reading_attempts(user_id,passage_id) values($1,$2) returning id",[u!.id,p!.id]);
  assert.equal(await saveGeneralProgress({...input,check:true},env.db),null,'a pre-catalogue standalone live attempt is sealed too');
  await env.query("update reading_attempts set status='completed' where id=$1",[legacy!.id]);
  assert.ok((await saveGeneralProgress({...input,check:true},env.db))?.result,'its completed review can Check again');
  await env.query("update reading_passages set publication_state='draft' where id=$1",[p!.id]);
  assert.equal(await saveGeneralProgress({...input,check:true},env.db),null);
 }finally{await env.close();}
});
