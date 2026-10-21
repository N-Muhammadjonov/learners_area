import { activateReadingSchedules } from "@/lib/services/reading/schedules";
import "server-only";
import { publishedVersionForTarget } from "@/lib/content/attempt-binding";
import { eq, sql, inArray, type SQLWrapper } from "drizzle-orm";
import { academicQuestionSelection, ACADEMIC_105_OMISSIONS } from "@/lib/reading/academic-selection";
import { db } from "@/db/client";
import {
  generalReadingSets,
  readingAttempts,
  readingPassages,
  readingQuestions,
} from "@/db/schema";
import { isLive } from "@/lib/services/cms/publication";
import { academicSetAccess } from "@/lib/data/general-reading";
import { users } from "@/db/schema";

type Conn = Pick<typeof db, "execute">;
export async function academicQuestionSelectionReady(conn: Conn = db) {
  return (await conn.execute<{ready:boolean}>(sql`select to_regclass('public.reading_assessment_questions') is not null as ready`)).rows[0]?.ready === true;
}
/** The same 40-question eligibility rule used by catalogue, detail and Start. */
export function academicQuestionCountClause(setId: SQLWrapper, sourceRef: SQLWrapper) {
  const count=sql`(select count(*) from reading_questions q join general_reading_passages g on g.passage_id=q.passage_id where g.set_id=${setId})`;
  const reviewed=sql.join(ACADEMIC_105_OMISSIONS.map(row=>sql`(${sourceRef}=${row.sourceRef} and exists(select 1 from reading_questions q join reading_passages p on p.id=q.passage_id join general_reading_passages g on g.passage_id=p.id where g.set_id=${setId} and p.external_id=${row.externalId} and q.question_no=${row.questionNo}))`),sql` or `);
  return sql`(${count}=40 or (to_regclass('public.reading_assessment_questions') is not null and ${count}=41 and (${reviewed})))`;
}
/** General learning must not reveal a checked key for an overlapping live exam. */
export async function activeAcademicAttemptForPassages(userId: string, passageIds: string[], executor: Conn = db) {
  if (!passageIds.length) return null;
  const result = await executor.execute<{ id: string }>(sql`
    select a.id from reading_attempts a left join reading_assessment_passages m on m.attempt_id=a.id
    where a.user_id=${userId}::uuid and a.status='in_progress'
      and (a.passage_id in (${sql.join(passageIds.map(id => sql`${id}::uuid`), sql`,`)})
        or m.passage_id in (${sql.join(passageIds.map(id => sql`${id}::uuid`), sql`,`)}))
    order by a.started_at desc,a.id desc limit 1`);
  return result.rows[0]?.id ?? null;
}
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
      questionIds: null as string[] | null,
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
      questionIds: null as string[] | null,
    };
  if (result.rows.length !== 3) throw Error("invalid_assessment_membership");
  const selected = await academicQuestionSelectionReady(conn) ? (await conn.execute<{question_id:string}>(sql`select question_id from reading_assessment_questions where attempt_id=${attemptId}::uuid order by position`)).rows.map(row=>row.question_id) : [];
  if (selected.length && selected.length !== 40) throw Error("invalid_assessment_question_membership");
  return {
    passageIds: result.rows.map((p) => p.passage_id),
    durationMinutes: result.rows[0]!.duration_minutes,
    title: result.rows[0]!.title,
    questionIds: selected.length ? selected : null,
  };
}
export async function startAcademicSet(userId: string, setId: string, executor: typeof db = db) {
  await activateReadingSchedules(executor);
  return executor.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${userId + ":" + setId}))`,
    );
    const user = await tx.query.users.findFirst({where:eq(users.id,userId),columns:{id:true,role:true}});
    if (!user || !(await academicSetAccess(user,setId,tx))) return null;
    const [set] = await tx.select().from(generalReadingSets).where(eq(generalReadingSets.id,setId)).limit(1).for("share");
    if (!set || !isLive(set)) return null;
    const slots = await tx.execute<{ passage_id: string; passage_no: number }>(
      sql`select passage_id,passage_no from general_reading_passages where set_id=${setId}::uuid order by passage_no`,
    );
    if (
      slots.rows.length !== 3 ||
      slots.rows.some((p, i) => p.passage_no !== i + 1)
    )
      return null;
    const allQuestions = await tx.select({id:readingQuestions.id,passageId:readingQuestions.passageId,order:readingQuestions.order,questionNo:readingQuestions.questionNo,externalId:readingPassages.externalId}).from(readingQuestions).innerJoin(readingPassages,eq(readingPassages.id,readingQuestions.passageId)).where(inArray(readingQuestions.passageId,slots.rows.map(s=>s.passage_id)));
    const ready = await academicQuestionSelectionReady(tx);
    if (allQuestions.length !== 40 && !ready) return null;
    const questions = academicQuestionSelection(set.sourceRef,allQuestions)?.sort((a,b)=>slots.rows.findIndex(s=>s.passage_id===a.passageId)-slots.rows.findIndex(s=>s.passage_id===b.passageId)||a.order-b.order);
    if(!questions || slots.rows.some(slot=>!questions.some(q=>q.passageId===slot.passage_id))) return null;
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
    const revision = await publishedVersionForTarget("general_reading_set",setId,tx);
    const [attempt] = await tx
      .insert(readingAttempts)
      .values({ userId, passageId: slots.rows[0]!.passage_id, contentVersionId: revision?.id ?? null })
      .returning();
    await tx.execute(
      sql`insert into reading_assessments(attempt_id,set_id,title) values(${attempt!.id}::uuid,${setId}::uuid,${set.title})`,
    );
    for (const slot of slots.rows)
      await tx.execute(
        sql`insert into reading_assessment_passages(attempt_id,passage_id,passage_no) values(${attempt!.id}::uuid,${slot.passage_id}::uuid,${slot.passage_no})`,
      );
    if (ready) await tx.execute(sql`insert into reading_assessment_questions(attempt_id,question_id,position) values ${sql.join(questions.map((q,i)=>sql`(${attempt!.id}::uuid,${q.id}::uuid,${i+1})`),sql`,`)}`);
    return attempt!.id;
  });
}
