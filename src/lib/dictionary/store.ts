import { dictionaryPos } from "./labels";
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  BASE_RELEASE,
  applyDraft,
  draftSchema,
  entryTerms,
  normalizeSearch,
  sha,
  stableJson,
  type Entry,
} from "./model";
type Conn = Pick<typeof db, "execute">;
export async function rows<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
  conn: Conn = db,
) {
  return (await conn.execute<T>(query)).rows;
}
export const contentHash = (entry: Entry) => {
  const { release_id: release, ...content } = entry;
  void release;
  return sha(stableJson(content));
};
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
  const [r] = await rows<{ payload: Entry }>(
    sql`select payload from dictionary_entries where release_id=${releaseId} and lexeme_id=${lexemeId}::uuid`,
    conn,
  );
  return r?.payload ?? null;
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
  }));
  await conn.execute(
    sql`insert into dictionary_entries select * from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as x(release_id text,lexeme_id uuid,lemma_norm text,part_of_speech text,lexical_type text,payload jsonb,content_sha text) on conflict(release_id,lexeme_id) do update set payload=excluded.payload,content_sha=excluded.content_sha,lemma_norm=excluded.lemma_norm,part_of_speech=excluded.part_of_speech,lexical_type=excluded.lexical_type`,
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
    sql`insert into dictionary_search_terms select * from jsonb_to_recordset(${JSON.stringify(terms)}::jsonb) as x(release_id text,lexeme_id uuid,direction text,term text,rank integer) on conflict(release_id,lexeme_id,direction,term) do update set rank=least(dictionary_search_terms.rank,excluded.rank)`,
  );
}
export async function searchDictionary(
  query: string,
  direction: "EN" | "UZ",
  releaseId: string,
) {
  const norm = normalizeSearch(query);
  if (!norm || norm.length > 80) return [];
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
 select e.lexeme_id,e.payload,h.score from hits h join dictionary_entries e on e.release_id=${releaseId} and e.lexeme_id=h.lexeme_id
 order by h.score,e.lemma_norm,e.lexeme_id limit 20)
 select lexeme_id,payload->>'display_lemma' as display_lemma,payload->>'part_of_speech' as part_of_speech,
 payload#>>'{senses,0,translations,0,text}' as translation_uz,
 case score when 0 then 'exact_lemma' when 1 then 'canonical_normalized' when 2 then 'form' else 'prefix' end as match_type from picked`);
}
export async function recentSearches(userId: string) {
  const release = await activeRelease();
  const history = await rows<{
    query_display: string;
    query_norm: string;
    direction: "EN" | "UZ";
    lexeme_id: string;
    payload: Entry;
  }>(
    sql`select r.query_display,r.query_norm,r.direction,r.lexeme_id,e.payload from dictionary_recent_searches r join dictionary_entries e on e.release_id=${release.active_release_id} and e.lexeme_id=r.lexeme_id where r.user_id=${userId}::uuid order by r.searched_at desc,r.lexeme_id limit 5`,
  );
  return history.map(({ payload, query_norm, ...recent }) => {
    // A UZ query can open any of several English words. Preview a matching
    // translation when present, without claiming an exact occurrence meaning.
    const sense =
      (recent.direction === "UZ"
        ? (payload.senses.find((s) =>
            s.translations.some((t) => normalizeSearch(t.text) === query_norm),
          ) ??
          payload.senses.find((s) =>
            s.translations.some((t) =>
              normalizeSearch(t.text).startsWith(query_norm),
            ),
          ))
        : null) ?? payload.senses[0];
    return {
      ...recent,
      display_lemma: payload.display_lemma,
      part_of_speech: payload.part_of_speech,
      translation_uz: sense?.translations.map((t) => t.text).join(", ") ?? "",
      cefr: sense?.cefr ?? null,
    };
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
    sql`with senses as(select s from dictionary_entries e cross join lateral jsonb_array_elements(e.payload->'senses') s where e.release_id=${release}), examples as(select x from senses cross join lateral jsonb_array_elements(s->'examples') x) select (select count(*)::text from senses) senses,(select string_agg(s->>'sense_id',E'\n' order by s->>'sense_id') from senses) sense_ids,(select count(*)::text from examples) examples,(select string_agg(x->>'example_id',E'\n' order by x->>'example_id') from examples) example_ids`,
    conn,
  );
  const [terms] = await rows<{ count: string }>(
    sql`select count(*)::text as count from dictionary_search_terms where release_id=${release}`,
    conn,
  );
  if (!inventory.length || !totals || !Number(terms?.count))
    throw Error("index_validation_failed");
  const senseIds = (totals.sense_ids ?? "").split("\n").filter(Boolean),
    exampleIds = (totals.example_ids ?? "").split("\n").filter(Boolean);
  if (
    new Set(senseIds).size !== Number(totals.senses) ||
    new Set(exampleIds).size !== Number(totals.examples)
  )
    throw Error("duplicate_identity");
  return {
    schema_version: "learners-area-database-release-v1",
    release_id: release,
    lexemes: inventory.length,
    senses: Number(totals.senses),
    examples: Number(totals.examples),
    search_terms: Number(terms!.count),
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
  const [custom] = await rows<{lexemes: number; senses: number}>(sql`select count(*) filter(where payload->'attribution' @> '[{"source_name":"Learners Area"}]'::jsonb)::int as lexemes, coalesce(sum((select count(*) from jsonb_array_elements(payload->'senses') s where s->>'sense_id' not in (select b->>'sense_id' from dictionary_entries base cross join lateral jsonb_array_elements(base.payload->'senses') b where base.release_id=${BASE_RELEASE} and base.lexeme_id=e.lexeme_id))),0)::int as senses from dictionary_entries e where release_id=${channel.active_release_id}`);
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
      const same = await rows<{ payload: Entry }>(
        sql`select payload from dictionary_entries where release_id=${channel.active_release_id} and lemma_norm=${normalizeSearch(changes.lemma)} and lexical_type=${changes.lexicalType}`,
        tx,
      );
      entry = same.find(row => dictionaryPos(row.payload.part_of_speech) === dictionaryPos(changes.partOfSpeech))?.payload ?? null;
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
