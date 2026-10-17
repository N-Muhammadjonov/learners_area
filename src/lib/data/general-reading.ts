import { activateReadingSchedules } from "@/lib/services/reading/schedules";
import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { generalReadingPassages, generalReadingProgress, generalReadingSets, readingPassages, readingQuestions, readingQuestionGroups } from "@/db/schema";
import { gradeReadingQuestion } from "@/lib/reading/question-model";
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
export async function generalMembership(passageId: string, executor: typeof db = db) {
  if (!(await generalReadingSchemaReady(executor))) return null;
  const [row] = await executor.select({ setId: generalReadingPassages.setId, passageNo: generalReadingPassages.passageNo, readingMode: generalReadingPassages.readingMode, set: generalReadingSets })
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
  await activateReadingSchedules(executor);
  const validPassages = sql`not exists (select 1 from general_reading_passages g join reading_passages p on p.id=g.passage_id where g.set_id=${generalReadingSets.id} and not (p.publication_state='published' or (p.publication_state='scheduled' and p.publish_at<=now())))`;
  const formal = options.academic ? sql`(select count(*) from general_reading_passages g where g.set_id=${generalReadingSets.id})=3
    and not exists (select 1 from general_reading_passages g where g.set_id=${generalReadingSets.id} and g.passage_no not in (1,2,3))
    and not exists (select 1 from general_reading_passages g where g.set_id=${generalReadingSets.id} and not exists (select 1 from reading_questions q where q.passage_id=g.passage_id))
    and (select count(*) from reading_questions q join general_reading_passages g on g.passage_id=q.passage_id where g.set_id=${generalReadingSets.id})=40` : undefined;
  const sets = await executor.select().from(generalReadingSets)
    .where(and(liveWhere({ publicationState: generalReadingSets.publicationState, publishAt: generalReadingSets.publishAt }), validPassages, formal))
    .orderBy(asc(generalReadingSets.createdAt), asc(generalReadingSets.id))
    .limit(25).offset((Math.max(1, Math.min(10000, Math.floor(options.page ?? 1) || 1)) - 1) * 24);
  if (!sets.length) return [];
  const ids = sets.map((set) => set.id);
  const [slots, progress, academicResult] = await Promise.all([
    executor.select({ setId: generalReadingPassages.setId, passageNo: generalReadingPassages.passageNo, title: readingPassages.title })
      .from(generalReadingPassages).innerJoin(readingPassages, eq(readingPassages.id, generalReadingPassages.passageId))
      .where(inArray(generalReadingPassages.setId, ids)).orderBy(asc(generalReadingPassages.passageNo)),
    executor.select({ setId: generalReadingProgress.setId, checkedAt: generalReadingProgress.checkedAt })
      .from(generalReadingProgress).where(and(eq(generalReadingProgress.userId, userId), inArray(generalReadingProgress.setId, ids))),
    options.academic ? executor.execute<{ set_id: string; id: string; status: string }>(sql`
    select distinct on (a.set_id) a.set_id,r.id,r.status from reading_assessments a join reading_attempts r on r.id=a.attempt_id
    where r.user_id=${userId}::uuid and a.set_id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`,`)})
    order by a.set_id, r.started_at desc, r.id desc`) : Promise.resolve({ rows: [] }),
  ]);
  const academicStates = academicResult.rows;
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
  await activateReadingSchedules();
  if (!(await generalReadingSchemaReady())) return null;
  const set = await db.query.generalReadingSets.findFirst({ where: eq(generalReadingSets.id, setId) });
  if (!set || (!isLive(set) && !isStaff(role))) return null;
  const slots = await db.select().from(generalReadingPassages).where(eq(generalReadingPassages.setId, setId)).orderBy(asc(generalReadingPassages.passageNo));
  // Each passage owns independent read-only queries. Preserve slot order and
  // the same publication checks while sharing the existing bounded DB pool.
  const loaded = await Promise.all(slots.map(async (slot) => {
    const data = await getPassageWithQuestions(slot.passageId);
    return data && (isLive(data.passage) || isStaff(role)) ? { passageNo: slot.passageNo, ...data } : null;
  }));
  const passages = loaded.filter((passage): passage is NonNullable<typeof passage> => passage !== null);
  if(!isStaff(role) && passages.length!==slots.length) return null;
  return { set, passages };
}

