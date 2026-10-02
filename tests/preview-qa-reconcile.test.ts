import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./support/pglite";
// @ts-expect-error inspected local ESM utility
import { assess, readEvidence, verifyBackup, reconcile, TARGET } from "../scripts/preview-qa-reconcile-0021.mjs";
// @ts-expect-error inspected local ESM utility
import { fingerprint, serverIdentityHash, qaConnectionOptions } from "../scripts/preview-qa-migrate.mjs";
const journal=JSON.parse(readFileSync("drizzle/meta/_journal.json","utf8")) as {entries:{tag:string;when:number;idx:number}[]};
const sql=(tag:string)=>readFileSync(`drizzle/${tag}.sql`,"utf8");
const hash=(tag:string)=>createHash("sha256").update(sql(tag)).digest("hex");
const history=journal.entries.filter(e=>e.idx<=24 && e.tag!==TARGET).map(e=>({hash:hash(e.tag),created_at:String(e.when)}));
const column={udt_schema:"public",udt_name:"gender",is_nullable:"YES",column_default:null};
const evidence={labels:["male","female"],column,history};
test("QA TLS verifies certificates and hostname; URL options cannot replace strict TLS",()=>{
 const opts=qaConnectionOptions("postgres://qa:fake@pooler.example:5432/postgres",{});
 assert.equal(opts.ssl.rejectUnauthorized,true);assert.equal(opts.ssl.servername,"pooler.example");
 assert.throws(()=>qaConnectionOptions("postgres://qa:fake@pooler.example/db?sslmode=no-verify",{}),/SSL parameters/);
 assert.throws(()=>qaConnectionOptions("postgres://qa:fake@pooler.example/db",{PREVIEW_QA_CA_FILE:"/missing-ca-file"}),/ENOENT/);
 assert.equal(qaConnectionOptions("postgres://qa:fake@127.0.0.1/db",{}).ssl,false);
});
test("Exactly verified 0021 gap is eligible; other history gaps are refused",()=>{
 assert.equal(assess(evidence,journal,sql).eligible,true);
 const wrong={...evidence,history:[] as typeof history};
 // Remove a preceding known entry by index, without relying on its tag.
 wrong.history=history.filter(r=>r.hash!==hash(journal.entries[20]!.tag));
 assert.equal(assess(wrong,journal,sql).eligible,false);
});
test("Refuse missing/changed gender DDL, unknown and duplicate hashes, and wall-clock timestamps",()=>{
 for(const bad of [
  {...evidence,labels:["female","male"]}, {...evidence,column:null}, {...evidence,column:{...column,column_default:"'male'::gender"}},
  {...evidence,history:[...history,{hash:"unknown",created_at:"0"}]}, {...evidence,history:[...history,history[0]]},
  {...evidence,history:history.map((r,i)=>i? r:{...r,created_at:"9999999999999"})},
 ]) assert.equal(assess(bad,journal,sql).eligible,false);
});
test("Already journalled entry is idempotent and empty history cannot be labelled repaired",()=>{
 const entry=journal.entries.find(e=>e.tag===TARGET)!;
 const result=assess({...evidence,history:[...history,{hash:hash(TARGET),created_at:String(entry.when)}]},journal,sql);
 assert.equal(result.eligible,true);assert.equal(result.alreadyJournalled,true);
 assert.equal(assess({...evidence,history:[]},journal,sql).eligible,false);
});
test("Backup check rejects absent/schema-only archives; returns digest without exposing content",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"qa-backup-test-"));const file=join(dir,"fixture.dump");writeFileSync(file,"PGDMPfixture");
 try{
  await assert.rejects(verifyBackup(file,()=>"TABLE public users owner"),/must contain data/);
  const result=await verifyBackup(file,()=>"1 TABLE DATA public users owner\n2 TABLE DATA drizzle __drizzle_migrations owner");
  assert.equal(result.sha256,createHash("sha256").update("PGDMPfixture").digest("hex"));assert.equal(result.restoreTested,false);
  await assert.rejects(verifyBackup(join(dir,"absent.dump")),/ENOENT/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("Actual migrated PostgreSQL DDL is inspected; one journal entry is added transactionally and retries add nothing",async()=>{
 const d=await createTestDatabase();
 const adapter={query:async(q:string,args:unknown[]=[])=>({rows:await d.query(q,args)})};
 const url="postgres://postgres.qa:fake@pooler.example:6543/postgres";
 const identity={db:"postgres",session_user:"postgres",port:6543,system_identifier:"qa-fixture"};
 const client={query:async(q:string,args:unknown[]=[])=>q.includes("current_database()")?{rows:[identity]}:q.includes("pg_control_system()")?{rows:[{system_identifier:identity.system_identifier}]}:adapter.query(q,args)};
 const env={DATABASE_URL:url,PREVIEW_QA_DB_FINGERPRINT:fingerprint(url),PREVIEW_QA_PROJECT_REF:"qa",PREVIEW_QA_SERVER_IDENTITY:serverIdentityHash(identity),PREVIEW_QA_BACKUP_REF:"isolated-fixture",PREVIEW_QA_BACKUP_FILE:"fixture"};
 try{
  await d.query("create schema drizzle");await d.query("create table drizzle.__drizzle_migrations(id serial primary key,hash text not null,created_at bigint)");
  for(const row of history)await d.query("insert into drizzle.__drizzle_migrations(hash,created_at)values($1,$2)",[row.hash,row.created_at]);
  const observed=await readEvidence(adapter);assert.deepEqual(observed.labels,["male","female"]);assert.equal(assess(observed,journal,sql).eligible,true);
  const inspect=await reconcile({client,env,journal,readSql:sql});assert.equal(inspect.applied,false);
  const opts={client,env,journal,readSql:sql,mode:"--apply",checkBackup:async()=>({isolatedFixture:true})};
  const applied=await reconcile(opts);assert.equal(applied.applied,true);
  assert.equal((await reconcile(opts)).applied,false);
  assert.equal((await d.query<{n:number}>("select count(*)::integer n from drizzle.__drizzle_migrations"))[0]!.n,25);
  await assert.rejects(reconcile({...opts,env:{...env,PREVIEW_QA_BACKUP_REF:""}}),/BACKUP_REF/);
  await assert.rejects(reconcile({...opts,env:{...env,PREVIEW_QA_SERVER_IDENTITY:"wrong"}}),/server identity mismatch/);
  await assert.rejects(reconcile({...opts,env:{...env,VERCEL_ENV:"production"}}),/production/);
 }finally{await d.close();}
});
