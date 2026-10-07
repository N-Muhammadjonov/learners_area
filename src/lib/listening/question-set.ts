import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions, listeningQuestions, listeningTests } from "@/db/schema";
import { publishedVersionForTarget } from "@/lib/content/attempt-binding";
import { listeningQuestionIdentity } from "@/lib/listening/question-identity";

/**
 * WHICH QUESTIONS A LISTENING ATTEMPT IS ANSWERING — one resolver, one place.
 *
 * A Listening item can now hold more than one question SET: the set a published revision
 * declared, and the legacy set written before revisions were materialized (rows with a NULL
 * `content_version_id`). Reading the wrong one is exactly the defect this module exists to
 * prevent — a learner mid-attempt must keep the questions they started with, and a finished
 * attempt's review must keep the questions it was graded against.
 *
 * The resolution order is deliberately conservative, and every branch is an authored fact:
 *
 *   1. the revision the ATTEMPT is bound to (`listening_attempts.content_version_id`) — what
 *      this learner was actually given;
 *   2. the item's currently PUBLISHED revision — what a learner starting now is given;
 *   3. the legacy set (NULL) — content that predates revision materialization, unchanged;
 *   4. every row of the item — a last resort for data that fits none of the above, so an
 *      attempt can never be shown zero questions because of a labelling gap.
 *
 * Nothing here guesses, and nothing here rewrites history: sets are appended per revision and
 * a superseded revision's rows are left exactly where they are, so the answers that reference
 * them keep resolving.
 */
export type ListeningQuestionRow = typeof listeningQuestions.$inferSelect;

/**
 * The transactional surface this module writes through: a transaction handle, structurally
 * typed (the same shape `pinVersion` accepts) so a caller may pass either the pool or a `tx`
 * without the module pretending to own the connection.
 */
export type QuestionSetTx = {
  delete: typeof db.delete;
  insert: typeof db.insert;
  update: typeof db.update;
  select: typeof db.select;
};

/** The set for ONE revision id, when that revision declared one. */
export async function listeningQuestionsForRevision(testId: string, versionId: string, database: typeof db = db) {
  return database
    .select()
    .from(listeningQuestions)
    .where(and(eq(listeningQuestions.testId, testId), eq(listeningQuestions.contentVersionId, versionId)))
    .orderBy(asc(listeningQuestions.order));
}

/** The legacy set: rows written before question sets were version-bound. */
export async function listeningQuestionsWithoutRevision(testId: string, database: typeof db = db) {
  return database
    .select()
    .from(listeningQuestions)
    .where(and(eq(listeningQuestions.testId, testId), sql`${listeningQuestions.contentVersionId} is null`))
    .orderBy(asc(listeningQuestions.order));
}

/** Every row of the item, whatever set it belongs to (the last-resort fallback). */
export async function listeningQuestionsOfItem(testId: string, database: typeof db = db) {
  return database
    .select()
    .from(listeningQuestions)
    .where(eq(listeningQuestions.testId, testId))
    .orderBy(asc(listeningQuestions.order));
}

/**
 * The questions an ATTEMPT must keep using: its own bound set when the attempt recorded a
 * revision, the legacy set for an unbound (pre-revision) attempt, and a defined fallback chain
 * so an attempt is never rendered without its questions.
 */
export async function listeningQuestionsForAttempt(
  attempt: { testId: string; contentVersionId?: string | null },
  database: typeof db = db,
): Promise<ListeningQuestionRow[]> {
  if (attempt.contentVersionId) {
    const bound = await listeningQuestionsForRevision(attempt.testId, attempt.contentVersionId, database);
    if (bound.length) return bound;
  }
  const legacy = await listeningQuestionsWithoutRevision(attempt.testId, database);
  if (legacy.length) return legacy;
  return listeningQuestionsOfItem(attempt.testId, database);
}

