import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { publishContentVersion } from "@/lib/content/authoring";

/** Apply owner-authorized Reading schedules before catalogue/start reads.
 * Uses the existing Content OS publisher (including old-target withdrawal), never
 * a second publication engine. Each transaction reads at most 100 due revisions;
 * no passage catalogue is loaded or post-filtered. Unversioned legacy schedules
 * retain their existing publication-window rule. Other modules are untouched.
 */
export async function activateReadingSchedules(executor: typeof db = db, now = new Date()) {
  for (;;) {
    const processed = await executor.transaction(async tx => {
      const candidates = await tx.execute<{id:string;source_ref:string;content_type:string;version_no:number}>(sql`
        select v.id,v.source_ref,v.content_type,v.version_no from content_versions v
        where v.module='reading' and v.publication_state='scheduled' and (
          exists(select 1 from general_reading_sets s where s.id=v.target_id and s.publish_at<=${now}) or
          exists(select 1 from reading_passages p where p.id=v.target_id and p.publish_at<=${now}))
        order by v.source_ref,v.content_type,v.version_no desc,v.id limit 100`);
      for (const candidate of candidates.rows) {
        // Same source lock as the existing Reading publisher. Recheck after waiting
        // so concurrent requests cannot republish or downgrade a newer revision.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"reading-version:"+candidate.source_ref}))`);
        const current = await tx.execute<{publication_state:string}>(sql`select publication_state from content_versions where id=${candidate.id}::uuid`);
        if (current.rows[0]?.publication_state !== 'scheduled') continue;
        const newer = await tx.execute(sql`select id from content_versions where module='reading' and content_type=${candidate.content_type}
          and source_ref=${candidate.source_ref} and status='published' and version_no>${candidate.version_no} limit 1`);
        const result = await publishContentVersion(tx, {
          actor:{id:'',role:'system',mayPublish:true}, versionId:candidate.id,
          to:newer.rows.length ? 'archived' : 'published',
        });
        if (!result.ok) throw new Error(`reading_schedule_publication_failed:${candidate.id}`);
      }
      return candidates.rows.length;
    });
    if (processed < 100) return;
  }
}
