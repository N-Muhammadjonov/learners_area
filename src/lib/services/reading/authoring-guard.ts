import "server-only";
import { sql } from "drizzle-orm";
import type { ImportTransaction } from "@/lib/import/core/dry-run";
/** The native editor is for unused drafts only. Revision-owned material always
 * changes through Content OS, and no historical question/answer row is removed. */
export async function readingDraftEditable(tx:ImportTransaction, passageId:string) {
  const result=await tx.execute<{editable:boolean}>(sql`
    select p.publication_state='draft'
      and not exists(select 1 from reading_attempts a where a.passage_id=p.id)
      and not exists(select 1 from reading_assessment_passages a where a.passage_id=p.id)
      and not exists(select 1 from general_reading_progress r where r.passage_id=p.id)
      and not exists(select 1 from content_versions v where v.module='reading' and (
        v.target_id=p.id or v.source_ref=p.source_ref
        or v.content_snapshot->'canonicalPassageIds' @> jsonb_build_array(p.id::text)
        or exists(select 1 from general_reading_passages g where g.passage_id=p.id and g.set_id=v.target_id))) as editable
    from reading_passages p where p.id=${passageId}::uuid for update`);
  return result.rows[0]?.editable === true;
}
