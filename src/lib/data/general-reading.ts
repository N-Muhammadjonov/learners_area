import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { generalReadingPassages, generalReadingProgress, generalReadingSets, readingPassages, readingQuestions } from "@/db/schema";
import { gradeAnswer } from "@/lib/services/reading/grading";
import { isLive, liveWhere } from "@/lib/services/cms/publication";
import { isStaff, type Role } from "@/lib/auth/roles";
import { getPassageWithQuestions } from "@/lib/data/reading";

/*
 * General Reading = LEARNING (develop reading). IELTS Academic = ASSESSMENT
 * (measure reading). A passage is General only through an explicit row in
 * general_reading_passages (migration 0030); everything else is Academic.
 */

let schemaReady = false;
/**
 * Readiness, not a swallowed failure: before 0030 is applied the tables do not
 * exist, so no General passage can exist either and every passage is Academic —
 * Academic pages keep working on a database that has not been migrated yet.
 * A positive answer is cached for the life of the process (tables are never dropped).
 */
export async function generalReadingSchemaReady(database = db) {
  if (schemaReady) return true;
  const result = await database.execute(sql`select to_regclass('public.general_reading_passages') is not null
    and to_regclass('public.general_reading_sets') is not null and to_regclass('public.general_reading_progress') is not null as ready`);
  schemaReady = result.rows[0]?.ready === true;
  return schemaReady;
}

/** The authoritative mode classification of one passage (server-side truth; never a client flag). */
export async function generalMembership(passageId: string) {
  if (!(await generalReadingSchemaReady())) return null;
  const [row] = await db.select({ setId: generalReadingPassages.setId, passageNo: generalReadingPassages.passageNo, readingMode: generalReadingPassages.readingMode, set: generalReadingSets })
    .from(generalReadingPassages).innerJoin(generalReadingSets, eq(generalReadingSets.id, generalReadingPassages.setId))
    .where(eq(generalReadingPassages.passageId, passageId));
  return row && row.readingMode === "general_practice" ? row : null;
}

/** SQL predicate: this reading_passages row is NOT General (i.e. Academic). Null when 0030 is absent. */
export async function academicOnlyClause() {
  if (!(await generalReadingSchemaReady())) return undefined;
  return sql`not exists (select 1 from general_reading_passages g where g.passage_id = ${readingPassages.id})`;
}

export async function listGeneralSets(userId: string, options: { page?: number; academic?: boolean } = {}, executor: typeof db = db) {
  if (!(await generalReadingSchemaReady(executor))) return [];
  const validPassages = sql`not exists (select 1 from general_reading_passages g join reading_passages p on p.id=g.passage_id where g.set_id=${generalReadingSets.id} and not (p.publication_state='published' or (p.publication_state='scheduled' and p.publish_at<=now())))`;
  const formal = options.academic ? sql`(select count(*) from general_reading_passages g where g.set_id=${generalReadingSets.id})=3
    and not exists (select 1 from general_reading_passages g where g.set_id=${generalReadingSets.id} and g.passage_no not in (1,2,3))
    and not exists (select 1 from general_reading_passages g where g.set_id=${generalReadingSets.id} and not exists (select 1 from reading_questions q where q.passage_id=g.passage_id))` : undefined;
  const sets = await executor.select().from(generalReadingSets)
    .where(and(liveWhere({ publicationState: generalReadingSets.publicationState, publishAt: generalReadingSets.publishAt }), validPassages, formal))
    .orderBy(asc(generalReadingSets.createdAt), asc(generalReadingSets.id))
    .limit(25).offset((Math.max(1, Math.min(10000, Math.floor(options.page ?? 1) || 1)) - 1) * 24);
  if (!sets.length) return [];
  const ids = sets.map((set) => set.id);
  const [slots, progress] = await Promise.all([
    executor.select({ setId: generalReadingPassages.setId, passageNo: generalReadingPassages.passageNo, title: readingPassages.title })
      .from(generalReadingPassages).innerJoin(readingPassages, eq(readingPassages.id, generalReadingPassages.passageId))
      .where(inArray(generalReadingPassages.setId, ids)).orderBy(asc(generalReadingPassages.passageNo)),
    executor.select({ setId: generalReadingProgress.setId, checkedAt: generalReadingProgress.checkedAt })
      .from(generalReadingProgress).where(and(eq(generalReadingProgress.userId, userId), inArray(generalReadingProgress.setId, ids))),
  ]);
  const academicStates = options.academic ? (await executor.execute<{ set_id: string; id: string; status: string }>(sql`
    select distinct on (a.set_id) a.set_id,r.id,r.status from reading_assessments a join reading_attempts r on r.id=a.attempt_id
    where r.user_id=${userId}::uuid and a.set_id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`,`)})
    order by a.set_id, r.started_at desc, r.id desc`)).rows : [];
  return sets.map((set) => ({
    ...(options.academic ? { assessmentStatus: academicStates.find(row => row.set_id === set.id)?.status ?? "not_started", attemptId: academicStates.find(row => row.set_id === set.id)?.id ?? null } : {}),
    id: set.id, title: set.title, description: set.description, level: set.difficultyLevel,
    passages: slots.filter((slot) => slot.setId === set.id).map((slot) => ({ passageNo: slot.passageNo, title: slot.title })),
    started: progress.filter((row) => row.setId === set.id).length,
    checked: progress.filter((row) => row.setId === set.id && row.checkedAt).length,
  }));
}

