import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./support/pglite";
import { createSessionToken } from "../src/lib/auth/session";
import { runPortableExportCommand } from "../src/lib/portability/export-command";
import { runPortableImportCommand } from "../src/lib/portability/import-command";

test("explicit encrypted Mode A preserves site and RIWI rows without replacing destination owner credentials",async()=>{
  const source=await createTestDatabase(),target=await createTestDatabase();
  const folder=await mkdtemp(join(tmpdir(),'riwi-mode-a-'));const key=randomBytes(32),owner=randomUUID(),learner=randomUUID();
  const previous=process.env.AUTH_SECRET;process.env.AUTH_SECRET='mode-a-qa-session-secret-000000000000';
  const pool=(d:typeof source)=>({async connect(){return{async query(sql:string,values?:unknown[]){return{rows:await d.query(sql,values)};}};}});
  try{
    await source.query("insert into users(id,name,role,account_status,password_hash)values($1,'ORIGIN','owner','active','source-auth'),($2,'Learner','student','active',null)",[owner,learner]);
    await target.query("insert into users(id,name,role,account_status,password_hash)values($1,'DESTINATION','owner','active','destination-auth')",[owner]);
    await source.query("insert into grammar_topics(title,explanation,\"order\")values('Grammar','Authored',1)");
    await source.query("insert into riwi_knowledge_sources(source_type,title,checksum,provenance,rights_class,created_by_user_id)values('owner_instruction','Knowledge',repeat('a',64),'QA','owned',$1)",[owner]);
    const sessionToken=await createSessionToken({sub:owner,role:'student',name:'QA',locale:'en',onboarded:true});
    const archive=join(folder,'full.lap');
    const manifest=await runPortableExportCommand({request:{scope:'full-system',dryRun:false,destination:archive,sourceFingerprint:'full-source'},sessionToken,pool:pool(source),key,async *objects(){}});
    assert.ok(manifest.tables.some(t=>t.table==='grammar_topics'&&t.rowCount===1));
    assert.ok(manifest.tables.some(t=>t.table==='riwi_knowledge_sources'&&t.rowCount===1));
    const input={request:{source:archive,expectedScope:'full-system',dryRun:true,destinationFingerprint:'full-target'},sessionToken,pool:pool(target),key};
    const dry=await runPortableImportCommand(input);assert.equal(dry.creates,3);assert.equal(dry.skips,1);
    assert.equal((await target.query<{n:number}>("select count(*)::int n from users"))[0]!.n,1);
    await runPortableImportCommand({...input,request:{...input.request,dryRun:false}});
    assert.equal((await target.query<{n:number}>("select count(*)::int n from grammar_topics"))[0]!.n,1);
    assert.equal((await target.query<{n:number}>("select count(*)::int n from riwi_knowledge_sources"))[0]!.n,1);
    assert.equal((await target.query<{n:number}>("select count(*)::int n from users"))[0]!.n,2);
    const [saved]=await target.query<{name:string;password_hash:string}>("select name,password_hash from users where id=$1",[owner]);
    assert.deepEqual(saved,{name:'DESTINATION',password_hash:'destination-auth'});
  }finally{
    if(previous===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=previous;
    key.fill(0);await source.close();await target.close();await rm(folder,{recursive:true,force:true});
  }
});
