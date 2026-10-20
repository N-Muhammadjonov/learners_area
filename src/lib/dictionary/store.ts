import {indexDescriptorSchema} from './search-index';
import { dictionaryPos } from "./labels";
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  BASE_RELEASE,
  applyDraft,
  draftSchema,
  entryTerms,
  entryContentHash,
  normalizeSearch,
  sha,
  stableJson,
  type Entry,
} from "./model";
import { previewOf, shardDescriptorSchema, type ShardDescriptor } from "./shards";
import { DictionaryShardCache } from "./shard-cache";
import { dictionaryObjects } from "./object-store";
import {dictionaryWorker,workerEntry,workerIndexManifestSchema} from './worker-gateway';
type Conn = Pick<typeof db, "execute">;
let shardCache: DictionaryShardCache | undefined;
export async function entriesByIds(ids: string[], releaseId: string, conn: Conn = db) {
  if (!ids.length) return new Map<string, Entry>();
  if (ids.length > 500) throw Error("dictionary_batch_limit");
  const found = await rows<{lexeme_id:string;payload:Entry|null;storage_shard:string|null;storage_release:string|null;content_sha:string;worker_release:string|null;shard_descriptor:ShardDescriptor|null;target_state:string;storage_offset:number|null;storage_length:number|null;storage_raw_bytes:number|null}>(sql`select e.lexeme_id,e.payload,e.storage_shard,e.storage_release,e.content_sha,i.release_id worker_release,s.descriptor shard_descriptor,t.state target_state,e.storage_offset,e.storage_length,e.storage_raw_bytes from dictionary_entries e join dictionary_releases t on t.id=e.release_id left join dictionary_search_indexes i on i.release_id=e.storage_release left join dictionary_r2_shards s on s.release_id=e.storage_release and s.shard=e.storage_shard where e.release_id=${releaseId} and e.lexeme_id=any(ARRAY[${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)}]::uuid[])`,conn);
  const result = new Map<string,Entry>();
  const groups = new Map<string,typeof found>();
  const workerRows=found.filter(r=>r.worker_release&&!r.payload&&ids.length<=20);
  for(let at=0;at<workerRows.length;at+=4)await Promise.all(workerRows.slice(at,at+4).map(async row=>{
    if(!row.storage_release||!row.shard_descriptor||(row.target_state==='validated'&&row.storage_release!==releaseId))throw Error('manifest_validation_failed');
    const entry=await workerEntry(row.storage_release,row.lexeme_id,shardDescriptorSchema.parse(row.shard_descriptor),row.storage_offset===null?undefined:{offset:row.storage_offset,length:row.storage_length!,raw_bytes:row.storage_raw_bytes!},row.content_sha);
    if(!entry||contentHash(entry)!==row.content_sha)throw Error('dictionary_entry_checksum_mismatch');result.set(row.lexeme_id,row.storage_release===releaseId?entry:{...entry,release_id:releaseId});
  }));
  for (const row of found.filter(r=>!r.worker_release||r.payload||ids.length>20)) {
    if (row.payload) result.set(row.lexeme_id,row.payload);
    else if (row.storage_shard) {const key=row.storage_release+":"+row.storage_shard;const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
    else throw Error("dictionary_storage_unavailable");
  }
  if(groups.size) {
    const list=[...groups];
    shardCache??=new DictionaryShardCache(dictionaryObjects());
    const releases=new Map<string,{manifest:{storage?:{shards:ShardDescriptor[]}};manifest_sha:string;state:string}>();
    for(const source of new Set(found.filter(r=>r.storage_release).map(r=>r.storage_release!))) {
      const [release]=await rows<{manifest:{storage?:{shards:ShardDescriptor[]}};manifest_sha:string;state:string}>(sql`select manifest,manifest_sha,state from dictionary_releases where id=${source}`,conn);
      if(!release?.manifest?.storage || sha(stableJson(release.manifest))!==release.manifest_sha) {
        // Only a building candidate may read its own already written shards.
        if(source!==releaseId||release?.state!=='building')throw Error("manifest_validation_failed");
        const descriptors=await rows<{descriptor:ShardDescriptor}>(sql`select descriptor from dictionary_r2_shards where release_id=${source}`,conn);
        releases.set(source,{...release,manifest:{storage:{shards:descriptors.map(x=>x.descriptor)}}});
      }else releases.set(source,release);
    }
    const [target]=await rows<{state:string}>(sql`select state from dictionary_releases where id=${releaseId}`,conn);
    for(let at=0;at<list.length;at+=4) await Promise.all(list.slice(at,at+4).map(async([,group])=>{
      const source=group[0]!.storage_release!;
      if(target?.state==='validated'&&source!==releaseId)throw Error("manifest_validation_failed");
      const descriptor=shardDescriptorSchema.parse(releases.get(source)!.manifest.storage!.shards.find(x=>x.shard===group[0]!.storage_shard));
      const entries=await shardCache!.get(source,descriptor);
      for(const row of group) {const original=entries.get(row.lexeme_id);if(!original||contentHash(original)!==row.content_sha)throw Error("dictionary_entry_checksum_mismatch");result.set(row.lexeme_id,source===releaseId?original:{...original,release_id:releaseId});}
    }));
  }
  return result;
}
export async function rows<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
  conn: Conn = db,
) {
  return (await conn.execute<T>(query)).rows;
}
export const contentHash = entryContentHash;

