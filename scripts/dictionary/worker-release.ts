import {applyCourseCorrections} from '../../src/lib/dictionary/course-corrections';
import {applyOccurrenceCorrections} from '../../src/lib/dictionary/occurrence-corrections';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {sql} from 'drizzle-orm';
import {db} from '../../src/db/client';
import {sha,stableJson} from '../../src/lib/dictionary/model';
import {z} from 'zod';
import {bytesHash,shardKey,decodeShard,releasePattern} from '../../src/lib/dictionary/shards';
import {indexKey} from '../../src/lib/dictionary/search-index';
import {workerIndexManifestSchema} from '../../src/lib/dictionary/worker-gateway';
import {dictionaryObjects} from '../../src/lib/dictionary/object-store';
import {rows,releaseManifest} from '../../src/lib/dictionary/store';
import {activateHybridRelease} from '../../src/lib/dictionary/activation';
import {retireUnusedLegacyIndex} from '../../src/lib/dictionary/retire';
import {importHybridGroups} from './hybrid-import';
/** No implicit deploy/activate. The approval document is a separate frozen,
 * reviewed changeset, not an old import plan or a CLI confirmation shortcut. */
const digest=z.string().regex(/^[a-f0-9]{64}$/),releaseId=z.string().regex(releasePattern);
const approvalSchema=z.object({architecture:z.literal('r2-worker-v3'),preparedPlanSha:digest,release:releaseId,migrationSha:digest,courseCorrectionsSha:digest,occurrenceCorrectionsSha:digest,ownerId:z.string().uuid(),expectedBase:releaseId.nullable(),databaseLimitBytes:z.number().int().positive().max(500_000_000),retire:z.object({release:releaseId,manifestSha:digest}).optional()});
async function main(){
 const [action,prepared,approvalFile]=process.argv.slice(2);
 if(!action||!prepared||!approvalFile||!['inspect','migrate','stage','activate','rollback','retire'].includes(action))throw Error('Usage: worker-release.ts inspect|migrate|stage|activate|rollback|retire PREPARED REVIEWED-APPROVAL.json');
 const approvalBytes=readFileSync(approvalFile),approval=approvalSchema.parse(JSON.parse(approvalBytes.toString())),planBytes=readFileSync(join(prepared,'release-plan.json')),plan=JSON.parse(planBytes.toString());
 if(bytesHash(planBytes)!==approval.preparedPlanSha||plan.release!==approval.release)throw Error('reviewed_plan_mismatch');
 const search=workerIndexManifestSchema.parse(plan.search);
 if(action==='inspect'){console.log(JSON.stringify({release:plan.release,approvalSha:bytesHash(approvalBytes),counts:plan.expected,indexObjects:search.objects.length,enrichment:plan.enrichment,mutations:false}));return;}
 if(process.env.DICTIONARY_APPROVED_PLAN_SHA!==bytesHash(approvalBytes)||process.env.DICTIONARY_EXPECTED_REVISION!==process.env.RAILWAY_GIT_COMMIT_SHA||!process.env.DICTIONARY_EXPECTED_REVISION)throw Error('explicit_reviewed_production_approval_required');
 if(process.env.RAILWAY_PROJECT_ID!=='fa66cadd-5364-47bd-95f9-0689b0562269'||process.env.RAILWAY_ENVIRONMENT_ID!=='e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a'||process.env.RAILWAY_SERVICE_ID!=='68f0cfac-8723-40e7-9c3c-52856dc06786')throw Error('production_target_mismatch');
 const [owner]=await rows(sql`select 1 from users where id=${approval.ownerId}::uuid and role='owner' and account_status='active'`);if(!owner)throw Error('active_owner_required');
 const qa=JSON.parse(readFileSync(process.env.DICTIONARY_QA_RECEIPT??'','utf8')),backup=JSON.parse(readFileSync(process.env.DICTIONARY_BACKUP_RECEIPT??'','utf8'));
 if(qa.complete!==true||qa.planSha!==approval.preparedPlanSha||qa.currentMigrationSha!==approval.migrationSha||qa.existingVocabularyPreserved!==13||qa.saveAndDuplicateVerified!==true||!Number.isSafeInteger(qa.dictionaryBytes)||qa.dictionaryBytes<1)throw Error('matching_native_qa_required');
 if(backup.restoreVerified!==true||backup.projectId!==process.env.RAILWAY_PROJECT_ID||backup.serviceId!==process.env.RAILWAY_SERVICE_ID||!process.env.DICTIONARY_BASELINE_REVISION||backup.revision!==process.env.DICTIONARY_BASELINE_REVISION||!Number.isFinite(Date.parse(backup.createdAt))||Date.now()-Date.parse(backup.createdAt)>86400000||Date.parse(backup.createdAt)>Date.now()+60000)throw Error('fresh_verified_backup_required');
 const protectedBefore=await rows(sql`select * from user_vocabulary order by id`);
 if(action==='migrate'){
  const journal=JSON.parse(readFileSync(new URL('../../drizzle/meta/_journal.json',import.meta.url),'utf8')).entries as {tag:string;when:number}[],applied=await rows<{hash:string;created_at:string}>(sql`select hash,created_at::text from drizzle.__drizzle_migrations order by created_at`);
  const expected=journal.map(m=>({...m,hash:sha(readFileSync(new URL('../../drizzle/'+m.tag+'.sql',import.meta.url),'utf8'))})),next=expected.at(-1)!;
  if(next.tag!=='0065_dictionary_worker_index'||next.hash!==approval.migrationSha||![expected.length-1,expected.length].includes(applied.length)||applied.some((m,i)=>m.hash!==expected[i]!.hash||Number(m.created_at)!==expected[i]!.when))throw Error('reviewed_migration_history_mismatch');
  if(applied.length<expected.length)await db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(387384)`);await tx.execute(sql`set local lock_timeout='5s'`);for(const statement of readFileSync(new URL('../../drizzle/0065_dictionary_worker_index.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await tx.execute(sql.raw(statement));await tx.execute(sql`insert into drizzle.__drizzle_migrations(hash,created_at) values(${next.hash},${next.when})`);});
  if(stableJson(await rows(sql`select * from user_vocabulary order by id`))!==stableJson(protectedBefore))throw Error('learner_data_changed');
  console.log(JSON.stringify({migration:next.tag,complete:true,alreadyApplied:applied.length===expected.length,learnerDataUnchanged:true}));return;
 }
 const [migration]=await rows<{hash:string}>(sql`select hash from drizzle.__drizzle_migrations where created_at=1792460000000`);if(migration?.hash!==approval.migrationSha)throw Error('reviewed_migration_required');
 const objects=dictionaryObjects();
 if(action==='stage'){
  const [storage]=await rows<{bytes:string}>(sql`select pg_database_size(current_database())::text bytes`),[present]=await rows(sql`select 1 from dictionary_releases where id=${plan.release}`);
  if(!present&&Number(storage?.bytes)+qa.dictionaryBytes+25_000_000>approval.databaseLimitBytes)throw Error('dictionary_capacity_exceeded');
  const correctionBytes=readFileSync(join(prepared,'course-corrections.json'));if(bytesHash(correctionBytes)!==plan.courseCorrectionsSha||plan.courseCorrectionsSha!==approval.courseCorrectionsSha)throw Error('reviewed_course_corrections_mismatch');
  const occurrenceBytes=readFileSync(new URL('../../content/dictionary/occurrence-corrections.json',import.meta.url));if(bytesHash(occurrenceBytes)!==approval.occurrenceCorrectionsSha)throw Error('reviewed_occurrence_corrections_mismatch');
  await db.transaction(async tx=>{await applyCourseCorrections(JSON.parse(correctionBytes.toString()),tx);await applyOccurrenceCorrections(JSON.parse(occurrenceBytes.toString()),tx);});
  for(const d of search.objects){const body=readFileSync(join(prepared,'search',d.name+'.json.gz'));if(bytesHash(body)!==d.sha256)throw Error('prepared_index_checksum_mismatch');await objects.putImmutable(indexKey(plan.release,d.name),body);}
  // Freeze the approved prepared bytes first; a runtime compressor mismatch
  // then fails the immutable-object check instead of silently changing the plan.
  for(const d of plan.shards){const body=readFileSync(join(prepared,'shards',d.shard+'.json.gz'));if(bytesHash(body)!==d.sha256)throw Error('prepared_shard_checksum_mismatch');await objects.putImmutable(shardKey(plan.release,d.shard),body);}
  const result=await importHybridGroups((async function*(){for(const d of plan.shards){const body=readFileSync(join(prepared,'shards',d.shard+'.json.gz'));yield [...decodeShard(plan.release,d,body).values()];}})(),plan.expected,objects,db,approval.ownerId,search);
  console.log(JSON.stringify({staged:true,activeChanged:false,release:plan.release,manifestSha:sha(stableJson(result.manifest))}));
 }else if(action==='activate'){
  const manifest=await releaseManifest(plan.release);console.log(JSON.stringify(await activateHybridRelease({ownerId:approval.ownerId,release:plan.release,manifestSha:sha(stableJson(manifest)),expectedBase:approval.expectedBase},objects)));
 }else if(action==='rollback'){
  if(approval.expectedBase){const manifest=await releaseManifest(approval.expectedBase);await activateHybridRelease({ownerId:approval.ownerId,release:approval.expectedBase,manifestSha:sha(stableJson(manifest)),expectedBase:plan.release},objects);}
  else await db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(387384)`);const [active]=await rows<{active_release_id:string}>(sql`select active_release_id from dictionary_channels where name='stable' for update`,tx);if(active?.active_release_id!==plan.release)throw Error('release_mismatch');await tx.execute(sql`delete from dictionary_channels where name='stable'`);await tx.execute(sql`insert into dictionary_owner_events(owner_user_id,operation,base_release_id,validation_result) values(${approval.ownerId}::uuid,'rollback_to_uninitialized',${plan.release},'{"pass":true}'::jsonb)`);});
  console.log(JSON.stringify({rolledBack:true,active:approval.expectedBase,immutableObjectsRetained:true}));
 }else{
  if(approval.retire?.release!=='rel-v1-a834010a6ccc72c8b3cd8db9'||!approval.retire.manifestSha)throw Error('explicit_legacy_retirement_plan_required');
  console.log(JSON.stringify(await retireUnusedLegacyIndex({ownerId:approval.ownerId,release:approval.retire.release,expectedActive:plan.release,expectedManifestSha:approval.retire.manifestSha})));
 }
 if(stableJson(await rows(sql`select * from user_vocabulary order by id`))!==stableJson(protectedBefore))throw Error('learner_data_changed');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'dictionary_release_failed');process.exitCode=1;}).finally(()=>db.$client.end());
