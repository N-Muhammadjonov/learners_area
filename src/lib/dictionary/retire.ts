import 'server-only';
import {sql} from 'drizzle-orm';
import {db} from '@/db/client';
import {rows} from './store';
/** Explicit reviewed operator action only. Never retire the active/rollback
 * release, an in-flight job, or a shard source borrowed by another release.
 * Manifest and immutable R2 objects remain recoverable; learner rows are untouched. */
export async function retireUnusedLegacyIndex(input:{ownerId:string;release:string;expectedActive:string;expectedManifestSha:string},conn:Pick<typeof db,'execute'|'transaction'>=db){
 return conn.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
  const [owner]=await rows(sql`select 1 from users where id=${input.ownerId}::uuid and role='owner' and account_status='active'`,tx);if(!owner)throw Error('active_owner_required');
  const [channel]=await rows<{active_release_id:string;previous_release_id:string|null;delivery:string}>(sql`select c.active_release_id,c.previous_release_id,r.delivery from dictionary_channels c join dictionary_releases r on r.id=c.active_release_id where c.name='stable' and r.state='validated' for update of c`,tx);
  if(channel?.active_release_id!==input.expectedActive||channel.delivery!=='r2-worker-v1')throw Error('release_mismatch');
  if(input.release===channel.active_release_id||input.release===channel.previous_release_id)throw Error('retirement_release_protected');
  const references=await rows(sql`select 1 from dictionary_publish_jobs where (phase not in ('complete','failed') or candidate_release_id=${input.release} or base_release_id=${input.release}) union all select 1 from dictionary_entries where storage_release=${input.release} and release_id<>${input.release} limit 1`,tx);if(references.length)throw Error('retirement_release_protected');
  const [release]=await rows<{state:string;delivery:string;manifest_sha:string}>(sql`select state,delivery,manifest_sha from dictionary_releases where id=${input.release} for update`,tx);
  if(!release||release.manifest_sha!==input.expectedManifestSha||release.delivery!=='legacy'||!['validated','retired'].includes(release.state))throw Error('retirement_manifest_mismatch');
  const missing=await rows(sql`select 1 from dictionary_sense_mappings m join dictionary_entries old on old.release_id=${input.release} and m.sense_id=any(old.sense_ids) where not exists(select 1 from dictionary_entries current where current.release_id=${input.expectedActive} and m.sense_id=any(current.sense_ids)) limit 1`,tx);if(missing.length)throw Error('retirement_mapped_sense_missing');
  const [counts]=await rows<{entries:number;terms:number}>(sql`select (select count(*)::int from dictionary_entries where release_id=${input.release}) entries,(select count(*)::int from dictionary_search_terms where release_id=${input.release}) terms`,tx);
  if(release.state==='retired')return {retired:input.release,active:input.expectedActive,removed:counts,objectsRetained:true,alreadyRetired:true};
  await tx.execute(sql`update dictionary_releases set state='retired' where id=${input.release}`);
  await tx.execute(sql`delete from dictionary_search_terms where release_id=${input.release}`);
  await tx.execute(sql`delete from dictionary_entries where release_id=${input.release}`);
  await tx.execute(sql`delete from dictionary_r2_shards where release_id=${input.release}`);
  const [remaining]=await rows<{n:number}>(sql`select count(*)::int n from dictionary_search_terms`,tx);
  // Release the obsolete index's allocated pages only when no release uses it.
  // A retained previous legacy release leaves its rows and pages intact.
  if(remaining?.n===0)await tx.execute(sql`truncate dictionary_search_terms`);
  await tx.execute(sql`insert into dictionary_owner_events(owner_user_id,operation,base_release_id,result_release_id,validation_result) values(${input.ownerId}::uuid,'retire_unused_legacy',${input.release},${input.expectedActive},${JSON.stringify({pass:true,manifestSha:input.expectedManifestSha,removed:counts,objectsRetained:true})}::jsonb)`);
  return {retired:input.release,active:input.expectedActive,removed:counts,objectsRetained:true};
 });
}
