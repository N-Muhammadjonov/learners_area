import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { rows } from "./store";
import { bytesHash, decodeShard, manifestKey, shardDescriptorSchema, shardKey } from "./shards";
import { sha, stableJson } from "./model";
import {workerIndexManifestSchema} from './worker-gateway';
import {decodeIndex,directorySchema,indexBundleSchema,branchPageSchema,indexKey} from './search-index';
import {z} from 'zod';
import type { DictionaryObjects } from "./object-store";

export async function verifyReleaseObjects(release:string, manifest:unknown, objects:DictionaryObjects) {
  const value=manifest as {storage?:{shards:unknown[];search?:unknown}};
  if(!value.storage?.shards.length)throw Error("dictionary_storage_manifest_missing");
  const raw=await objects.read(manifestKey(release),2*1024*1024);
  if(bytesHash(raw)!==sha(stableJson(manifest)))throw Error("manifest_validation_failed");
  for(const descriptor of value.storage.shards) {
    const d=shardDescriptorSchema.parse(descriptor);
    decodeShard(release,d,await objects.read(shardKey(release,d.shard),d.compressed_bytes));
  }
  if(value.storage.search){
    const index=workerIndexManifestSchema.parse(value.storage.search);
    const seen=new Set<string>();let directory:z.infer<typeof directorySchema>|null=null;
    for(const d of index.objects){if(seen.has(d.name))throw Error('index_validation_failed');seen.add(d.name);const raw=decodeIndex(d,await objects.read(indexKey(release,d.name),d.compressed_bytes));const decoded=d.name==='directory'?directorySchema.parse(raw):z.union([directorySchema,indexBundleSchema,branchPageSchema]).parse(raw);if(decoded.release_id!==release)throw Error('index_validation_failed');if(d.name==='directory')directory=decoded as z.infer<typeof directorySchema>;}
    if(!directory||index.directory.name!=='directory'||!index.objects.some(d=>stableJson(d)===stableJson(index.directory))||[...directory.objects,...Object.values(index.routes??{})].some(d=>!index.objects.some(object=>stableJson(object)===stableJson(d))))throw Error('index_validation_failed');
  }

}

/** Explicit release command only; importing never calls this. Network verification
 * precedes the short atomic transaction. Immutable DB records prevent a TOCTOU edit. */
export async function activateHybridRelease(input:{ownerId:string;release:string;manifestSha:string;expectedBase:string|null},objects:DictionaryObjects,conn:Pick<typeof db,"execute"|"transaction">=db) {
  const [candidate]=await rows<{manifest:unknown;manifest_sha:string;state:string}>(sql`select manifest,manifest_sha,state from dictionary_releases where id=${input.release}`,conn);
  if(candidate?.state!=='validated'||candidate.manifest_sha!==input.manifestSha||sha(stableJson(candidate.manifest))!==input.manifestSha)throw Error("manifest_validation_failed");
  await verifyReleaseObjects(input.release,candidate.manifest,objects);
  return conn.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
    const [owner]=await rows(sql`select id from users where id=${input.ownerId}::uuid and role='owner' and account_status='active'`,tx);
    if(!owner)throw Error("active_owner_required");
    const running=await rows(sql`select id from dictionary_publish_jobs where phase not in ('complete','failed')`,tx);if(running.length)throw Error("publish_already_running");
    const [channel]=await rows<{active_release_id:string}>(sql`select active_release_id from dictionary_channels where name='stable' for update`,tx);
    if((channel?.active_release_id??null)!==input.expectedBase)throw Error("release_mismatch");
    if(channel)await tx.execute(sql`update dictionary_channels set previous_release_id=active_release_id,active_release_id=${input.release},updated_at=now() where name='stable'`);
    else await tx.execute(sql`insert into dictionary_channels(name,active_release_id) values('stable',${input.release})`);
    await tx.execute(sql`insert into dictionary_owner_events(owner_user_id,operation,base_release_id,result_release_id,validation_result) values(${input.ownerId}::uuid,'activate_release',${input.expectedBase},${input.release},${JSON.stringify({pass:true,manifestSha:input.manifestSha})}::jsonb)`);
    return {active:input.release,previous:input.expectedBase};
  });
}

/** Failed imports only. Never delete a validated, active, previous, or mapped release.
 * Marking it failed under the lock blocks activation/import before bounded deletion. */
export async function cleanupFailedRelease(release:string,objects:DictionaryObjects,conn:Pick<typeof db,"execute"|"transaction">=db) {
  const assertUnreferenced=async(tx:Pick<typeof db,"execute">)=>{
    const [record]=await rows<{state:string}>(sql`select state from dictionary_releases where id=${release} for update`,tx);
    if(record?.state!=='building'&&record?.state!=='failed')throw Error("cleanup_release_protected");
    const references=await rows(sql`select name from dictionary_channels where active_release_id=${release} or previous_release_id=${release}`,tx);
    const busy=await rows(sql`select id from dictionary_publish_jobs where candidate_release_id=${release} or base_release_id=${release}`,tx);
    if(references.length||busy.length)throw Error("cleanup_release_protected");
  };
  await conn.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(387384)`);await assertUnreferenced(tx);
    // Failed releases cannot be resumed or activated while cleanup is in progress.
    await tx.execute(sql`update dictionary_releases set state='failed' where id=${release}`);
  });
  for(let at=0;at<256;at+=4)await Promise.all(Array.from({length:4},(_,i)=>objects.delete(shardKey(release,(at+i).toString(16).padStart(2,'0')))));
  const [index]=await rows<{descriptor:unknown}>(sql`select descriptor from dictionary_search_indexes where release_id=${release}`,conn);
  if(index)for(const d of workerIndexManifestSchema.parse(index.descriptor).objects)await objects.delete(indexKey(release,d.name));
  await objects.delete(manifestKey(release));
  return conn.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(387384)`);await assertUnreferenced(tx);
    await tx.execute(sql`delete from dictionary_search_terms where release_id=${release}`);
    await tx.execute(sql`delete from dictionary_entries where release_id=${release}`);
    await tx.execute(sql`delete from dictionary_r2_shards where release_id=${release}`);
    await tx.execute(sql`delete from dictionary_search_indexes where release_id=${release}`);
    await tx.execute(sql`delete from dictionary_releases where id=${release}`);
    return {cleaned:release};
  });
}
