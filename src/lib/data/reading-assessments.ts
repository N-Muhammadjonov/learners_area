import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  generalReadingSets,
  readingAttempts,
  readingPassages,
} from "@/db/schema";
import { isLive } from "@/lib/services/cms/publication";

type Conn = Pick<typeof db, "execute">;
/** Captured passage membership is immutable for an existing assessment. */
export async function assessmentScope(
  attemptId: string,
  fallbackPassage: string,
  conn: Conn = db,
) {
  const ready = await conn.execute(
    sql`select to_regclass('public.reading_assessments') is not null as ready`,
  );
  if (!ready.rows[0]?.ready)
    return {
      passageIds: [fallbackPassage],
      durationMinutes: null,
      title: null,
    };
  const result = await conn.execute<{
    passage_id: string;
    title: string;
    duration_minutes: number;
  }>(
    sql`select p.passage_id,a.title,a.duration_minutes from reading_assessments a join reading_assessment_passages p on p.attempt_id=a.attempt_id where a.attempt_id=${attemptId}::uuid order by p.passage_no`,
  );
  if (!result.rows.length)
    return {
      passageIds: [fallbackPassage],
      durationMinutes: null,
      title: null,
    };
  if (result.rows.length !== 3) throw Error("invalid_assessment_membership");
  return {
    passageIds: result.rows.map((p) => p.passage_id),
    durationMinutes: result.rows[0]!.duration_minutes,
    title: result.rows[0]!.title,
  };
}
export async function startAcademicSet(userId: string, setId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${userId + ":" + setId}))`,
    );
    const set = await tx.query.generalReadingSets.findFirst({
      where: eq(generalReadingSets.id, setId),
    });
    if (!set || !isLive(set)) return null;
    const slots = await tx.execute<{ passage_id: string; passage_no: number }>(
      sql`select passage_id,passage_no from general_reading_passages where set_id=${setId}::uuid order by passage_no`,
    );
    if (
      slots.rows.length !== 3 ||
      slots.rows.some((p, i) => p.passage_no !== i + 1)
    )
      return null;
    for (const slot of slots.rows) {
      const passage = await tx.query.readingPassages.findFirst({
        where: eq(readingPassages.id, slot.passage_id),
      });
      if (!passage || !isLive(passage)) return null;
    }
    const previous = await tx.execute<{ id: string }>(
      sql`select r.id from reading_attempts r join reading_assessments a on a.attempt_id=r.id where r.user_id=${userId}::uuid and a.set_id=${setId}::uuid and r.status='in_progress' order by r.started_at desc limit 1`,
    );
    if (previous.rows[0]) return previous.rows[0].id;
    const [attempt] = await tx
      .insert(readingAttempts)
      .values({ userId, passageId: slots.rows[0]!.passage_id })
      .returning();
    await tx.execute(
      sql`insert into reading_assessments(attempt_id,set_id,title) values(${attempt!.id}::uuid,${setId}::uuid,${set.title})`,
    );
    for (const slot of slots.rows)
      await tx.execute(
        sql`insert into reading_assessment_passages(attempt_id,passage_id,passage_no) values(${attempt!.id}::uuid,${slot.passage_id}::uuid,${slot.passage_no})`,
      );
    return attempt!.id;
  });
}
