import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/** One bounded snapshot per user in the existing event store. Not a learning event.
 * Server clock only; simultaneous tabs share the same row and cannot double time.
 * Hidden/idle clients stop sending; gaps over 90 seconds start a fresh visit. */
export async function heartbeat(userId:string, executor:typeof db=db) {
  return executor.execute(sql`
    insert into activity_events(id,user_id,type,payload,created_at)
    values(md5('site-presence:'||${userId}::text)::uuid,${userId}::uuid,'SITE_PRESENCE',
      jsonb_build_object('since',now(),'visitStartedAt',now(),'visitSeconds',0,'totalSeconds',0),now())
    on conflict(id) do update set created_at=now(),payload=jsonb_build_object(
      'since',activity_events.payload->>'since',
      'visitStartedAt',case when now()-activity_events.created_at>interval '90 seconds' then now()::text else activity_events.payload->>'visitStartedAt' end,
      'visitSeconds',case when now()-activity_events.created_at>interval '90 seconds' then 0 else coalesce((activity_events.payload->>'visitSeconds')::int,0)+least(45,greatest(0,floor(extract(epoch from now()-activity_events.created_at))::int)) end,
      'totalSeconds',coalesce((activity_events.payload->>'totalSeconds')::bigint,0)+case when now()-activity_events.created_at>interval '90 seconds' then 0 else least(45,greatest(0,floor(extract(epoch from now()-activity_events.created_at))::int)) end)
    where activity_events.user_id=${userId}::uuid and activity_events.type='SITE_PRESENCE'
      and activity_events.created_at<=now()-interval '15 seconds'`);
}
