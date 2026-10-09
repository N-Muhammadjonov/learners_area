import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./support/pglite";
import { createSessionToken } from "../src/lib/auth/session";
import { runPortableExportCommand } from "../src/lib/portability/export-command";
import { runPortableImportCommand } from "../src/lib/portability/import-command";
import { withEncryptedPortableArchive } from "../src/lib/portability/encrypted-archive";
import { portableIdentityMap } from "../src/lib/portability/identity-mapping";

test("RIWI-only export excludes private source descendants; mapped import stays inactive and preserves destination identities", async () => {
  const source = await createTestDatabase(); const target = await createTestDatabase();
  const folder = await mkdtemp(join(tmpdir(), "riwi-mode-b-")); const key = randomBytes(32);
  const originOwner = randomUUID(); const owner = randomUUID(); const student = randomUUID();
  const oldSecret = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "mode-b-qa-session-secret-000000000000";
  const pool = (d: typeof source) => ({ async connect() { return { async query(text: string, values?: unknown[]) { return { rows: await d.query(text, values) }; } }; } });
  try {
    await source.query("insert into users(id,name,role,account_status)values($1,'SOURCE_PRIVATE_NAME','owner','active'),($2,'PRIVATE_STUDENT','student','active')", [originOwner,student]);
    await target.query("insert into users(id,name,role,account_status)values($1,'DESTINATION_OWNER','owner','active'),($2,'TARGET_STUDENT','student','active')", [owner,student]);
    const [global] = await source.query<{ id: string }>("insert into riwi_knowledge_sources(source_type,title,checksum,provenance,rights_class,state,scope,created_by_user_id,reviewed_by_user_id,approved_at,activated_at,regression_fixture_id,regression_evidence_hash,regression_passed_at)values('owner_instruction','PUBLIC',repeat('a',64),'QA','owned','active','global',$1,$1,now(),now(),'source-preview',repeat('b',64),now())returning id", [originOwner]);
    const [privateSource] = await source.query<{ id: string }>("insert into riwi_knowledge_sources(source_type,title,checksum,provenance,rights_class,scope,scope_user_id,created_by_user_id)values('owner_instruction','PRIVATE_SOURCE_CANARY',repeat('c',64),'QA','owned','user',$1,$2)returning id", [student,originOwner]);
    await source.query("update riwi_knowledge_sources set supersedes_source_id=$1 where id=$2",[privateSource!.id,global!.id]);
    await source.query("update riwi_knowledge_sources set source_object_key=case when id=$1 then 'public/source.pdf' else 'private/source.pdf' end where id in ($1,$2)",[global!.id,privateSource!.id]);
    for (const [id,text] of [[global!.id,'Public authored fact'],[privateSource!.id,'PRIVATE_UNIT_CANARY']]) await source.query("insert into riwi_knowledge_units(source_id,ordinal,content,content_hash,character_count)values($1,1,$2,repeat('d',64),$3)",[id,text,text!.length]);
    const [policy] = await source.query<{ id: string }>("insert into riwi_assessment_policies(scope,active_version,created_by_user_id)values('reading',1,$1)returning id", [originOwner]);
    await source.query("insert into riwi_assessment_policy_versions(policy_id,version,state,overlay,source_message_hash,created_by_user_id,reviewed_by_user_id,approved_at,regression_fixture_id,regression_evidence_hash,regression_passed_at)values($1,1,'approved','{}',repeat('e',64),$2,$2,now(),'source-preview',repeat('f',64),now())",[policy!.id,originOwner]);
    await source.query("insert into riwi_security_signals(signal_type,state,fingerprint,route_class,sanitized_evidence,reviewed_by_user_id,reviewed_at,regression_fixture_id,regression_evidence_hash)values('prompt_injection','approved_regression',repeat('9',64),'riwi.chat','injection',$1,now(),'source-preview',repeat('8',64))",[originOwner]);
    const token = (id: string) => createSessionToken({sub:id,role:"student",name:"QA",locale:"en",onboarded:true});
    const publicObject={objectClass:'riwi-knowledge-source' as const,sourceKey:'public/source.pdf',destinationKey:null,ownerId:null,scope:'global' as const,retentionState:'active' as const,sha256:'7'.repeat(64),byteLength:3,mimeType:'application/pdf'};
    const dryExport={request:{scope:'riwi',dryRun:true,sourceFingerprint:'mode-b-source'},sessionToken:await token(originOwner),pool:pool(source)};
    await assert.rejects(runPortableExportCommand({...dryExport,async *objects(){yield {...publicObject,sourceKey:'private/source.pdf'};}}),/object_source_required/);
    await assert.rejects(runPortableExportCommand({...dryExport,async *objects(){yield {...publicObject,sourceKey:'missing/source.pdf'};}}),/object_source_required/);
    await assert.rejects(runPortableExportCommand({...dryExport,async *objects(){yield {...publicObject,scope:'user' as const,ownerId:student};}}),/private_object/);
    const archive = join(folder,"mode-b.lap");
    const manifest = await runPortableExportCommand({ request:{scope:"riwi",dryRun:false,destination:archive,sourceFingerprint:"mode-b-source"},sessionToken:await token(originOwner),pool:pool(source),key,async *objects() {yield publicObject;} });
    assert.equal(manifest.objects.length,1);
    assert.equal(manifest.tables.find(t=>t.table==='riwi_knowledge_sources')?.rowCount,1);
    assert.equal(manifest.tables.find(t=>t.table==='riwi_knowledge_units')?.rowCount,1);
    assert.ok(!manifest.tables.some(t=>t.table==='users'||t.table.includes('conversation')));
    await withEncryptedPortableArchive({source:archive,key},async (_m,a)=>{
      for(const t of manifest.tables) for await(const line of a.readRows(t.file)) {
        assert.doesNotMatch(line,/PRIVATE_SOURCE_CANARY|PRIVATE_UNIT_CANARY|SOURCE_PRIVATE_NAME|PRIVATE_STUDENT/);
        assert.ok(!line.includes(privateSource!.id),"private ancestor IDs must not leak through public source history");
      }
    });
    const request={source:archive,expectedScope:"riwi",dryRun:true,destinationFingerprint:"mode-b-target"};
    const input={request,sessionToken:await token(owner),pool:pool(target),key};
    await assert.rejects(runPortableImportCommand(input),/identity_mapping_required/);
    await assert.rejects(runPortableImportCommand({...input,identityMapping:[]}),/identity_mapping_required/);
    await assert.rejects(runPortableImportCommand({...input,identityMapping:[{sourceId:originOwner,targetId:student}]}),/target_owner_required/);
    await assert.rejects(runPortableImportCommand({...input,identityMapping:[{sourceId:originOwner,targetId:randomUUID()}]}),/target_owner_required/);
    const identityMapping=[{sourceId:originOwner,targetId:owner}];
    const extraOwner=randomUUID();
    await target.query("insert into users(id,name,role,account_status)values($1,'Other owner','owner','active')",[extraOwner]);
    await assert.rejects(runPortableImportCommand({...input,identityMapping:[...identityMapping,{sourceId:randomUUID(),targetId:extraOwner}]}),/identity_mapping_unused/);
    const plan=await runPortableImportCommand({...input,identityMapping});assert.equal(plan.creates,5);assert.equal(plan.dryRun,true);
    assert.equal(plan.manifestSha256,manifest.manifestSha256);assert.match(plan.identityMappingHash!,/^[a-f0-9]{64}$/);
    const repeated=await runPortableImportCommand({...input,identityMapping:[{sourceId:originOwner.toUpperCase(),targetId:owner.toUpperCase()}]});
    assert.equal(repeated.identityMappingHash,plan.identityMappingHash,"receipt binds normalized reviewed mapping without exposing actors");
    assert.equal((await target.query<{n:number}>("select count(*)::int n from riwi_knowledge_sources"))[0]!.n,0);
    await runPortableImportCommand({...input,identityMapping,request:{...request,dryRun:false}});
    const [saved]=await target.query<{state:string;created_by_user_id:string;activated_at:unknown;regression_evidence_hash:unknown}>("select * from riwi_knowledge_sources");
    assert.equal(saved!.state,'candidate');assert.equal(saved!.created_by_user_id,owner);assert.equal(saved!.activated_at,null);assert.equal(saved!.regression_evidence_hash,null);
    assert.equal((await target.query<{active_version:unknown}>("select active_version from riwi_assessment_policies"))[0]!.active_version,null);
    assert.equal((await target.query<{state:string}>("select state from riwi_assessment_policy_versions"))[0]!.state,'candidate');
    assert.equal((await target.query<{state:string}>("select state from riwi_security_signals"))[0]!.state,'candidate');
    assert.equal((await target.query<{name:string}>("select name from users where id=$1",[owner]))[0]!.name,'DESTINATION_OWNER');
    await assert.rejects(runPortableImportCommand({...input,identityMapping}),/fresh_destination_required/);
    await target.query("update users set account_status='suspended' where id=$1",[owner]);
    await assert.rejects(runPortableImportCommand({...input,identityMapping}),/owner_required/);
  } finally {
    if(oldSecret===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=oldSecret;
    key.fill(0);await source.close();await target.close();await rm(folder,{recursive:true,force:true});
  }
});

test("identity mapping rejects malformed, extra, duplicated and many-to-one actors without trusting a supplied role",()=>{
  const a=randomUUID(),b=randomUUID(),c=randomUUID();
  for(const value of [[{sourceId:a,targetId:b,role:'owner'}],[{sourceId:'invalid',targetId:b}],[{sourceId:a,targetId:b},{sourceId:a,targetId:c}],[{sourceId:a,targetId:c},{sourceId:b,targetId:c}]]) assert.throws(()=>portableIdentityMap(value));
  assert.equal(portableIdentityMap([{sourceId:a.toUpperCase(),targetId:b.toUpperCase()}]).get(a),b);
});