export async function generalProgress(userId: string, setId: string, executor: typeof db = db) {
  return executor.select().from(generalReadingProgress).where(and(eq(generalReadingProgress.userId, userId), eq(generalReadingProgress.setId, setId)));
}

export type GeneralCheckRow = {
  questionId: string;
  isCorrect: boolean;
  correctAnswer: string;
  acceptedAnswers: string[];
  evidenceQuote: string | null;
  explanation: string | null;
};

/** Server-owned Check projection, also used to restore an already checked result. */
function generalCheckRows(
  questions: (typeof readingQuestions.$inferSelect)[],
  groups: (typeof readingQuestionGroups.$inferSelect)[],
  answers: Record<string, string>,
): GeneralCheckRow[] {
  return questions.map(question => ({
    questionId: question.id,
    isCorrect: gradeReadingQuestion(answers[question.id] ?? "", question, groups.find(group => group.id === question.groupId)?.sharedChoices),
    correctAnswer: question.correctAnswer,
    acceptedAnswers: question.acceptedAnswers ?? [],
    evidenceQuote: question.evidenceQuote ?? null,
    explanation: question.explanation?.trim() ? question.explanation : null,
  }));
}

/** Call only with the authenticated learner's persisted progress, never client flags.
 * A read does not perform Check or write progress. Unchecked/edited drafts get no key. */
export function restoredGeneralCheck(
  progress: typeof generalReadingProgress.$inferSelect | undefined,
  questions: (typeof readingQuestions.$inferSelect)[],
  groups: (typeof readingQuestionGroups.$inferSelect)[],
): GeneralCheckRow[] | null {
  if (!progress?.checkedAt || progress.total !== questions.length) return null;
  if (questions.some(question => question.passageId !== progress.passageId)) return null;
  const rows = generalCheckRows(questions, groups, progress.answers);
  // If grading disagrees with the persisted Check, require a fresh explicit Check.
  if (rows.filter(row => row.isCorrect).length !== progress.score) return null;
  return rows;
}

/**
 * Save (and optionally check) one passage of a General Reading set for one learner.
 * Progress is per passage, so Passage-only and Full Reading share the same rows:
 * a passage solved alone is already done when the learner later opens Full Reading.
 * Only question ids of THIS passage are accepted; grading uses the Academic grader.
 */
export async function saveGeneralProgress(input: { userId: string; role: Role; passageId: string; answers: Record<string, string>; check: boolean }, executor: typeof db = db) {
  const membership = await generalMembership(input.passageId, executor);
  if (!membership || (!isLive(membership.set) && !isStaff(input.role))) return null;
  const passage = await executor.query.readingPassages.findFirst({ where: eq(readingPassages.id,input.passageId) });
  if (!passage || (!isLive(passage) && !isStaff(input.role))) return null;
  const questions = await executor.query.readingQuestions.findMany({ where: eq(readingQuestions.passageId, input.passageId) });
  const allowed = new Set(questions.map((question) => question.id));
  const answers = Object.fromEntries(Object.entries(input.answers).filter(([id, value]) => allowed.has(id) && typeof value === "string").map(([id, value]) => [id, value.slice(0, 500)]));
  let result: GeneralCheckRow[] | null = null;
  let score: number | null = null;
  if (input.check) {
    const groups=await executor.query.readingQuestionGroups.findMany({where:eq(readingQuestionGroups.passageId,input.passageId)});
    result = generalCheckRows(questions, groups, answers);
    score = result.filter((row) => row.isCorrect).length;
  }
  const now = new Date();
  const values = { userId: input.userId, setId: membership.setId, passageId: input.passageId, answers, updatedAt: now,
    ...(input.check ? { score, total: questions.length, checkedAt: now } : { score:null,total:null,checkedAt:null }) };
  const [row] = await executor.insert(generalReadingProgress).values(values)
    .onConflictDoUpdate({ target: [generalReadingProgress.userId, generalReadingProgress.passageId], set: values }).returning();
  return { progress: row!, result };
}