export async function activeRelease(conn: Conn = db) {
  const [r] = await rows<{
    active_release_id: string;
    previous_release_id: string | null;
  }>(
    sql`select active_release_id,previous_release_id from dictionary_channels where name='stable'`,
    conn,
  );
  if (!r) throw Error("dictionary_unavailable");
  return r;
}
export async function pinnedRelease(id?: string | null, conn: Conn = db) {
  const active = await activeRelease(conn);
  if (id && id !== active.active_release_id) throw Error("release_mismatch");
  return active.active_release_id;
}
export async function entryById(
  lexemeId: string,
  releaseId: string,
  conn: Conn = db,
) {
  return (await entriesByIds([lexemeId],releaseId,conn)).get(lexemeId) ?? null;
}

export async function writeEntries(entries: Entry[], conn: Conn = db) {
  if (!entries.length) return;
  const payload = entries.map((e) => ({
    release_id: e.release_id,
    lexeme_id: e.lexeme_id,
    lemma_norm: normalizeSearch(e.display_lemma),
    part_of_speech: e.part_of_speech,
    lexical_type: e.lexical_type,
    payload: e,
    content_sha: contentHash(e),
    is_custom:e.attribution.some(a=>a.source_name==="Learners Area"),
    search_preview: previewOf(e),
    sense_ids:e.senses.map(s=>s.sense_id),
    example_ids:e.senses.flatMap(s=>s.examples.map(x=>x.example_id)),
  }));
  await conn.execute(
    sql`insert into dictionary_entries(release_id,lexeme_id,lemma_norm,part_of_speech,lexical_type,payload,content_sha,is_custom,search_preview,sense_ids,example_ids) select * from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as x(release_id text,lexeme_id uuid,lemma_norm text,part_of_speech text,lexical_type text,payload jsonb,content_sha text,is_custom boolean,search_preview jsonb,sense_ids uuid[],example_ids uuid[]) on conflict(release_id,lexeme_id) do update set payload=excluded.payload,content_sha=excluded.content_sha,is_custom=excluded.is_custom,lemma_norm=excluded.lemma_norm,part_of_speech=excluded.part_of_speech,lexical_type=excluded.lexical_type,search_preview=excluded.search_preview,sense_ids=excluded.sense_ids,example_ids=excluded.example_ids,storage_shard=null,storage_release=null,storage_offset=null,storage_length=null,storage_raw_bytes=null`,
  );
}
export async function writeTerms(entries: Entry[], conn: Conn = db) {
  const terms = entries.flatMap((e) =>
    entryTerms(e).map((t) => ({
      release_id: e.release_id,
      lexeme_id: e.lexeme_id,
      ...t,
    })),
  );
  if (!terms.length) return;
  await conn.execute(
    sql`insert into dictionary_search_terms select * from jsonb_to_recordset(${JSON.stringify(terms)}::jsonb) as x(release_id text,lexeme_id uuid,direction text,term text,rank integer) on conflict(release_id,lexeme_id,direction,term) do update set rank=least(dictionary_search_terms.rank,excluded.rank) where dictionary_search_terms.rank>excluded.rank`,
  );
}
export async function searchDictionary(
  query: string,
  direction: "EN" | "UZ",
  releaseId: string,
  conn: Conn = db,
) {
  const norm = normalizeSearch(query);
  if (!norm || norm.length > 80) return [];
  const initial=direction+':'+norm.slice(0,1);
  const [worker]=await rows<{directory:unknown}>(sql`select coalesce(descriptor->'routes'->${initial},descriptor->'routes'->${direction+':*'},case when descriptor->'routes' is null then descriptor->'directory' end) directory from dictionary_search_indexes where release_id=${releaseId}`,conn);
  if(worker&&!worker.directory)return [];
  if(worker){const directory=indexDescriptorSchema.parse(worker.directory);return await dictionaryWorker({action:'search',release:releaseId,directory,query,direction}) as {lexeme_id:string;display_lemma:string;part_of_speech:string;translation_uz:string;match_type:string}[];}
  const prefix = norm.replace(/[\\%_]/g, "\\$&") + "%";
  return rows<{
    lexeme_id: string;
    display_lemma: string;
    part_of_speech: string;
    translation_uz: string;
    match_type: string;
  }>(sql`
 with hits as (select lexeme_id,min(case when term=${norm} then rank else 3 end) as score
 from dictionary_search_terms where release_id=${releaseId} and direction=${direction} and term like ${prefix} escape '\\' group by lexeme_id), picked as (
 select e.lexeme_id,e.payload,e.search_preview,e.part_of_speech,h.score from hits h join dictionary_entries e on e.release_id=${releaseId} and e.lexeme_id=h.lexeme_id
 order by h.score,e.lemma_norm,e.lexeme_id limit 20)
 select lexeme_id,coalesce(search_preview->>'display_lemma',payload->>'display_lemma') as display_lemma,part_of_speech,
 coalesce(case when ${direction}='UZ' then (select t->>'text' from jsonb_array_elements(search_preview->'uz_terms') t where t->>'norm' like ${prefix} escape '\\' order by case when t->>'norm'=${norm} then 0 else 1 end,t->>'norm' limit 1) end,search_preview->>'translation_uz',payload#>>'{senses,0,translations,0,text}') as translation_uz,
 case score when 0 then 'exact_lemma' when 1 then 'canonical_normalized' when 2 then 'form' else 'prefix' end as match_type from picked`,conn);
}
export async function recentSearches(userId: string, conn: Conn = db) {
  const release = await activeRelease(conn);
  const history = await rows<{query_display:string;query_norm:string;direction:"EN"|"UZ";lexeme_id:string}>(sql`select r.query_display,r.query_norm,r.direction,r.lexeme_id from dictionary_recent_searches r join dictionary_entries e on e.release_id=${release.active_release_id} and e.lexeme_id=r.lexeme_id where r.user_id=${userId}::uuid order by r.searched_at desc,r.lexeme_id limit 5`,conn);
  const entries=await entriesByIds(history.map(r=>r.lexeme_id),release.active_release_id,conn);
  return history.flatMap(({query_norm,...recent})=>{
    const payload=entries.get(recent.lexeme_id);if(!payload)return [];
    const sense=(recent.direction==='UZ' ? (payload.senses.find(s=>s.translations.some(t=>normalizeSearch(t.text)===query_norm)) ?? payload.senses.find(s=>s.translations.some(t=>normalizeSearch(t.text).startsWith(query_norm)))) : null) ?? payload.senses[0];
    return [{...recent,display_lemma:payload.display_lemma,part_of_speech:payload.part_of_speech,translation_uz:sense?.translations.map(t=>t.text).join(', ')??'',cefr:sense?.cefr??null}];
  });
}

