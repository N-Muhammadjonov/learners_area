import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { generalReadingBundle } from "../src/lib/reading/import-schema";
import { importGeneralReadingSet } from "../src/lib/services/reading/general-import";
import { startAcademicSet } from "../src/lib/data/reading-assessments";
import { getAttemptDetail } from "../src/lib/data/reading";
import { submitReadingAttempt } from "../src/lib/services/reading/submit";
import { resolveOccurrence, readingSourceAccess } from "../src/lib/services/lexical/context";

test('R-V4-09/11/23 own submitted review resolves all three real passage occurrences; active, forged and foreign contexts stay denied',async()=>{
 const env=await createTestDatabase();
 try{
  const [a,b]=await env.query<{id:string}>("insert into users(name) values ('A'),('B') returning id");
  const user={id:a!.id,role:'student' as const};const other={id:b!.id,role:'student' as const};
  const bundle=generalReadingBundle.parse({sourceRef:'qa-review-dictionary',title:'QA review',publish:true,passages:[1,2,3].map(n=>({passageNo:n,title:`Passage ${n}`,body:'The bank approved the loan.',questions:Array.from({length:n===3?14:13},(_,i)=>({questionNo:i+1,type:'short_answer',text:'Authored question',answer:'bank',explanation:'Authored reason'})),vocabulary:[{word:'bank',pos:'noun',def:'An authored financial institution',ex:'The bank approved the loan.'}]}))});
  const set=await env.db.transaction(tx=>importGeneralReadingSet(tx,bundle));
  const id=await startAcademicSet(a!.id,set.setId,env.db);assert.ok(id);
  const occurrences=await env.query<{id:string;passage_id:string}>("select id,passage_id from lexical_occurrences where passage_id=any($1::uuid[])",[set.passages.map(p=>p.passageId)]);
  assert.equal(occurrences.length,3);
  assert.equal(await readingSourceAccess(user,id!,env.db),'locked');
  for(const occurrence of occurrences)assert.equal((await resolveOccurrence(user,'reading',id!,occurrence.id,env.db))?.status,'locked');
  const detail=(await getAttemptDetail(id!,a!.id,env.db))!;
  assert.equal((await submitReadingAttempt(id!,a!.id,detail.questions.map(q=>({questionId:q.id,answer:'bank'})),env.db)).ok,true);
  assert.equal(await readingSourceAccess(user,id!,env.db),'allowed');
  const review=(await getAttemptDetail(id!,a!.id,env.db))!;
  assert.equal(review.occurrences.length,3);
  for(const span of review.occurrences)assert.equal(review.passage.bodyText.slice(span.startChar,span.endChar),'bank');
  for(const occurrence of occurrences){
   const resolved=await resolveOccurrence(user,'reading',id!,occurrence.id,env.db);
   assert.equal(resolved?.status,'resolved');assert.equal(resolved?.snapshot?.passageId,occurrence.passage_id);
   assert.equal(await resolveOccurrence(other,'reading',id!,occurrence.id,env.db),null);
  }
  const [foreign]=await env.query<{id:string}>("insert into reading_passages(title,body_text) values ('Foreign','The bank approved the loan.') returning id");
  const [occ]=await env.query<{id:string}>("insert into lexical_occurrences(passage_id,source_type,start_char,end_char,surface_form,resolution_status) values ($1,'reading',4,8,'bank','unresolved') returning id",[foreign!.id]);
  assert.equal(await resolveOccurrence(user,'reading',id!,occ!.id,env.db),null,'guessing another source occurrence never grants membership');
  const repeat=await startAcademicSet(a!.id,set.setId,env.db);assert.ok(repeat);
  assert.equal(await readingSourceAccess(user,id!,env.db),'locked','old completed review cannot unlock a new active exam over the same rows');
  for(const occurrence of occurrences){
   assert.equal((await resolveOccurrence(user,'reading',id!,occurrence.id,env.db))?.status,'locked');
   assert.equal((await resolveOccurrence(user,'reading',occurrence.passage_id,occurrence.id,env.db))?.status,'resolved','explicit General learning remains a separate authorized product');
  }
  assert.equal((await submitReadingAttempt(repeat!,a!.id,[],env.db)).ok,true);
  await env.query("update reading_passages set publication_state='archived' where id=any($1::uuid[])",[set.passages.map(p=>p.passageId)]);
  for(const occurrence of occurrences){
   assert.equal((await resolveOccurrence(user,'reading',id!,occurrence.id,env.db))?.status,'resolved','owned archived review retains its immutable source');
   assert.equal(await resolveOccurrence(other,'reading',id!,occurrence.id,env.db),null);
   assert.equal(await resolveOccurrence(user,'reading',occurrence.passage_id,occurrence.id,env.db),null,'archived direct-source lookup is not a review');
  }
 }finally{await env.close();}
});
