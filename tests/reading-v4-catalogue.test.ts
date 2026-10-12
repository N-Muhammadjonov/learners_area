import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { listGeneralSets } from "../src/lib/data/general-reading";

test("READ-ACADEMIC real SQL gates complete published three-passage sets before limit, with learner-owned statuses", async () => {
  const env = await createTestDatabase();
  try {
    const [user, other] = await env.query<{id:string}>("insert into users(name) values ('A'),('B') returning id");
    const create = async (title:string, n:number, hidden=false, empty=false) => {
      const [set] = await env.query<{id:string}>("insert into general_reading_sets(title,publication_state) values ($1,'published') returning id",[title]);
      const ids:string[]=[];
      for(let i=1;i<=n;i++) {
        const [passage] = await env.query<{id:string}>("insert into reading_passages(title,body_text,publication_state) values ($1,'Body',$2) returning id",[title,hidden && i===n ? 'draft':'published']);
        ids.push(passage!.id);
        await env.query("insert into general_reading_passages(passage_id,set_id,passage_no) values ($1,$2,$3)",[passage!.id,set!.id,i]);
        if(!empty) for(let q=1;q<=(n===3 ? (i===3 ? 14 : 13):1);q++) await env.query("insert into reading_questions(passage_id,\"order\",type,question_text,correct_answer,explanation) values($1,$2,'short_answer','Question','answer','Authored')",[passage!.id,q]);
      }
      return {id:set!.id,ids};
    };
    // More invalid rows than a page must never crowd out a valid formal test.
    for(let i=0;i<26;i++) await create(`Partial ${i}`,1);
    await create('Draft child',3,true); await create('No questions',3,false,true);
    const complete=await create('Real authored set',3);
    const [attempt] = await env.query<{id:string}>("insert into reading_attempts(user_id,passage_id) values($1,$2) returning id",[user!.id,complete.ids[0]]);
    await env.query("insert into reading_assessments(attempt_id,set_id,title) values($1,$2,'Captured')",[attempt!.id,complete.id]);
    const a=await listGeneralSets(user!.id,{academic:true},env.db);
    assert.equal(a.length,1); assert.equal(a[0]!.id,complete.id); assert.equal(a[0]!.assessmentStatus,'in_progress');
    assert.equal((await listGeneralSets(other!.id,{academic:true},env.db))[0]!.assessmentStatus,'not_started');
    assert.equal((await listGeneralSets(user!.id,{},env.db)).length,25,"General has a 24 + 1 page bound too");
  } finally { await env.close(); }
});