/**
 * The questions a learner STARTING NOW would be given — the published revision's set, else the
 * legacy set, else everything. Used by catalogue counts and by previews, never by an attempt
 * that already recorded its binding.
 */
export async function listeningQuestionsForLiveTest(testId: string, database: typeof db = db): Promise<ListeningQuestionRow[]> {
  const published = await publishedVersionForTarget("listening_test", testId, database);
  if (published) {
    const bound = await listeningQuestionsForRevision(testId, published.id, database);
    if (bound.length) return bound;
  }
  const legacy = await listeningQuestionsWithoutRevision(testId, database);
  if (legacy.length) return legacy;
  return listeningQuestionsOfItem(testId, database);
}

/** How many questions the LIVE set holds (a card must state this set's size, not every set's). */
export async function listeningQuestionCountForLiveTest(testId: string, database: typeof db = db): Promise<number> {
  return (await listeningQuestionsForLiveTest(testId, database)).length;
}

/**
 * Is this row part of the set a learner would be given NOW?
 *
 * A superseded revision's rows stay in the table forever (that is what keeps historical review
 * alive), so "the row exists" is not the same as "the row is current". Anything opening fresh
 * practice — the MCQ Mastery drill, for instance — must ask this, or it would keep serving
 * questions that were replaced.
 */
export async function listeningQuestionIsLive(questionId: string, testId: string, database: typeof db = db): Promise<boolean> {
  const live = await listeningQuestionsForLiveTest(testId, database);
  return live.some((question) => question.id === questionId);
}

/* -------------------------------------------------------------------------- */
/* Materialization — the ONLY writer that may replace a question set          */
/* -------------------------------------------------------------------------- */

type SnapshotQuestion = {
  order?: number;
  type: string;
  questionText: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  keywords?: string;
  paraphrase?: { heard: string; asked: string };
};

function questionRowsFromSnapshot(testId: string, versionId: string, snapshot: unknown) {
  const questions = Array.isArray((snapshot as { questions?: unknown })?.questions)
    ? ((snapshot as { questions: SnapshotQuestion[] }).questions)
    : [];
  return questions.map((question, index) => {
    /*
     * THE SAME IDENTITY DECISION AS THE IMPORT. An authored question must materialize into exactly
     * the row an imported one would — otherwise the two writers drift, and the drift is invisible
     * until a learner is offered an MCQ drill whose question set is empty.
     *
     * This used to compare the authored spelling against the two literals "multiple_choice" and
     * "mcq". A snapshot written by authoring carries the CANONICAL id (`mcq_single`), so an authored
     * single-choice question was stored as a typed answer while the registry called it multiple
     * choice. The identity decides it now, once: only `mcq_single`/`mcq_multi` store
     * `multiple_choice`, and everything else — a completion carrying a word bank, a matching
     * question, a map/plan — stores a typed answer.
     *
     * `type_code` keeps the canonical id when the registry knows the spelling (an alias such as
     * "mcq" converges to `mcq_single`), and otherwise the authored spelling itself, which is what the
     * column is for; an unknown authored type is refused at draft time, so this is a fallback, not a
     * guess.
     */
    const identity = listeningQuestionIdentity({ typeCode: question.type });
    return {
      testId,
      contentVersionId: versionId,
      order: question.order ?? index + 1,
      type: identity.storageType,
      typeCode: identity.typeCode ?? question.type ?? null,
      questionText: question.questionText,
      options: question.options ?? null,
      correctAnswer: question.correctAnswer,
      // NOT a fabricated explanation: an empty string records that the revision authored none, and
      // review renders authored evidence only. Older snapshots (pinned before `explanation` became a
      // required payload field) reach publication without one, and refusing them here would block a
      // publication over a field the review screen can simply leave out.
      explanation: question.explanation ?? "",
      keywords: question.keywords ?? null,
      paraphrases: question.paraphrase ? [question.paraphrase] : null,
    };
  });
}

