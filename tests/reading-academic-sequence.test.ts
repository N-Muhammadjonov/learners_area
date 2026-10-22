import test from "node:test";
import assert from "node:assert/strict";
import {createTestDatabase} from "./support/pglite";
import {academicSetCatalogue,academicSetAccess,saveGeneralProgress} from "../src/lib/data/general-reading";
import {startAcademicSet} from "../src/lib/data/reading-assessments";

test("Academic completion unlocks the next test for its learner only; General stays open; Start enforces the same order",async()=>{
 const env=await createTestDatabase();
 try{
  const [student,other,staff]=await env.query<{id:string;role:"student"|"owner"}>("insert into users(name,role) values ('Student','student'),('Other','student'),('Owner','owner') returning id,role");
  const sets:{id:string;passage:string;question:string}[]=[];
  for(let n=1;n<=3;n++){
   const [set]=await env.query<{id:string}>("insert into general_reading_sets(title) values($1) returning id",['Test '+n]);let first='',question='';
   for(let part=1;part<=3;part++){
    const [p]=await env.query<{id:string}>("insert into reading_passages(title,body_text,test_no,passage_no) values($1,'Own passage',$2,$3) returning id",['Title '+n+'/'+part,n,part]);if(part===1)first=p!.id;
    await env.query("insert into general_reading_passages(set_id,passage_id,passage_no) values($1,$2,$3)",[set!.id,p!.id,part]);
    for(let q=1;q<=(part===3?14:13);q++){
     const [row]=await env.query<{id:string}>("insert into reading_questions(passage_id,\"order\",question_no,type,question_text,correct_answer,explanation) values($1,$2,$2,'short_answer','Question','answer','') returning id",[p!.id,q]);if(part===1&&q===1)question=row!.id;
    }
   }
   sets.push({id:set!.id,passage:first,question});
  }
  assert.deepEqual((await academicSetCatalogue(student!,env.db)).map(s=>s.locked),[false,true,true]);
  assert.equal(await academicSetAccess(student!,sets[1]!.id,env.db),false);
  assert.equal(await startAcademicSet(student!.id,sets[1]!.id,env.db),null,'direct Start cannot bypass the lock');
  const general=await saveGeneralProgress({userId:student!.id,role:'student',passageId:sets[2]!.passage,answers:{[sets[2]!.question]:'answer'},check:true},env.db);
  assert.ok(general?.result,'later General passage is independent and remains editable/checkable');
  assert.deepEqual((await academicSetCatalogue(student!,env.db)).map(s=>s.locked),[false,true,true]);
  const first=await startAcademicSet(student!.id,sets[0]!.id,env.db);assert.ok(first);
  assert.equal(await startAcademicSet(student!.id,sets[0]!.id,env.db),first,'resume remains idempotent');
  await env.query("update reading_attempts set status='completed',submitted_at=now() where id=$1",[first]);
  assert.deepEqual((await academicSetCatalogue(student!,env.db)).map(s=>s.locked),[false,false,true]);
  assert.deepEqual((await academicSetCatalogue(other!,env.db)).map(s=>s.locked),[false,true,true]);
  assert.ok(await startAcademicSet(student!.id,sets[1]!.id,env.db));
  assert.ok((await academicSetCatalogue(staff!,env.db)).every(s=>!s.locked),'staff can inspect all materials');
 }finally{await env.close();}
});
