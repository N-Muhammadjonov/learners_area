import {buildIndexThread} from './index-thread';
import 'server-only';
import {sql} from 'drizzle-orm';
import {db} from '@/db/client';
import {activeRelease,rows,releaseManifest} from './store';
import {dictionaryObjects} from './object-store';
import {type ShardDescriptor} from './shards';
import {publishManifest} from './offload';
import {sha,stableJson} from './model';
/** Existing publish job, a durable database lease and disposable local spool.
 * Restart resumes the same job and immutable candidate, never a second release.
 * No catalog-sized transaction/global learner lock and no PostgreSQL term clone. */
export async function finishWorkerIndex(owner:string,jobId:string){
 const objects=dictionaryObjects();let lease:string|null=null;
 try{
  const [claimed]=await rows<{worker_lease_token:string}>(sql`update dictionary_publish_jobs set worker_lease_token=gen_random_uuid(),worker_lease_until=now()+interval '45 seconds' where id=${jobId}::uuid and owner_user_id=${owner}::uuid and phase='worker_index' and (worker_lease_until is null or worker_lease_until<now()) returning worker_lease_token`);if(!claimed)return;lease=claimed.worker_lease_token;
  const [job]=await rows<{candidate_release_id:string;base_release_id:string;phase:string}>(sql`select candidate_release_id,base_release_id,phase from dictionary_publish_jobs where id=${jobId}::uuid and owner_user_id=${owner}::uuid`);
  if(!job||job.phase!=='worker_index')return;
  const candidate=job.candidate_release_id,deadline=Date.now()+15*60*1000;let lastCheck=0;
  async function heartbeat(){if(Date.now()>deadline)throw Error('dictionary_index_build_timeout');if(Date.now()-lastCheck<2000)return;lastCheck=Date.now();
   const ok=await rows(sql`update dictionary_publish_jobs j set updated_at=now(),worker_lease_until=now()+interval '45 seconds' from users u,dictionary_channels c where u.id=j.owner_user_id and c.name='stable' and j.id=${jobId}::uuid and j.owner_user_id=${owner}::uuid and j.phase='worker_index' and j.worker_lease_token=${lease}::uuid and j.worker_lease_until>now() and u.role='owner' and u.account_status='active' and c.active_release_id=j.base_release_id returning j.id`);if(!ok.length)throw Error('dictionary_publish_authority_changed');
  }
  await heartbeat();
  const ordered=await rows<{lexeme_id:string}>(sql`select lexeme_id from dictionary_entries where release_id=${candidate} order by lemma_norm,lexeme_id limit 100001`);if(ordered.length>100000||!ordered.length)throw Error('dictionary_index_identity_budget');
  const shards=await rows<{descriptor:ShardDescriptor}>(sql`select descriptor from dictionary_r2_shards where release_id=${candidate} order by shard`);
  const manifest=await buildIndexThread({release:candidate,order:ordered.map(e=>e.lexeme_id),shards:shards.map(s=>s.descriptor)},heartbeat);
  lastCheck=0;await heartbeat();
  await db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
   const channel=await activeRelease(tx);if(channel.active_release_id!==job.base_release_id)throw Error('release_mismatch');
   const [current]=await rows(sql`select 1 from dictionary_publish_jobs j join users u on u.id=j.owner_user_id where j.id=${jobId}::uuid and j.phase='worker_index' and j.worker_lease_token=${lease}::uuid and j.owner_user_id=${owner}::uuid and u.role='owner' and u.account_status='active' for update of j`,tx);if(!current)throw Error('dictionary_publish_authority_changed');
   await tx.execute(sql`insert into dictionary_search_indexes(release_id,descriptor) values(${candidate},${JSON.stringify(manifest)}::jsonb)`);
   const release=await releaseManifest(candidate,tx);await publishManifest(candidate,release,objects);
   await tx.execute(sql`update dictionary_releases set state='validated',manifest=${JSON.stringify(release)}::jsonb,manifest_sha=${sha(stableJson(release))},validated_at=now() where id=${candidate} and state='building'`);
   await tx.execute(sql`update dictionary_publish_jobs set phase='activate',cursor_id=null,worker_lease_token=null,worker_lease_until=null,updated_at=now() where id=${jobId}::uuid and phase='worker_index'`);
  });
 }catch(error){
  const reason=error instanceof Error&&['release_mismatch','dictionary_publish_authority_changed'].includes(error.message)?error.message:'dictionary_index_build_failed';
  const failed=await rows(sql`update dictionary_publish_jobs set phase='failed',error=${reason},worker_lease_token=null,worker_lease_until=null,updated_at=now() where id=${jobId}::uuid and owner_user_id=${owner}::uuid and worker_lease_token=${lease}::uuid and phase='worker_index' returning id`);
  if(failed.length)await db.execute(sql`insert into dictionary_owner_events(owner_user_id,operation,entity_id,validation_result) values(${owner}::uuid,'publish_failed',${jobId},${JSON.stringify({pass:false,error:reason})}::jsonb)`);
 }
}
