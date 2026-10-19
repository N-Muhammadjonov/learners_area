import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  applyDraft,
  draftSchema,
  entrySchema,
  entryTerms,
  normalizeSearch,
  sha,
  stableJson,
  type Entry,
} from "./model";
import {
  activeRelease,
  contentHash,
  entryById,
  entriesByIds,
  releaseManifest,
  rows,
  writeEntries,
  writeTerms,
} from "./store";
import { verifyReleaseObjects } from "./activation";
import { dictionaryObjects } from "./object-store";
import { writeShard, publishManifest } from "./offload";
type Job = {
  id: string;
  owner_user_id: string;
  base_release_id: string;
  candidate_release_id: string;
  draft_ids: string[];
  phase: string;
  cursor_id: string | null;
  error: string | null;
};
const uuidArray = (ids: string[]) =>
  sql`ARRAY[${sql.join(ids.map(id => sql`${id}::uuid`), sql`,`)}]::uuid[]`;
const lock = sql`select pg_advisory_xact_lock(387384)`;
export async function beginPublish(owner: string) {
  return db.transaction(async (tx) => {
    await tx.execute(lock);
    const busy = await rows<Job>(
      sql`select * from dictionary_publish_jobs where phase not in ('complete','failed')`,
      tx,
    );
    if (busy.length) throw Error("publish_already_running");
    const channel = await activeRelease(tx);
    const drafts = await rows<{
      id: string;
      changes: unknown;
      base_release_id: string;
    }>(
      sql`select id,changes,base_release_id from dictionary_drafts where state='draft' and owner_user_id=${owner}::uuid order by created_at,id for update`,
      tx,
    );
    if (!drafts.length) throw Error("no_drafts");
    if (drafts.length > 100) throw Error("draft_batch_limit");
    if (drafts.some((d) => d.base_release_id !== channel.active_release_id))
      throw Error("stale_draft");
    const [capacity]=await rows<{bytes:string;entries:string;terms:string;releases:number}>(sql`select pg_database_size(current_database())::text bytes,pg_total_relation_size('dictionary_entries')::text entries,pg_total_relation_size('dictionary_search_terms')::text terms,(select count(*)::int from dictionary_releases where state='validated') releases`,tx);
    const quota=Number(process.env.DICTIONARY_DATABASE_LIMIT_BYTES??(process.env.NODE_ENV==="production"?500_000_000:Number.MAX_SAFE_INTEGER));
    const reserve=capacity?(Number(capacity.entries)+Number(capacity.terms))/Math.max(1,capacity.releases):0;
    if(!Number.isFinite(quota)||quota<1||!capacity||Number(capacity.bytes)+reserve+25_000_000>quota)throw Error("dictionary_capacity_exceeded");
    const candidate = `rel-v1-${sha(stableJson({ base: channel.active_release_id, drafts: drafts.map((d) => ({ id: d.id, changes: d.changes })) })).slice(0, 24)}`;
    const exists = await rows(
      sql`select id from dictionary_releases where id=${candidate}`,
      tx,
    );
    if (exists.length) throw Error("candidate_already_exists");
    await tx.execute(
      sql`insert into dictionary_releases(id,base_release_id,state,created_by) values(${candidate},${channel.active_release_id},'building',${owner}::uuid)`,
    );
    const [job] = await rows<Job>(
      sql`insert into dictionary_publish_jobs(owner_user_id,base_release_id,candidate_release_id,draft_ids,phase) values(${owner}::uuid,${channel.active_release_id},${candidate},${uuidArray(drafts.map((d) => d.id))},'copy') returning *`,
      tx,
    );
    await tx.execute(
      sql`insert into dictionary_owner_events(owner_user_id,operation,entity_id,base_release_id,candidate_release_id,validation_result) values(${owner}::uuid,'publish_started',${job!.id},${channel.active_release_id},${candidate},'{"pass":true}'::jsonb)`,
    );
    return job!;
  });
}
/** Durable, idempotent progress. Each owner request processes one bounded chunk;
 * an interrupted browser can resume the persisted job without repeating activation. */
