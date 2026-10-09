import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client";
import { users, speakingAttempts } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import { authorizeResourceRead, READ_URL_TTL_SECONDS } from "../src/lib/data/uploads";
import { S3StorageProvider } from "../src/lib/services/storage/s3-provider";

test("the actual private recording reader denies a foreign learner and missing object, while permitting the owner and reviewers",async()=>{
 const database=await createTestDatabase();const original={...db.query};
 try{
  // Bind the existing production query API to real migration-backed fixture queries.
  // No HTTP route, ownership decision or SQL predicate is replaced.
  Object.assign(db.query,database.db.query);
  const owner=randomUUID(),foreign=randomUUID();await database.db.insert(users).values([{id:owner,name:'Owner',accountStatus:'active'},{id:foreign,name:'Foreign',accountStatus:'active'}]);
  const key=`speaking/attempts/${randomUUID()}/recording.webm`;
  await database.db.insert(speakingAttempts).values({userId:owner,part:'part1',recordingObjectKey:key});
  assert.equal((await authorizeResourceRead({id:owner,role:'student'},key)).allowed,true);
  assert.deepEqual(await authorizeResourceRead({id:foreign,role:'student'},key),{allowed:false,reason:'forbidden'});
  assert.deepEqual(await authorizeResourceRead({id:foreign,role:'student'},'speaking/attempts/missing/recording.webm'),{allowed:false,reason:'not_found'});
  for(const role of ['teacher','admin','owner'] as const)assert.equal((await authorizeResourceRead({id:foreign,role},key)).allowed,true);
  assert.deepEqual(await authorizeResourceRead({id:owner,role:'student'},'../private'),{allowed:false,reason:'not_found'});
 }finally{Object.assign(db.query,original);await database.close();}
});

test("the production S3 signer scopes a private recording GET to one key and five-minute expiry",async()=>{
 const values={R2_BUCKET_NAME:'fixture-private',R2_ACCESS_KEY_ID:'fixture-access',R2_SECRET_ACCESS_KEY:'fixture-secret-not-a-real-key',R2_ENDPOINT:'https://storage.test.invalid',R2_REGION:'auto'};
 const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 try{
  Object.assign(process.env,values);const storage=new S3StorageProvider();
  const key='speaking/attempts/fixture/recording.webm';const signed=new URL((await storage.signedReadUrl(key,READ_URL_TTL_SECONDS))!);
  assert.equal(signed.protocol,'https:');assert.equal(signed.pathname,'/fixture-private/'+key);assert.equal(signed.searchParams.get('X-Amz-Expires'),'300');assert.ok(signed.searchParams.get('X-Amz-Signature'));assert.ok(signed.searchParams.get('X-Amz-Date'));
  await assert.rejects(storage.signedReadUrl('../escape',300));
  await assert.rejects(storage.signedReadUrl(key,604801),/seven days|one week|604800|expiresIn/i);
  // This is SDK/private authorization evidence, not a real R2 expiry response.
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
