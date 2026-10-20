/** Production mutation runner, separate from BOTH local and Preview bootstraps.
 * --plan is read-only. Each mutating mode requires the exact approved plan SHA,
 * target revision, active owner, matching source QA and verified backup receipt.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/client";
import { dictionaryObjects } from "../../src/lib/dictionary/object-store";
import { bytesHash, decodeShard, shardDescriptorSchema, manifestKey, type ShardDescriptor } from "../../src/lib/dictionary/shards";
import { rows, releaseManifest } from "../../src/lib/dictionary/store";
import { activateHybridRelease, cleanupFailedRelease } from "../../src/lib/dictionary/activation";
import { importHybridGroups, V2_RELEASE, SOURCE_COMMIT, type ExpectedImport } from "./hybrid-import";
import { sha, stableJson } from "../../src/lib/dictionary/model";

const [mode='--plan',directory]=process.argv.slice(2),env=process.env;
async function main(){
  if(!directory||!['--plan','--migrate','--import','--activate','--rollback','--cleanup'].includes(mode))throw Error("Usage: production-hybrid.ts MODE prepared-directory");
  if(env.RAILWAY_PROJECT_ID!=='fa66cadd-5364-47bd-95f9-0689b0562269'||env.RAILWAY_ENVIRONMENT_ID!=='e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a'||env.RAILWAY_SERVICE_ID!=='68f0cfac-8723-40e7-9c3c-52856dc06786')throw Error("production_target_identity_mismatch");
  const root=resolve(directory),raw=readFileSync(join(root,'release-plan.json')),planSha=bytesHash(raw);
  const plan=JSON.parse(raw.toString()) as {sourceCommit:string;expected:ExpectedImport;shards:ShardDescriptor[]};
  if(plan.sourceCommit!==SOURCE_COMMIT||plan.expected.release!==V2_RELEASE||plan.expected.lexemes!==62376||plan.expected.senses!==105488||plan.expected.examples!==81099)throw Error('source_plan_mismatch');
  const [owner]=await rows<{id:string}>(sql`select id from users where id=${env.DICTIONARY_OWNER_ID??''}::uuid and role='owner' and account_status='active'`);if(!owner)throw Error('active_owner_required');
  const [channel]=await rows<{active_release_id:string}>(sql`select active_release_id from dictionary_channels where name='stable'`);
  const [storage]=await rows(sql`select pg_database_size(current_database())::text database_bytes`);
  const expectedBase=env.DICTIONARY_EXPECTED_BASE==='none'?null:env.DICTIONARY_EXPECTED_BASE;
  if(mode==='--plan'){console.log(JSON.stringify({readOnly:true,planSha,sourceCommit:SOURCE_COMMIT,bucket:env.R2_BUCKET_NAME,prefix:`dictionary/releases/${V2_RELEASE}/`,active:channel?.active_release_id??null,storage,objects:plan.shards.length+1,compressedBytes:plan.shards.reduce((n,s)=>n+s.compressed_bytes,0)}));return;}
  if(env.DICTIONARY_PRODUCTION_APPROVAL!==planSha||!env.DICTIONARY_EXPECTED_REVISION||env.RAILWAY_GIT_COMMIT_SHA!==env.DICTIONARY_EXPECTED_REVISION||expectedBase===undefined)throw Error('explicit_changeset_approval_required');
  const qa=JSON.parse(readFileSync(env.DICTIONARY_QA_RECEIPT??'',"utf8"));
  const backup=JSON.parse(readFileSync(env.DICTIONARY_BACKUP_RECEIPT??'',"utf8"));
  if(qa.planSha!==planSha||qa.fullImportVerified!==true||qa.nativePostgresVerified!==true||backup.restoreVerified!==true||backup.revision!==env.DICTIONARY_BASELINE_REVISION||backup.projectId!==env.RAILWAY_PROJECT_ID||!Number.isFinite(Date.parse(backup.createdAt))||Date.now()-Date.parse(backup.createdAt)>86400000||Date.parse(backup.createdAt)>Date.now()+60000)throw Error('verified_qa_and_fresh_backup_required');
  const quota=Number(env.DICTIONARY_DATABASE_LIMIT_BYTES??500_000_000);
  if(!Number.isFinite(quota)||quota<1)throw Error('dictionary_capacity_exceeded');
  if(mode==='--import') {
    const [present]=await rows(sql`select id from dictionary_releases where id=${V2_RELEASE}`);
    if(!present && (!Number.isFinite(qa.dictionaryBytes)||Number(storage?.database_bytes)+qa.dictionaryBytes+25_000_000>quota))throw Error('dictionary_capacity_exceeded');
  }
  const protectedBefore=await rows(sql`select id,lexeme_id,folder_id,srs_stage,mastery,next_review_at from user_vocabulary order by id`);
  const objects=dictionaryObjects();
  if(mode==='--migrate'){
    const migration=readFileSync(new URL('../../drizzle/0064_dictionary_r2.sql',import.meta.url),'utf8');
    const journal=JSON.parse(readFileSync(new URL('../../drizzle/meta/_journal.json',import.meta.url),'utf8')).entries;
    const applied=await rows<{hash:string;created_at:string}>(sql`select hash,created_at::text from drizzle.__drizzle_migrations order by created_at`);
    const expected=journal.map((x:{tag:string;when:number})=>({hash:sha(readFileSync(new URL('../../drizzle/'+x.tag+'.sql',import.meta.url),'utf8')),when:x.when}));
    if(applied.length!==64||applied.some((x,i)=>x.hash!==expected[i].hash||Number(x.created_at)!==expected[i].when))throw Error('migration_history_mismatch');
    await db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(387384)`);await tx.execute(sql`set local lock_timeout='5s'`);for(const statement of migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await tx.execute(sql.raw(statement));await tx.execute(sql`insert into drizzle.__drizzle_migrations(hash,created_at) values(${sha(migration)},1792450000000)`);});
  }else if(mode==='--import'){
    await importHybridGroups((async function*(){for(const descriptor of plan.shards){const d=shardDescriptorSchema.parse(descriptor);yield [...decodeShard(V2_RELEASE,d,readFileSync(join(root,d.shard+'.json.gz'))).values()];}})(),plan.expected,objects,db,owner.id);
  }else if(mode==='--activate'){
    const manifest=await releaseManifest(V2_RELEASE);await activateHybridRelease({ownerId:owner.id,release:V2_RELEASE,manifestSha:sha(stableJson(manifest)),expectedBase},objects);
  }else if(mode==='--rollback'){
    if(expectedBase) {
      const [previous]=await rows<{manifest:unknown;manifest_sha:string}>(sql`select manifest,manifest_sha from dictionary_releases where id=${expectedBase} and state='validated'`);if(!previous)throw Error('previous_release_unavailable');
      await activateHybridRelease({ownerId:owner.id,release:expectedBase,manifestSha:previous.manifest_sha,expectedBase:V2_RELEASE},objects);
    }else await db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(387384)`);const [active]=await rows<{active_release_id:string}>(sql`select active_release_id from dictionary_channels where name='stable' for update`,tx);if(active?.active_release_id!==V2_RELEASE)throw Error('release_mismatch');await tx.execute(sql`delete from dictionary_channels where name='stable'`);await tx.execute(sql`insert into dictionary_owner_events(owner_user_id,operation,base_release_id,validation_result) values(${owner.id}::uuid,'rollback_to_uninitialized',${V2_RELEASE},'{"pass":true}'::jsonb)`);});
  }else await cleanupFailedRelease(V2_RELEASE,objects);
  const protectedAfter=await rows(sql`select id,lexeme_id,folder_id,srs_stage,mastery,next_review_at from user_vocabulary order by id`);
  // No import or release command is permitted to edit learner scheduling.
  if(stableJson(protectedBefore)!==stableJson(protectedAfter))throw Error('learner_scheduling_changed');
  console.log(JSON.stringify({complete:true,mode,planSha,learnerSchedulingUnchanged:true,manifestKey:manifestKey(V2_RELEASE)}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'dictionary_release_failed');process.exitCode=1;}).finally(()=>db.$client.end());
