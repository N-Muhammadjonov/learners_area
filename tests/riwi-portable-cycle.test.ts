import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "./support/pglite";
import { exportPortableArchive, importPortableArchive } from "../src/lib/portability/archive";
import { createPostgresImportDestination } from "../src/lib/portability/postgres-adapter";
import type { PortableRow } from "../src/lib/portability/types";

test("real Speaking schema cycles and forward retry references restore without disabling constraints; dry-run rejects missing parents",async()=>{
  const d=await createTestDatabase(),owner=randomUUID(),prompt=randomUUID(),session=randomUUID(),item=randomUUID();
  const parent='ffffffff-ffff-4fff-8fff-ffffffffffff',retry='00000000-0000-4000-8000-000000000001';
  try{
    await d.query("insert into users(id,name,role,account_status)values($1,'Destination','owner','active')",[owner]);
    const rows:Record<string,PortableRow[]>={
      users:[{id:owner,name:'Source',role:'owner',accountStatus:'active'}],
      speaking_prompts:[{id:prompt,part:'part1',category:'part1',promptText:'What do you enjoy?'}],
      speaking_ai_sessions:[{id:session,userId:owner,mode:'part1',sessionSeed:'fixture'}],
      speaking_ai_session_items:[{id:item,sessionId:session,ordinal:1,promptId:prompt,part:'part1',topicKey:'study',topicPosition:0,questionPosition:0,attemptId:parent}],
      speaking_attempts:[{id:retry,userId:owner,part:'part1',retryOfAttemptId:parent,aiSessionId:session,aiSessionItemId:item},{id:parent,userId:owner,part:'part1',aiSessionId:session,aiSessionItemId:item}],
    };
    const build=async()=>{
      const files=new Map<string,string>();let current='';
      const manifest=await exportPortableArchive({scope:'learners-area',objectMode:'keep-r2',sourceFingerprint:'cycle-fixture',source:{async *rows(table){if(rows[table])yield rows[table]!;},async *objects(){}},sink:{async beginFile(path){current=path;files.set(path,'');},async write(chunk){files.set(current,files.get(current)!+chunk);},async endFile(){}}});
      return{manifest,archive:{async *readRows(file:string){for(const line of files.get(file)!.split('\n'))if(line)yield line+'\n';},async readObject(){throw new Error('No objects');}}};
    };
    const pool={async connect(){return{async query(sql:string,values?:unknown[]){return{rows:await d.query(sql,values)};}};}};
    const run=async(dryRun:boolean)=>importPortableArchive({...await build(),dryRun,destination:createPostgresImportDestination(pool,undefined,{ownerId:owner,dryRun,scope:'learners-area'})});
    assert.equal((await run(true)).creates,5);
    assert.equal((await d.query<{n:number}>("select count(*)::int n from speaking_attempts"))[0]!.n,0);
    rows.speaking_attempts![0]={...rows.speaking_attempts![0],retryOfAttemptId:randomUUID()};
    await assert.rejects(run(true),/foreign_reference_missing/);
    await assert.rejects(run(false),/foreign_reference_missing/);
    assert.equal((await d.query<{n:number}>("select count(*)::int n from speaking_ai_sessions"))[0]!.n,0,"failed deferred validation rolls back all preceding inserts");
    rows.speaking_attempts![0]={...rows.speaking_attempts![0],retryOfAttemptId:parent};
    const signed=await build();let updates=0;
    const observingPool={async connect(){return{async query(sql:string,values?:unknown[]){if(sql.startsWith('update '))updates++;return{rows:await d.query(sql,values)};}};}};
    await assert.rejects(importPortableArchive({...signed,dryRun:false,destination:createPostgresImportDestination(observingPool,undefined,{ownerId:owner,dryRun:false,scope:'learners-area'}),archive:{...signed.archive,async *readRows(file){for await(const line of signed.archive.readRows(file))yield file==='tables/speaking_attempts.jsonl'?line.replace('part1','part2'):line;}}}),/table_checksum_mismatch/);
    assert.equal(updates,0,"no deferred relationship update before every table checksum is accepted");
    assert.equal((await d.query<{n:number}>("select count(*)::int n from speaking_attempts"))[0]!.n,0);
    await run(false);
    assert.equal((await d.query<{retry_of_attempt_id:string}>("select retry_of_attempt_id from speaking_attempts where id=$1",[retry]))[0]!.retry_of_attempt_id,parent);
    assert.equal((await d.query<{ai_session_item_id:string}>("select ai_session_item_id from speaking_attempts where id=$1",[parent]))[0]!.ai_session_item_id,item);
    assert.equal((await d.query<{attempt_id:string}>("select attempt_id from speaking_ai_session_items where id=$1",[item]))[0]!.attempt_id,parent);
    await assert.rejects(d.query("update speaking_attempts set retry_of_attempt_id=$1 where id=$2",[randomUUID(),retry]),/foreign key|violates/);
  }finally{await d.close();}
});
