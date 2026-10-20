import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/** A deletion is separate from the reversible publication archive. Source rows
 * remain only so historical results keep their original question/title links. */
export function notDeleted(id: AnyColumn | SQL): SQL {
  return sql`not exists (select 1 from activity_events deleted_content
    where deleted_content.id=md5('deleted-content:' || (${id})::text)::uuid
      and deleted_content.type='CONTENT_DELETED')`;
}