/**
 * WHO OWNS THIS ITEM'S CANONICAL QUESTION SET?
 *
 *   • `"none"`     — the item has no canonical rows yet: a revision may materialize into it.
 *   • `"revision"` — every row already carries a revision id (an authored item): a new revision
 *                    may add ITS OWN set beside them, because each attempt reads the set it was
 *                    bound to.
 *   • `"legacy"`   — the item's rows were written by a canonical writer that does not go through
 *                    revisions (the import pipeline, the admin desk, the seed). Those rows are the
 *                    ones attempts and answers already point at, so publishing a revision must NOT
 *                    re-key the live set into a new one — that would leave the answers of every
 *                    existing attempt pointing at rows no attempt resolves to any more. Such an
 *                    item keeps its canonical set; publication only changes its visibility.
 *
 * This is the difference between "a revision describes this item" and "a revision IS this item's
 * content", and only the second one may rewrite the live set.
 */
export async function listeningCanonicalSetOwnership(
  testId: string,
  database: typeof db = db,
): Promise<"none" | "revision" | "legacy"> {
  const [row] = await database
    .select({
      total: sql<number>`count(*)::integer`,
      legacy: sql<number>`count(*) filter (where ${listeningQuestions.contentVersionId} is null)::integer`,
    })
    .from(listeningQuestions)
    .where(eq(listeningQuestions.testId, testId));
  const total = Number(row?.total ?? 0);
  if (total === 0) return "none";
  return Number(row?.legacy ?? 0) > 0 ? "legacy" : "revision";
}

/**
 * Turn a PUBLISHED revision into the item's live question set.
 *
 * This runs at the moment of publication — never on a draft save — which is what makes the two
 * guarantees in the owner's contract true at the same time:
 *
 *   • a draft edit cannot touch published content, because nothing is written here until the
 *     draft is actually published;
 *   • history survives, because only rows stamped with THIS revision id are replaced. An older
 *     revision's questions (and the answers that reference them) are never deleted.
 *
 * Re-publishing the same revision is idempotent: its own rows are replaced by the same content.
 */
export async function materializeListeningRevision(
  tx: QuestionSetTx,
  input: { targetId: string; versionId: string; snapshot: unknown },
): Promise<number> {
  const rows = questionRowsFromSnapshot(input.targetId, input.versionId, input.snapshot);
  await tx.delete(listeningQuestions).where(
    and(eq(listeningQuestions.testId, input.targetId), eq(listeningQuestions.contentVersionId, input.versionId)),
  );
  if (rows.length) await tx.insert(listeningQuestions).values(rows);
  return rows.length;
}

/**
 * The canonical row's own fields follow the published revision.
 *
 * Separate from the question set on purpose: a row keeps its identity (and therefore its
 * attempts, answers and history) while the title/audio it presents may change with a revision.
 */
export async function applyListeningRevisionToRow(
  tx: QuestionSetTx,
  input: {
    targetId: string;
    snapshot: { audioType?: string; audioUrl?: string; transcript?: string; difficultyLevel?: string };
    title?: string | null;
  },
) {
  await tx
    .update(listeningTests)
    .set({
      ...(input.title ? { title: input.title } : {}),
      ...(input.snapshot.audioType ? { audioType: input.snapshot.audioType as never } : {}),
      audioUrl: input.snapshot.audioUrl ?? null,
      transcript: input.snapshot.transcript ?? null,
      ...(input.snapshot.difficultyLevel ? { difficultyLevel: input.snapshot.difficultyLevel } : {}),
    })
    .where(eq(listeningTests.id, input.targetId));
}

/** The revision id a snapshot claims to be, for tests and diagnostics (never a guess). */
export async function listeningRevisionById(versionId: string, database: typeof db = db) {
  const [row] = await database
    .select()
    .from(contentVersions)
    .where(eq(contentVersions.id, versionId))
    .limit(1);
  return row ?? null;
}