export async function advancePublish(owner: string, jobId: string) {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(lock);
      const [job] = await rows<Job>(
        sql`select * from dictionary_publish_jobs where id=${jobId}::uuid and owner_user_id=${owner}::uuid for update`,
        tx,
      );
      if (!job) throw Error("job_not_found");
      if (["complete", "failed"].includes(job.phase)) return job;
      const channel = await activeRelease(tx);
      if (channel.active_release_id !== job.base_release_id)
        throw Error("release_mismatch");
      const candidate = job.candidate_release_id;
      let next = job.phase,
        cursor = job.cursor_id;
      if (job.phase === "copy") {
        const batch = await rows<{ lexeme_id: string }>(
          sql`select lexeme_id from dictionary_entries where release_id=${job.base_release_id} and (${cursor}::uuid is null or lexeme_id>${cursor}::uuid) order by lexeme_id limit 500`,
          tx,
        );
        if (batch.length) {
          await tx.execute(sql`insert into dictionary_entries(release_id,lexeme_id,lemma_norm,part_of_speech,lexical_type,payload,content_sha,storage_shard,storage_release,search_preview,sense_ids,example_ids) select ${candidate},lexeme_id,lemma_norm,part_of_speech,lexical_type,case when payload is null then null else jsonb_set(payload,'{release_id}',to_jsonb(${candidate}::text)) end,content_sha,storage_shard,storage_release,search_preview,sense_ids,example_ids from dictionary_entries where release_id=${job.base_release_id} and lexeme_id=any(${uuidArray(batch.map(x=>x.lexeme_id))}) on conflict do nothing`);
          cursor = batch.at(-1)!.lexeme_id;
        } else {
          next = "apply";
          cursor = null;
        }
      } else if (job.phase === "apply") {
        const drafts = await rows<{ id: string; changes: unknown }>(
          sql`select id,changes from dictionary_drafts where id=any(${uuidArray(job.draft_ids)}) and state='draft' and owner_user_id=${owner}::uuid order by created_at,id`,
          tx,
        );
        if (drafts.length !== job.draft_ids.length)
          throw Error("draft_set_changed");
        for (const d of drafts) {
          const change = draftSchema.parse(d.changes);
          const existing =
            change.operation === "add_lexeme"
              ? await rows<{ lexeme_id: string }>(
                  sql`select lexeme_id from dictionary_entries where release_id=${candidate} and lemma_norm=${normalizeSearch(change.lemma)} and lexical_type=${change.lexicalType}`,
                  tx,
                )
              : [{ lexeme_id:change.lexemeId }];
          const e = applyDraft(
            [...(await entriesByIds(existing.map(x=>x.lexeme_id),candidate,tx)).values()],
            change,
            candidate,
          );
          await writeEntries([e], tx);
        }
        next = "index";
        cursor = null;
      } else if (job.phase === "index") {
        const batch = await rows<{ lexeme_id: string }>(
          sql`select lexeme_id from dictionary_entries where release_id=${candidate} and (${cursor}::uuid is null or lexeme_id>${cursor}::uuid) order by lexeme_id limit 150`,
          tx,
        );
        if (batch.length) {
          await writeTerms(
            [...(await entriesByIds(batch.map(x=>x.lexeme_id),candidate,tx)).values()],
            tx,
          );
          cursor = batch.at(-1)!.lexeme_id;
        } else {
          next = "validate";
          cursor = null;
        }
      } else if (job.phase === "validate") {
        const batch = await rows<{
          payload: Entry;
          lexeme_id: string;
          content_sha: string;
        }>(
          sql`select payload,lexeme_id,content_sha from dictionary_entries where release_id=${candidate} and (${cursor}::uuid is null or lexeme_id>${cursor}::uuid) order by lexeme_id limit 150`,
          tx,
        );
        if (batch.length) {
          const indexed = await rows<{
            lexeme_id: string;
            direction: "EN" | "UZ";
            term: string;
            rank: number;
          }>(
            sql`select lexeme_id,direction,term,rank from dictionary_search_terms where release_id=${candidate} and lexeme_id=any(${uuidArray(batch.map((x) => x.lexeme_id))})`,
            tx,
          );
          const base = await rows<{ lexeme_id: string }>(
            sql`select lexeme_id from dictionary_entries where release_id=${job.base_release_id} and lexeme_id=any(${uuidArray(batch.map((x) => x.lexeme_id))})`,
            tx,
          );
          const originals=await entriesByIds(base.map(x=>x.lexeme_id),job.base_release_id,tx);
          const hydrated=await entriesByIds(batch.map(x=>x.lexeme_id),candidate,tx);
          for (const row of batch) {
            const entry = entrySchema.parse(hydrated.get(row.lexeme_id));
            if (
              entry.release_id !== candidate ||
              entry.lexeme_id !== row.lexeme_id ||
              contentHash(entry) !== row.content_sha
            )
              throw Error("release_validation_failed");
            const key = (t: {
              direction: string;
              term: string;
              rank: number;
            }) =>
              stableJson({
                direction: t.direction,
                term: t.term,
                rank: t.rank,
              });
            const actual = indexed
              .filter((t) => t.lexeme_id === row.lexeme_id)
              .map(key)
              .sort();
            const expected = entryTerms(entry).map(key).sort();
            if (stableJson(actual) !== stableJson(expected))
              throw Error("index_validation_failed");
            const original = originals.get(row.lexeme_id);
            if (original) {
              if (
                original.display_lemma !== entry.display_lemma ||
                original.part_of_speech !== entry.part_of_speech ||
                original.lexical_type !== entry.lexical_type
              )
                throw Error("source_english_changed");
              for (const old of original.senses) {
                const current = entry.senses.find(
                  (s) => s.sense_id === old.sense_id,
                );
                if (
                  !current ||
                  current.definition_en !== old.definition_en ||
                  old.examples.some(
                    (ex) =>
                      current.examples.find(
                        (x) => x.example_id === ex.example_id,
                      )?.text_en !== ex.text_en,
                  )
                )
                  throw Error("source_english_changed");
              }
            }
          }
          cursor = batch.at(-1)!.lexeme_id;
        } else {
          if(process.env.STORAGE_PROVIDER!=="r2"&&process.env.NODE_ENV!=="production") {
            // Preserve the isolated legacy PostgreSQL bootstrap/owner QA workflow.
            const manifest=await releaseManifest(candidate,tx);
            await tx.execute(sql`update dictionary_releases set state='validated',manifest=${JSON.stringify(manifest)}::jsonb,manifest_sha=${sha(stableJson(manifest))},validated_at=now() where id=${candidate} and state='building'`);
            next="activate";
          }else next = "offload";
          cursor = null;
        }
      } else if (job.phase === "offload") {
        const [first]=await rows<{lexeme_id:string}>(sql`select lexeme_id from dictionary_entries where release_id=${candidate} and (payload is not null or storage_release<>${candidate}) order by lexeme_id limit 1`,tx);
        if(first) {
          const shard=first.lexeme_id.slice(0,2);
          const batch=await rows<{lexeme_id:string}>(sql`select lexeme_id from dictionary_entries where release_id=${candidate} and left(lexeme_id::text,2)=${shard} order by lexeme_id`,tx);
          await writeShard([...(await entriesByIds(batch.map(x=>x.lexeme_id),candidate,tx)).values()],dictionaryObjects(),tx);
        } else {
          const manifest=await releaseManifest(candidate,tx);
          await publishManifest(candidate,manifest,dictionaryObjects());
          await tx.execute(sql`update dictionary_releases set state='validated',manifest=${JSON.stringify(manifest)}::jsonb,manifest_sha=${sha(stableJson(manifest))},validated_at=now() where id=${candidate} and state='building'`);
          next="activate";
        }
      } else if (job.phase === "activate") {
        const [release] = await rows<{
          manifest: unknown;
          manifest_sha: string;
        }>(
          sql`select manifest,manifest_sha from dictionary_releases where id=${candidate} and state='validated'`,
          tx,
        );
        if (
          !release ||
          sha(stableJson(release.manifest)) !== release.manifest_sha
        )
          throw Error("manifest_validation_failed");
        await tx.execute(
          sql`update dictionary_channels set previous_release_id=active_release_id,active_release_id=${candidate},updated_at=now() where name='stable' and active_release_id=${job.base_release_id}`,
        );
        // Only project-owned learner fields change; IDs, source English, SRS and history remain intact.
        await syncMappedLearnerFields(candidate, tx);
        await tx.execute(
          sql`update dictionary_drafts set state='published',result_release_id=${candidate},updated_at=now() where id=any(${uuidArray(job.draft_ids)})`,
        );
        await tx.execute(
          sql`insert into dictionary_owner_events(owner_user_id,operation,entity_id,base_release_id,candidate_release_id,result_release_id,validation_result) values(${owner}::uuid,'publish',${job.id},${job.base_release_id},${candidate},${candidate},'{"pass":true}'::jsonb)`,
        );
        next = "complete";
      }
      const [updated] = await rows<Job>(
        sql`update dictionary_publish_jobs set phase=${next},cursor_id=${cursor}::uuid,updated_at=now() where id=${job.id}::uuid returning *`,
        tx,
      );
      return updated!;
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "publish_failed";
    await db.transaction(async (tx) => {
      await tx.execute(lock);
      await tx.execute(
        sql`update dictionary_publish_jobs set phase='failed',error=${reason.slice(0, 120)},updated_at=now() where id=${jobId}::uuid and owner_user_id=${owner}::uuid and phase not in ('complete','failed')`,
      );
      await tx.execute(
        sql`insert into dictionary_owner_events(owner_user_id,operation,entity_id,validation_result) values(${owner}::uuid,'publish_failed',${jobId},${JSON.stringify({ pass: false, error: reason.slice(0, 120) })}::jsonb)`,
      );
    });
    throw error;
  }
}
type Conn = Pick<typeof db, "execute">;
async function syncMappedLearnerFields(release: string, tx: Conn) {
  const mapped=await rows<{lexeme_id:string;app_sense_id:string;sense_id:string}>(sql`select e.lexeme_id,m.app_sense_id,m.sense_id from dictionary_sense_mappings m join dictionary_entries e on e.release_id=${release} and (m.sense_id=any(e.sense_ids) or (e.sense_ids is null and exists(select 1 from jsonb_array_elements(e.payload->'senses') s where s->>'sense_id'=m.sense_id::text)))`,tx);
  for(let at=0;at<mapped.length;at+=150) {
    const group=mapped.slice(at,at+150),entries=await entriesByIds([...new Set(group.map(x=>x.lexeme_id))],release,tx);
    for(const m of group){const sense=entries.get(m.lexeme_id)?.senses.find(s=>s.sense_id===m.sense_id);if(!sense)throw Error("sense_not_found");await tx.execute(sql`update lexemes set translation_uz=${sense.translations[0]!.text},example_sentence=coalesce(${sense.examples[0]?.text_en??null},example_sentence) where id=${m.app_sense_id}::uuid`);}
  }
}
export async function rollback(owner: string) {
  return db.transaction(async (tx) => {
    await tx.execute(lock);
    const running = await rows(
      sql`select id from dictionary_publish_jobs where phase not in ('complete','failed')`,
      tx,
    );
    if (running.length) throw Error("publish_already_running");
    const channel = await activeRelease(tx);
    if (!channel.previous_release_id)
      throw Error("previous_release_unavailable");
    const [previous] = await rows<{ manifest: unknown; manifest_sha: string }>(
      sql`select manifest,manifest_sha from dictionary_releases where id=${channel.previous_release_id} and state='validated'`,
      tx,
    );
    if (
      !previous ||
      sha(stableJson(previous.manifest)) !== previous.manifest_sha
    )
      throw Error("manifest_validation_failed");
    if ((previous.manifest as {storage?:unknown}).storage) await verifyReleaseObjects(channel.previous_release_id,previous.manifest,dictionaryObjects());
    const rebuilt = await releaseManifest(channel.previous_release_id, tx);
    if (stableJson(rebuilt) !== stableJson(previous.manifest))
      throw Error("release_validation_failed");
    await tx.execute(
      sql`update dictionary_channels set active_release_id=${channel.previous_release_id},previous_release_id=${channel.active_release_id},updated_at=now() where name='stable'`,
    );
    await syncMappedLearnerFields(channel.previous_release_id, tx);
    await tx.execute(
      sql`insert into dictionary_owner_events(owner_user_id,operation,base_release_id,result_release_id,validation_result) values(${owner}::uuid,'rollback',${channel.active_release_id},${channel.previous_release_id},'{"pass":true}'::jsonb)`,
    );
    return {
      active: channel.previous_release_id,
      previous: channel.active_release_id,
    };
  });
}
