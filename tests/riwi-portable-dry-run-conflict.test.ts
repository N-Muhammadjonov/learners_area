import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "./support/pglite";
import { exportPortableArchive, importPortableArchive } from "../src/lib/portability/archive";
import { createPostgresImportDestination } from "../src/lib/portability/postgres-adapter";

test("duplicate primary keys inside a valid archive fail both zero-write dry-run and apply, with transactional rollback",async()=>{
  const d=await createTestDatabase();const owner=randomUUID();const id=randomUUID();
  try{
    await d.query("insert into users(id,name,role,account_status)values($1,'QA','owner','active')",[owner]);
    const files=new Map<string,string>();let current='';
    const manifest=await exportPortableArchive({scope:'learners-area',objectMode:'keep-r2',sourceFingerprint:'duplicate-source',source:{async *rows(table){if(table==='grammar_topics')yield [{id,title:'First',explanation:'One',order:1},{id,title:'Second',explanation:'Two',order:2}];},async *objects(){}},sink:{async beginFile(path){current=path;files.set(path,'');},async write(chunk){files.set(current,files.get(current)!+chunk);},async endFile(){}}});
    const pool={async connect(){return{async query(sql:string,values?:unknown[]){return{rows:await d.query(sql,values)};}};}};
    for(const dryRun of [true,false]){
      const destination=createPostgresImportDestination(pool,undefined,{ownerId:owner,dryRun,scope:'learners-area'});
      await assert.rejects(importPortableArchive({manifest,destination,dryRun,archive:{async *readRows(file){for(const line of files.get(file)!.split('\n'))if(line)yield line+'\n';},async readObject(){throw new Error('No object copy');}}}),/import_conflicts:1/);
      assert.equal((await d.query<{n:number}>("select count(*)::int n from grammar_topics"))[0]!.n,0);
    }
  }finally{await d.close();}
});
