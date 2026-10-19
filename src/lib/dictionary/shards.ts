import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { entrySchema, normalizeSearch, stableJson, type Entry } from "./model";

export const MAX_SHARD_COMPRESSED = 2 * 1024 * 1024;
export const MAX_SHARD_RAW = 8 * 1024 * 1024;
export const bytesHash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
export const releasePattern = /^rel-v1-[a-f0-9]{24}$/;
export function shardId(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw Error("invalid_dictionary_identity");
  return id.slice(0, 2).toLowerCase();
}
export function shardKey(release: string, shard: string) {
  if (!releasePattern.test(release) || !/^[a-f0-9]{2}$/.test(shard)) throw Error("invalid_dictionary_key");
  return `dictionary/releases/${release}/shards/${shard}.json.gz`;
}
export function manifestKey(release: string) {
  if (!releasePattern.test(release)) throw Error("invalid_dictionary_key");
  return `dictionary/releases/${release}/manifest.json`;
}
export const shardDescriptorSchema = z.object({
  shard: z.string().regex(/^[a-f0-9]{2}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  raw_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  compressed_bytes: z.number().int().positive().max(MAX_SHARD_COMPRESSED),
  raw_bytes: z.number().int().positive().max(MAX_SHARD_RAW),
  entries: z.number().int().positive().max(2000),
}).strict();
export type ShardDescriptor = z.infer<typeof shardDescriptorSchema>;
export function encodeShard(release: string, entries: Entry[]) {
  if (!entries.length) throw Error("empty_dictionary_shard");
  const shard = shardId(entries[0]!.lexeme_id);
  const seen = new Set<string>();
  for (const entry of entries) {
    entrySchema.parse(entry);
    if (entry.release_id !== release || shardId(entry.lexeme_id) !== shard || seen.has(entry.lexeme_id)) throw Error("dictionary_shard_identity_mismatch");
    seen.add(entry.lexeme_id);
  }
  const raw = Buffer.from(stableJson(entries.toSorted((a,b) => a.lexeme_id.localeCompare(b.lexeme_id))));
  const body = gzipSync(raw, { level: 9 });
  const descriptor = shardDescriptorSchema.parse({shard, sha256:bytesHash(body), raw_sha256:bytesHash(raw), compressed_bytes:body.length, raw_bytes:raw.length, entries:entries.length});
  return {body, descriptor};
}
export function decodeShard(release: string, descriptor: ShardDescriptor, body: Buffer) {
  shardDescriptorSchema.parse(descriptor);
  if (body.length !== descriptor.compressed_bytes || bytesHash(body) !== descriptor.sha256) throw Error("dictionary_shard_checksum_mismatch");
  const raw = gunzipSync(body, { maxOutputLength: MAX_SHARD_RAW });
  if (raw.length !== descriptor.raw_bytes || bytesHash(raw) !== descriptor.raw_sha256) throw Error("dictionary_shard_checksum_mismatch");
  const entries = z.array(entrySchema).max(2000).parse(JSON.parse(raw.toString("utf8")));
  const map = new Map(entries.map(entry => [entry.lexeme_id, entry]));
  if (entries.length !== descriptor.entries || map.size !== entries.length || entries.some(e => e.release_id !== release || shardId(e.lexeme_id) !== descriptor.shard)) throw Error("dictionary_shard_identity_mismatch");
  return map;
}
export const previewOf = (entry: Entry) => ({
  display_lemma: entry.display_lemma,
  custom: entry.attribution.some(a=>a.source_name==="Learners Area"),
  translation_uz: entry.senses[0]?.translations.map(t=>t.text).join(", ")??"",
  uz_terms:[...new Map(entry.senses.flatMap(s=>s.translations.map(t=>[normalizeSearch(t.text),{text:t.text,norm:normalizeSearch(t.text)}] as const))).values()],
});
