import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contentHash, rows } from "./store";
import { encodeShard, manifestKey, previewOf } from "./shards";
import { stableJson, type Entry } from "./model";
import type { DictionaryObjects } from "./object-store";
type Conn = Pick<typeof db,"execute">;

/** Caller owns a bounded DB transaction. R2 writes are conditional and verified first.
 * An interrupted transaction leaves only an unreferenced immutable object; retry is safe. */
export async function writeShard(entries:Entry[], objects:DictionaryObjects, conn:Conn) {
  const release=entries[0]!.release_id;
  const {body,descriptor}=encodeShard(release,entries);
  const {shardKey}=await import("./shards");
  await objects.putImmutable(shardKey(release,descriptor.shard),body);
  const values=entries.map(e=>({release_id:release,lexeme_id:e.lexeme_id,lemma_norm:e.normalized_search_form,part_of_speech:e.part_of_speech,lexical_type:e.lexical_type,content_sha:contentHash(e),storage_shard:descriptor.shard,storage_release:release,search_preview:previewOf(e),sense_ids:e.senses.map(s=>s.sense_id),example_ids:e.senses.flatMap(s=>s.examples.map(x=>x.example_id))}));
  await conn.execute(sql`insert into dictionary_entries(release_id,lexeme_id,lemma_norm,part_of_speech,lexical_type,content_sha,storage_shard,storage_release,search_preview,sense_ids,example_ids) select * from jsonb_to_recordset(${JSON.stringify(values)}::jsonb) as x(release_id text,lexeme_id uuid,lemma_norm text,part_of_speech text,lexical_type text,content_sha text,storage_shard text,storage_release text,search_preview jsonb,sense_ids uuid[],example_ids uuid[]) on conflict(release_id,lexeme_id) do update set payload=null,content_sha=excluded.content_sha,storage_shard=excluded.storage_shard,storage_release=excluded.storage_release,search_preview=excluded.search_preview,sense_ids=excluded.sense_ids,example_ids=excluded.example_ids`);
  await conn.execute(sql`insert into dictionary_r2_shards(release_id,shard,descriptor) values(${release},${descriptor.shard},${JSON.stringify(descriptor)}::jsonb) on conflict(release_id,shard) do update set descriptor=excluded.descriptor where dictionary_r2_shards.descriptor=excluded.descriptor`);
  return descriptor;
}

export async function publishManifest(release:string, manifest:unknown, objects:DictionaryObjects) {
  await objects.putImmutable(manifestKey(release),Buffer.from(stableJson(manifest)));
}