export async function clearRecentSearches(userId: string) {
  await db.execute(
    sql`delete from dictionary_recent_searches where user_id=${userId}::uuid`,
  );
}
export async function rememberSearch(
  userId: string,
  query: string,
  direction: "EN" | "UZ",
  lexemeId: string,
) {
  const norm = normalizeSearch(query);
  if (!norm || norm.length > 80) return;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from users where id=${userId}::uuid for update`,
    );
    await tx.execute(
      sql`insert into dictionary_recent_searches(user_id,direction,query_norm,query_display,lexeme_id) values(${userId}::uuid,${direction},${norm},${query.slice(0, 80)},${lexemeId}::uuid) on conflict(user_id,lexeme_id) do update set direction=excluded.direction,query_norm=excluded.query_norm,query_display=excluded.query_display,searched_at=now()`,
    );
    await tx.execute(
      sql`delete from dictionary_recent_searches where user_id=${userId}::uuid and lexeme_id not in (select lexeme_id from dictionary_recent_searches where user_id=${userId}::uuid order by searched_at desc,lexeme_id limit 5)`,
    );
  });
}
export async function releaseManifest(release: string, conn: Conn = db) {
  const inventory = await rows<{ lexeme_id: string; content_sha: string }>(
    sql`select lexeme_id,content_sha from dictionary_entries where release_id=${release} order by lexeme_id`,
    conn,
  );
  const [totals] = await rows<{
    senses: string;
    sense_ids: string;
    example_ids: string;
    examples: string;
  }>(
    sql`with senses as(select unnest(coalesce(e.sense_ids,ARRAY(select (s->>'sense_id')::uuid from jsonb_array_elements(e.payload->'senses') s)))::text id from dictionary_entries e where release_id=${release}), examples as(select unnest(coalesce(e.example_ids,ARRAY(select (x->>'example_id')::uuid from jsonb_array_elements(e.payload->'senses') s cross join lateral jsonb_array_elements(s->'examples') x)))::text id from dictionary_entries e where release_id=${release}) select (select count(*)::text from senses) senses,(select string_agg(id,E'\n' order by id) from senses) sense_ids,(select count(*)::text from examples) examples,(select string_agg(id,E'\n' order by id) from examples) example_ids`,
    conn,
  );
  const [terms] = await rows<{ count: string }>(
    sql`select count(*)::text as count from dictionary_search_terms where release_id=${release}`,
    conn,
  );
  const [worker]=await rows<{descriptor:unknown}>(sql`select descriptor from dictionary_search_indexes where release_id=${release}`,conn);
  const search=worker?workerIndexManifestSchema.parse(worker.descriptor):null;
  if (!inventory.length || !totals || (!search&&!Number(terms?.count)))
    throw Error("index_validation_failed");
  const senseIds = (totals.sense_ids ?? "").split("\n").filter(Boolean),
    exampleIds = (totals.example_ids ?? "").split("\n").filter(Boolean);
  if (
    new Set(senseIds).size !== Number(totals.senses) ||
    new Set(exampleIds).size !== Number(totals.examples)
  )
    throw Error("duplicate_identity");
  const shards=await rows<{descriptor:ShardDescriptor}>(sql`select descriptor from dictionary_r2_shards where release_id=${release} order by shard`,conn);
  return {
    ...(shards.length ? {storage:{version:1,shards:shards.map(x=>shardDescriptorSchema.parse(x.descriptor)),...(search?{search}:{})}} : {}),
    schema_version: "learners-area-database-release-v1",
    release_id: release,
    lexemes: inventory.length,
    senses: Number(totals.senses),
    examples: Number(totals.examples),
    search_terms: search?.logicalTerms??Number(terms!.count),
    entry_inventory_sha256: sha(
      inventory.map((x) => `${x.lexeme_id}:${x.content_sha}`).join("\n"),
    ),
    sense_set_sha256: sha(JSON.stringify(senseIds)),
    example_set_sha256: sha(JSON.stringify(exampleIds)),
    normalization_version:
      "unicode-nfkc-casefold-apostrophe-hyphen-whitespace-v1",
  };
}
export async function summary() {
  const channel = await activeRelease();
  const [release] = await rows(
    sql`select id,state,manifest,manifest_sha,validated_at from dictionary_releases where id=${channel.active_release_id}`,
  );
  const [drafts] = await rows(
    sql`select count(*)::int as count from dictionary_drafts where state='draft'`,
  );
  const [baseline]=await rows<{id:string;manifest:{lexemes:number;senses:number}}>(sql`select id,manifest from dictionary_releases where id in (${BASE_RELEASE},'rel-v1-a834010a6ccc72c8b3cd8db9') and state in ('validated','retired') order by case when id=${BASE_RELEASE} then 0 else 1 end limit 1`);
  const manifest=release?.manifest as {lexemes:number;senses:number;storage?:{search?:unknown}}|undefined;
  const [custom] = manifest?.storage?.search?await rows<{lexemes:number;senses:number}>(sql`select count(*) filter(where is_custom)::int lexemes,${Math.max(0,manifest.senses-(baseline?.manifest.senses??0))}::int senses from dictionary_entries where release_id=${channel.active_release_id}`):await rows<{lexemes:number;senses:number}>(sql`select count(*) filter(where coalesce((search_preview->>'custom')::boolean,payload->'attribution' @> '[{"source_name":"Learners Area"}]'::jsonb))::int lexemes, coalesce(sum((select count(*) from unnest(coalesce(e.sense_ids,ARRAY(select (s->>'sense_id')::uuid from jsonb_array_elements(e.payload->'senses') s))) id where id not in (select unnest(coalesce(b.sense_ids,ARRAY(select (s->>'sense_id')::uuid from jsonb_array_elements(b.payload->'senses') s))) from dictionary_entries b where b.release_id=${baseline?.id??BASE_RELEASE} and b.lexeme_id=e.lexeme_id))),0)::int senses from dictionary_entries e where release_id=${channel.active_release_id}`);
  const [published] = await rows(sql`select created_at from dictionary_owner_events where result_release_id=${channel.active_release_id} and operation in ('activate_release','rollback_release') order by created_at desc limit 1`);
  return { channel, release, drafts: drafts?.count ?? 0, custom: custom ?? {lexemes:0,senses:0}, published_at: published?.created_at ?? release?.validated_at, index_state: release?.state === 'validated' ? 'validated' : 'pending' };
}
export async function saveDraft(ownerId: string, input: unknown) {
  const changes = draftSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
    const channel = await activeRelease(tx);
    let entry: Entry | null = null;
    if (changes.operation !== "add_lexeme")
      entry = await entryById(changes.lexemeId, channel.active_release_id, tx);
    else {
      const same = await rows<{ lexeme_id: string }>(
        sql`select lexeme_id from dictionary_entries where release_id=${channel.active_release_id} and lemma_norm=${normalizeSearch(changes.lemma)} and lexical_type=${changes.lexicalType}`,
        tx,
      );
      entry = [...(await entriesByIds(same.map(row=>row.lexeme_id),channel.active_release_id,tx)).values()].find(row=>dictionaryPos(row.part_of_speech)===dictionaryPos(changes.partOfSpeech)) ?? null;
    }
    applyDraft(entry ? [entry] : [], changes, channel.active_release_id);
    const [draft] = await rows<{ id: string }>(
      sql`insert into dictionary_drafts(owner_user_id,base_release_id,changes) values(${ownerId}::uuid,${channel.active_release_id},${JSON.stringify(changes)}::jsonb) returning id`,
      tx,
    );
    await tx.execute(
      sql`insert into dictionary_owner_events(owner_user_id,operation,entity_id,base_release_id,before_state,after_state,validation_result) values(${ownerId}::uuid,${changes.operation},${draft!.id},${channel.active_release_id},${JSON.stringify(entry)}::jsonb,${JSON.stringify(changes)}::jsonb,'{"pass":true}'::jsonb)`,
    );
    return draft;
  });
}