/** One set with its (up to three) passages, questions, paragraphs and occurrence offsets. */
export async function generalSetDetail(setId: string, role: Role) {
  if (!(await generalReadingSchemaReady())) return null;
  const set = await db.query.generalReadingSets.findFirst({ where: eq(generalReadingSets.id, setId) });
  if (!set || (!isLive(set) && !isStaff(role))) return null;
  const slots = await db.select().from(generalReadingPassages).where(eq(generalReadingPassages.setId, setId)).orderBy(asc(generalReadingPassages.passageNo));
  const passages = [];
  for (const slot of slots) {
    const data = await getPassageWithQuestions(slot.passageId);
    if (data && (isLive(data.passage) || isStaff(role))) passages.push({ passageNo: slot.passageNo, ...data });
  }
  return { set, passages };
}

export async function generalProgress(userId: string, setId: string) {
  return db.select().from(generalReadingProgress).where(and(eq(generalReadingProgress.userId, userId), eq(generalReadingProgress.setId, setId)));
}

/**
 * Save (and optionally check) one passage of a General Reading set for one learner.
 * Progress is per passage, so Passage-only and Full Reading share the same rows:
 * a passage solved alone is already done when the learner later opens Full Reading.
 * Only question ids of THIS passage are accepted; grading uses the Academic grader.
 */
export async function saveGeneralProgress(input: { userId: string; role: Role; passageId: string; answers: Record<string, string>; check: boolean }) {
  const membership = await generalMembership(input.passageId);
  if (!membership || (!isLive(membership.set) && !isStaff(input.role))) return null;
  const questions = await db.query.readingQuestions.findMany({ where: eq(readingQuestions.passageId, input.passageId) });
  const allowed = new Set(questions.map((question) => question.id));
  const answers = Object.fromEntries(Object.entries(input.answers).filter(([id, value]) => allowed.has(id) && typeof value === "string").map(([id, value]) => [id, value.slice(0, 500)]));
  let result: { questionId: string; isCorrect: boolean; correctAnswer: string; evidenceQuote: string | null }[] | null = null;
  let score: number | null = null;
  if (input.check) {
    result = questions.map((question) => ({
      questionId: question.id,
      isCorrect: gradeAnswer(answers[question.id] ?? "", question.correctAnswer, question.acceptedAnswers),
      correctAnswer: question.correctAnswer,
      evidenceQuote: question.evidenceQuote ?? null,
    }));
    score = result.filter((row) => row.isCorrect).length;
  }
  const now = new Date();
  const values = { userId: input.userId, setId: membership.setId, passageId: input.passageId, answers, updatedAt: now,
    ...(input.check ? { score, total: questions.length, checkedAt: now } : {}) };
  const [row] = await db.insert(generalReadingProgress).values(values)
    .onConflictDoUpdate({ target: [generalReadingProgress.userId, generalReadingProgress.passageId], set: values }).returning();
  return { progress: row!, result };
}
