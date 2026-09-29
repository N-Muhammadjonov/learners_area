/** Real HTTP + PostgreSQL contextual save acceptance; isolated QA only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, readingPassages, readingAttempts, lexicalOccurrences, lexemes, userVocabulary, vocabFolders } from "../src/db/schema";
const base = new URL(process.env.BASE_URL ?? "http://127.0.0.1:3108");
const database = new URL(process.env.DATABASE_URL!);
assert.ok(['localhost','127.0.0.1'].includes(base.hostname));
assert.ok(['localhost','127.0.0.1'].includes(database.hostname) && database.pathname === '/learners_qa2');
const [a,b,passage,attempt,money,river,occurrence,folder] = Array.from({length:8},()=>randomUUID()) as [string,string,string,string,string,string,string,string];
const password = randomUUID();
const hash = await bcrypt.hash(password,10);
let passed=0;
function check(value: unknown, label: string) { assert.ok(value,label); passed++; console.log(`PASS ${label}`); }
async function request(path:string,cookie='',body?:unknown) {
  const r=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  return {r, data:await r.json().catch(()=>null)};
}
await db.insert(users).values([a,b].map(id=>({id,name:'QA2 contextual HTTP',email:`${id}@example.test`,passwordHash:hash,role:'student' as const,accountStatus:'active' as const,onboardingCompletedAt:new Date()})));
try {
  const cookies:string[]=[];
  for(const id of [a,b]) {
    const login=await request('/api/auth/login','',{email:`${id}@example.test`,password});
    check(login.r.status===200,'password login');
    cookies.push(login.r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '));
  }
  await db.insert(readingPassages).values({id:passage,title:'QA2 contextual river',bodyText:'The bank borders the river.',publicationState:'draft'});
  await db.insert(readingAttempts).values({id:attempt,userId:a,passageId:passage});
  await db.insert(lexemes).values([{id:money,term:'bank',definitionEn:'A financial institution',senseKey:`qa2-${money}`,provenance:'authored'},{id:river,term:'bank',definitionEn:'The edge of a river',translationUz:"qirg'oq",senseKey:`qa2-${river}`,provenance:'derived',verificationStatus:'unverified'}]);
  await db.insert(lexicalOccurrences).values({id:occurrence,passageId:passage,lexemeId:river,startChar:4,endChar:8,surfaceForm:'bank',sentenceText:'The bank borders the river.'});
  await db.insert(vocabFolders).values({id:folder,userId:a,name:'QA2 context'});
  const path=`/api/vocabulary/lookup?sourceId=${attempt}&occurrenceId=${occurrence}`;
  check((await request(path)).r.status===401,'anonymous lookup refused');
  const denial=await request(path,cookies[1]);
  check(denial.r.status===404 && JSON.stringify(denial.data)==='{"error":"source_not_found"}','foreign source denied without metadata');
  const hit=await request(path,cookies[0]);
  check(hit.r.status===200 && hit.data.contextual.definitionEn==='The edge of a river','occurrence lookup uses contextual meaning');
  check(hit.data.contextual.translationUz==="qirg'oq" && hit.data.contextual.verificationStatus==='unverified','UZ and honest provenance returned');
  const body={sourceType:'reading',sourceId:attempt,occurrenceId:occurrence,folderId:folder,items:[{term:'bank',definitionEn:'FORGED OTHER MEANING',canonicalLexemeId:money,authored:true}]};
  check((await request('/api/vocabulary',cookies[1],body)).r.status===404,'foreign contextual save refused');
  const invalid=await request('/api/vocabulary',cookies[0],{...body,folderId:randomUUID()});
  check(invalid.r.status===404,'nonexistent folder refused');
  check((await db.select().from(userVocabulary).where(eq(userVocabulary.userId,a))).length===0,'refusal writes no personal word');
  const saved=await request('/api/vocabulary',cookies[0],body);
  check(saved.r.status===200 && saved.data.added===1,'contextual HTTP save succeeds');
  const [row]=await db.select().from(userVocabulary).where(eq(userVocabulary.userId,a));
  check(row?.lexemeId===river && row.lexemeId!==money,'forged spelling/definition/canonical ID cannot override source');
  check(row?.folderId===folder && row.sourceSnapshot?.sentenceText==='The bank borders the river.','folder and context persisted');
  const replay=await request('/api/vocabulary',cookies[0],body);
  check(replay.data.added===0 && replay.data.points===0,'HTTP replay idempotent');
  const known=await request(path,cookies[0]);
  check(known.data.known?.id===row!.id,'lookup recognizes saved exact sense');
  await db.delete(readingAttempts).where(eq(readingAttempts.id,attempt));
  await db.delete(readingPassages).where(eq(readingPassages.id,passage));
  check((await request(path,cookies[0])).r.status===404,'removed source fails safely');
  const library=await request('/api/vocabulary',cookies[0]);
  check(library.data.words[0]?.sourceSnapshot?.sentenceText==='The bank borders the river.','library serves durable context after source deletion');
  console.log(`${passed}/${passed} contextual HTTP checks PASS`);
} finally {
  await db.delete(readingAttempts).where(eq(readingAttempts.id,attempt));
  await db.delete(readingPassages).where(eq(readingPassages.id,passage));
  await db.delete(users).where(inArray(users.id,[a,b]));
  await db.delete(lexemes).where(inArray(lexemes.id,[money,river]));
}
