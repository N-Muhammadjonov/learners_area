import "server-only";
import { touchMeaningfulActivity } from "@/lib/services/activity";
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityEvents,
  lexemes,
  userVocabulary,
  users,
  vocabFolders,
  vocabPointEvents,
  vocabularyUsages,
} from "@/db/schema";
import {
  NEW_STAGE,
  applyReview,
  dueAtFrom,
  isWeak,
  masteryAfterUse,
  masteryFor,
  nextStage,
  type Mastery,
  type ReviewOutcome,
} from "./srs";
import {
  POINT_VALUES,
  VOCAB_POINTS,
  dayKey,
  dedupeKeys,
  streakFromDays,
  type PointKind,
} from "./points";
import { dedupeBulk, senseKeyOf } from "./dedupe";
import { gradeSentence, gradeSpelling, type GameSubmission } from "./grading";
import { searchRows } from "./search";
import { findPack } from "./packs";

/**
 * The Vocabulary Learning Engine.
 *
 * Every module adds words through `addVocabularyBatch`, every official progress
 * step goes through `applyScheduledReview`, and every point is written by
 * `awardPoints`. Games call `recordGameAnswer`, which can award a casual point
 * but can never touch the spaced-repetition ladder — that separation is the
 * whole reason games can exist without cheapening the schedule.
 */

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export type LibraryItem = {
  id: string;
  term: string;
  /** Authored alternative answers for the translation challenge. */
  acceptedTranslations: string[];
  partOfSpeech: string | null;
  definitionEn: string;
  translationUz: string | null;
  exampleSentence: string | null;
  collocations: string | null;
  mastery: Mastery;
  srsStage: number;
  intervalDays: number;
  nextReviewAt: Date;
  correctCount: number;
  incorrectCount: number;
  activeUseCount: number;
  folderId: string | null;
  topicPack: string | null;
  sourceType: string | null;
  createdAt: Date;
};

export async function listLibrary(
  userId: string,
  filter?: {
    folderId?: string;
    topicPack?: string;
    masteries?: Mastery[];
    sourceType?: string;
    /** Paging keeps a 1000-word library from becoming a 1000-row page payload. */
    limit?: number;
    offset?: number;
  },
): Promise<LibraryItem[]> {
  const conditions = [eq(userVocabulary.userId, userId)];
  if (filter?.folderId)
    conditions.push(eq(userVocabulary.folderId, filter.folderId));
  if (filter?.topicPack)
    conditions.push(eq(userVocabulary.topicPack, filter.topicPack));
  if (filter?.masteries?.length)
    conditions.push(inArray(userVocabulary.mastery, filter.masteries));
  if (filter?.sourceType)
    conditions.push(eq(userVocabulary.sourceType, filter.sourceType));

  const rows = await db
    .select({ entry: userVocabulary, lexeme: lexemes })
    .from(userVocabulary)
    .innerJoin(lexemes, eq(userVocabulary.lexemeId, lexemes.id))
    .where(and(...conditions))
    .orderBy(asc(userVocabulary.nextReviewAt), asc(lexemes.term))
    .limit(filter?.limit ?? 500)
    .offset(filter?.offset ?? 0);

  return rows.map(({ entry, lexeme }) => ({
    id: entry.id,
    term: lexeme.term,
    acceptedTranslations: lexeme.acceptedTranslations ?? [],
    partOfSpeech: lexeme.partOfSpeech,
    definitionEn: lexeme.definitionEn,
    translationUz: lexeme.translationUz,
    exampleSentence: lexeme.exampleSentence,
    collocations: lexeme.collocations,
    mastery: entry.mastery as Mastery,
    srsStage: entry.srsStage,
    intervalDays: entry.intervalDays,
    nextReviewAt: entry.nextReviewAt,
    correctCount: entry.correctCount,
    incorrectCount: entry.incorrectCount,
    activeUseCount: entry.activeUseCount,
    folderId: entry.folderId,
    topicPack: entry.topicPack,
    sourceType: entry.sourceType,
    createdAt: entry.createdAt,
  }));
}

export async function listDue(
  userId: string,
  limit = 20,
): Promise<LibraryItem[]> {
  const rows = await db
    .select({ entry: userVocabulary, lexeme: lexemes })
    .from(userVocabulary)
    .innerJoin(lexemes, eq(userVocabulary.lexemeId, lexemes.id))
    .where(
      and(eq(userVocabulary.userId, userId), lte(userVocabulary.nextReviewAt, new Date())),
    )
    .orderBy(asc(userVocabulary.nextReviewAt), asc(lexemes.term))
    .limit(limit);

  return rows.map(({ entry, lexeme }) => ({
    id: entry.id,
    term: lexeme.term,
    acceptedTranslations: lexeme.acceptedTranslations ?? [],
    partOfSpeech: lexeme.partOfSpeech,
    definitionEn: lexeme.definitionEn,
    translationUz: lexeme.translationUz,
    exampleSentence: lexeme.exampleSentence,
    collocations: lexeme.collocations,
    mastery: entry.mastery as Mastery,
    srsStage: entry.srsStage,
    intervalDays: entry.intervalDays,
    nextReviewAt: entry.nextReviewAt,
    correctCount: entry.correctCount,
    incorrectCount: entry.incorrectCount,
    activeUseCount: entry.activeUseCount,
    folderId: entry.folderId,
    topicPack: entry.topicPack,
    sourceType: entry.sourceType,
    createdAt: entry.createdAt,
  }));
}

/** Search the student's own library — never anybody else's words. */
export async function searchLibrary(
  userId: string,
  query: string,
  limit?: number,
) {
  // Only terms, definitions and translations are needed for the dropdown, so the
  // query stays narrow even when the library is large.
  const rows = await db
    .select({
      id: userVocabulary.id,
      term: lexemes.term,
      definitionEn: lexemes.definitionEn,
      translationUz: lexemes.translationUz,
      mastery: userVocabulary.mastery,
      srsStage: userVocabulary.srsStage,
      nextReviewAt: userVocabulary.nextReviewAt,
    })
    .from(userVocabulary)
    .innerJoin(lexemes, eq(userVocabulary.lexemeId, lexemes.id))
    .where(eq(userVocabulary.userId, userId))
    .limit(2000);

  return searchRows(rows, query, limit);
}

// ---------------------------------------------------------------------------
// Points ledger
// ---------------------------------------------------------------------------

/**
 * Write a point award, once.
 *
 * The unique index on `dedupe_key` is what makes this safe to call from a retry,
 * a double-click or a replayed request: the second attempt inserts nothing.
 */
export async function awardPoints(input: {
  userId: string;
  kind: PointKind;
  dedupeKey: string;
  refType?: string;
  refId?: string;
}): Promise<boolean> {
  const inserted = await db
    .insert(vocabPointEvents)
    .values({
      userId: input.userId,
      kind: input.kind,
      // The value comes from the shared constant, never from a caller — there is
      // no code path in which a request body can choose how many points to award.
      points: POINT_VALUES[input.kind],
      dedupeKey: input.dedupeKey,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
    })
    .onConflictDoNothing({ target: vocabPointEvents.dedupeKey })
    .returning({ id: vocabPointEvents.id });
  return inserted.length > 0;
}

// ---------------------------------------------------------------------------
// Adding words (one path, every module)
// ---------------------------------------------------------------------------

export type NewWordInput = {
  term: string;
  definitionEn: string;
  translationUz?: string | null;
  exampleSentence?: string | null;
  collocations?: string | null;
  partOfSpeech?: string | null;
  /** Extra accepted answers for the translation challenge, authored by staff. */
  acceptedTranslations?: string[] | null;
};

export async function addVocabularyBatch(input: {
  userId: string;
  items: NewWordInput[];
  folderId?: string | null;
  topicPack?: string | null;
  sourceType?: string;
  sourceId?: string | null;
}): Promise<
  | { ok: true; added: number; duplicates: number; ids: string[]; points: number }
  | { ok: false; error: "folder_not_found" }
> {
  // A folder id that belongs to somebody else must never be usable, so it is
  // verified once, before anything is written — the same rule the move endpoint
  // applies. Without this a caller could file their own word into another
  // student's folder and distort that folder's word count.
  if (input.folderId) {
    const folder = await db.query.vocabFolders.findFirst({
      where: and(
        eq(vocabFolders.id, input.folderId),
        eq(vocabFolders.userId, input.userId),
      ),
    });
    if (!folder) return { ok: false as const, error: "folder_not_found" };
  }

  // The identity of a word is its spelling, its part of speech and its ENGLISH
  // MEANING. Both the within-batch collapse and the "is it already in the
  // library" check use this one key, so two senses of one spelling stay apart
  // while the same sense pasted twice collapses — no matter how it was typed.
  const { unique, duplicates } = dedupeBulk(
    input.items.map((item) => ({ ...item, meaning: item.definitionEn })),
  );
  const ids: string[] = [];
  let added = 0;
  let points = 0;

  // Existing sense keys in this library: dedup must consider what is already
  // there, not only what arrived in this batch.
  const existingRows = await db
    .select({
      id: userVocabulary.id,
      senseKey: userVocabulary.senseKey,
      lexemeId: userVocabulary.lexemeId,
    })
    .from(userVocabulary)
    .where(eq(userVocabulary.userId, input.userId));
  const existingSense = new Map(
    existingRows.map((row) => [row.senseKey ?? "", row.id]),
  );

  for (const item of unique) {
    const senseKey = senseKeyOf({
      term: item.term,
      partOfSpeech: item.partOfSpeech,
      meaning: item.meaning ?? item.definitionEn,
    });

    const known = existingSense.get(senseKey);
    if (known) {
      ids.push(known);
      continue;
    }

    const normalizedTerm = item.term.trim().toLowerCase();
    // One catalogue row per SENSE, not per spelling: the same word with a
    // different meaning keeps its own definition, and two students who learn the
    // same sense share one row.
    let lexeme = await db.query.lexemes.findFirst({
      where: eq(lexemes.senseKey, senseKey),
    });
    if (!lexeme) {
      const [created] = await db
        .insert(lexemes)
        .values({
          term: normalizedTerm,
          partOfSpeech: item.partOfSpeech ?? null,
          definitionEn: item.definitionEn,
          translationUz: item.translationUz ?? null,
          exampleSentence: item.exampleSentence ?? null,
          collocations: item.collocations ?? null,
          acceptedTranslations: (item.acceptedTranslations ?? [])
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 4),
          senseKey,
        })
        .onConflictDoNothing({ target: lexemes.senseKey })
        .returning();
      lexeme =
        created ??
        (await db.query.lexemes.findFirst({ where: eq(lexemes.senseKey, senseKey) }));
    }
    if (!lexeme) continue;

    const [entry] = await db
      .insert(userVocabulary)
      .values({
        userId: input.userId,
        lexemeId: lexeme.id,
        senseKey,
        folderId: input.folderId ?? null,
        topicPack: input.topicPack ?? null,
        sourceType: input.sourceType ?? "manual",
        sourceId: input.sourceId ?? null,
        srsStage: NEW_STAGE,
        mastery: "new",
        nextReviewAt: new Date(),
      })
      .returning();

    if (!entry) continue;
    ids.push(entry.id);
    existingSense.set(senseKey, entry.id);
    added += 1;

    if (
      await awardPoints({
        userId: input.userId,
        kind: "new_word",
        dedupeKey: dedupeKeys.newWord(input.userId, entry.id),
        refType: "user_vocabulary",
        refId: entry.id,
      })
    ) {
      points += VOCAB_POINTS.newWord;
    }
  }

  if (added > 0) await touchMeaningfulActivity(input.userId);
  await db.insert(activityEvents).values({
    userId: input.userId,
    type: "VOCABULARY_ADDED",
    payload: {
      added,
      duplicates: duplicates.length,
      sourceType: input.sourceType ?? "manual",
      topicPack: input.topicPack ?? null,
    },
  });

  return {
    ok: true as const,
    added,
    duplicates:
      duplicates.length +
      (input.items.length - unique.length - duplicates.length),
    ids,
    points,
  };
}

/** Add a whole topic pack in one action. */
export async function addTopicPack(userId: string, packId: string) {
  const pack = findPack(packId);
  if (!pack) return { ok: false as const, error: "unknown_pack" };
  const result = await addVocabularyBatch({
    userId,
    items: pack.words.map((word) => ({
      term: word.term,
      definitionEn: word.definitionEn,
      translationUz: word.translationUz,
      exampleSentence: word.example,
      collocations: word.collocations ?? null,
      partOfSpeech: word.partOfSpeech,
    })),
    topicPack: pack.id,
    sourceType: "topic_pack",
  });
  if (!result.ok) return result;
  return {
    ok: true as const,
    added: result.added,
    duplicates: result.duplicates,
    ids: result.ids,
    points: result.points,
    packId: pack.id,
  };
}

// ---------------------------------------------------------------------------
// Scheduled revision — the ONLY thing that moves the official ladder
// ---------------------------------------------------------------------------

export async function applyScheduledReview(input: {
  userId: string;
  entryId: string;
  outcome: ReviewOutcome;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const entry = await db.query.userVocabulary.findFirst({
    where: and(
      eq(userVocabulary.id, input.entryId),
      eq(userVocabulary.userId, input.userId),
    ),
  });
  if (!entry) return { ok: false as const, error: "not_found" };

  // The schedule is only worth trusting if it is enforced. A word that is not
  // due yet cannot be reviewed early, so nobody can climb 1/3/7/16/35 in one
  // sitting by clicking repeatedly — the student simply has to come back.
  if (entry.nextReviewAt.getTime() > now.getTime()) {
    return {
      ok: false as const,
      error: "not_due",
      nextReviewAt: entry.nextReviewAt,
    };
  }

  const result = applyReview(
    {
      srsStage: entry.srsStage,
      correctCount: entry.correctCount,
      incorrectCount: entry.incorrectCount,
      activeUseCount: entry.activeUseCount,
    },
    input.outcome,
    now,
  );

  await db
    .update(userVocabulary)
    .set({
      srsStage: result.srsStage,
      mastery: result.mastery,
      correctCount: result.correctCount,
      incorrectCount: result.incorrectCount,
      intervalDays: result.intervalDays,
      nextReviewAt: result.nextReviewAt,
      lastReviewedAt: result.lastReviewedAt,
      masteredAt: result.mastery === "mastered" ? now : entry.masteredAt,
      state:
        result.mastery === "new"
          ? "new"
          : result.mastery === "learning"
            ? "learning"
            : "review",
    })
    .where(eq(userVocabulary.id, entry.id));

  await touchMeaningfulActivity(input.userId);
  await db.insert(activityEvents).values({
    userId: input.userId,
    type: "VOCAB_REVIEWED",
    payload: { id: entry.id, outcome: input.outcome, stage: result.srsStage },
  });

  // A revision earns a point whether or not the recall was correct: the student
  // did the scheduled work, which is what the ledger rewards. Progress is what
  // the stage records.
  const awarded = await awardPoints({
    userId: input.userId,
    kind: "revision",
    dedupeKey: dedupeKeys.revision(input.userId, entry.id, result.srsStage),
    refType: "user_vocabulary",
    refId: entry.id,
  });

  return {
    ok: true as const,
    mastery: result.mastery,
    srsStage: result.srsStage,
    intervalDays: result.intervalDays,
    nextReviewAt: result.nextReviewAt,
    points: awarded ? VOCAB_POINTS.revision : 0,
  };
}

// ---------------------------------------------------------------------------
// Games — casual practice, never official progress
// ---------------------------------------------------------------------------

export type GameSetKey =
  | "all"
  | "due"
  | "weak"
  | "reading"
  | "listening"
  | "topic"
  | "folder"
  | "assigned";

/**
 * The words a game set offers.
 *
 * A set is a filter over the SAME library: "due" is what the scheduler would ask
 * today, "weak" is what the student keeps getting wrong, "reading"/"listening"
 * are the words that came in from those modules, and "folder"/"topic" narrow to
 * the structure the student built.
 */
export async function gameSet(
  userId: string,
  key: GameSetKey,
  options?: { folderId?: string; topicPack?: string; limit?: number },
) {
  const all = await listLibrary(userId);
  const limit = options?.limit ?? 24;
  const now = Date.now();

  let words = all;
  if (key === "due")
    words = all.filter((item) => item.nextReviewAt.getTime() <= now);
  else if (key === "weak") words = all.filter((item) => isWeak(item));
  else if (key === "reading")
    words = all.filter((item) => item.sourceType === "reading");
  else if (key === "listening")
    words = all.filter((item) => item.sourceType === "listening");
  else if (key === "topic")
    words = options?.topicPack
      ? all.filter((item) => item.topicPack === options.topicPack)
      : all.filter((item) => Boolean(item.topicPack));
  else if (key === "folder")
    words = options?.folderId
      ? all.filter((item) => item.folderId === options.folderId)
      : all;
  else if (key === "assigned")
    words = all.filter((item) => item.sourceType === "assignment");

  const playable = words.slice(0, limit);
  const due = words.filter((item) => item.nextReviewAt.getTime() <= now).length;

  // `count` is what the games panel shows as playable, `due` says how many of
  // them can actually earn a practice point, and `total` is the whole filter.
  return { key, words: playable, count: playable.length, due, total: words.length };
}

/**
 * Record one game answer.
 *
 * A point is only awarded for an eligible answer — a word in a set the student
 * was due to practise — and only once per word per set per day. Replaying the
 * same set five times therefore earns nothing beyond the first pass. The SRS
 * ladder is untouched: games are casual by design.
 */
/**
 * Record one game answer.
 *
 * The caller sends WHAT was answered, never whether it was right: the verdict is
 * produced here, from the stored word. Two consequences worth stating plainly:
 *
 *   - a submission that the server cannot check (a flashcard self-assessment, a
 *     pairing the browser compared between its own cards) is recorded as
 *     practice but never earns a point — a claim is not evidence;
 *   - the casual point still cannot touch the spaced-repetition ladder, and it
 *     is still deduplicated per word per day per set, so replaying a set cannot
 *     farm the leaderboard.
 */
export async function recordGameAnswer(input: {
  userId: string;
  entryId: string;
  setKey: string;
  eligible: boolean;
  submission: GameSubmission;
  now?: Date;
}): Promise<
  | { ok: false; error: "not_found" }
  | { ok: true; correct: boolean; verified: boolean; awarded: number; srsUntouched: true }
> {
  const now = input.now ?? new Date();

  // Ownership first: another student's word is not a word this student can play.
  const entry = await db.query.userVocabulary.findFirst({
    where: and(
      eq(userVocabulary.id, input.entryId),
      eq(userVocabulary.userId, input.userId),
    ),
  });
  if (!entry) return { ok: false as const, error: "not_found" };

  const lexeme = await db.query.lexemes.findFirst({
    where: eq(lexemes.id, entry.lexemeId),
  });
  if (!lexeme) return { ok: false as const, error: "not_found" };

  let correct = false;
  let verified = false;
  if (input.submission.kind === "spelling") {
    correct = gradeSpelling(
      { term: lexeme.term, acceptedTranslations: lexeme.acceptedTranslations },
      input.submission.text,
    );
    verified = true;
  } else if (input.submission.kind === "sentence") {
    // The sentence builder assembles the example sentence; a word without an
    // example is practised against its definition, exactly as the browser shows.
    correct = gradeSentence(
      lexeme.exampleSentence ?? lexeme.definitionEn,
      input.submission.text,
    );
    verified = true;
  } else {
    correct = input.submission.known;
  }

  // Practice counts as activity, including an incorrect answer; never as SRS.
  await db.insert(activityEvents).values({
    userId: input.userId,
    type: "VOCAB_GAME_PRACTICED",
    payload: { entryId: entry.id, kind: input.submission.kind, correct, verified },
  });
  await touchMeaningfulActivity(input.userId);
  const awarded =
    verified && correct && input.eligible
      ? await awardPoints({
          userId: input.userId,
          kind: "game_answer",
          dedupeKey: dedupeKeys.gameAnswer(
            input.userId,
            `${input.setKey}:${dayKey(now)}`,
            input.entryId,
          ),
          refType: "user_vocabulary",
          refId: input.entryId,
        })
      : false;

  return {
    ok: true as const,
    correct,
    verified,
    awarded: awarded ? VOCAB_POINTS.gameAnswer : 0,
    srsUntouched: true as const,
  };
}

// ---------------------------------------------------------------------------
// Sentence Bank / active use
// ---------------------------------------------------------------------------

/**
 * Store a sentence the student wrote with one of their words.
 *
 * `accepted` comes from the RIWI text evaluation, never from the client. An
 * accepted sentence is real evidence of active use, so it promotes mastery to
 * ACTIVE (and to MASTERED when the word is already at the last SRS stage) and
 * earns the largest award; a sentence that was not evaluated stays in the bank
 * with its honest origin and earns nothing.
 */
export async function recordSentenceUse(input: {
  userId: string;
  entryId: string;
  sentence: string;
  origin: "manual" | "riwi";
  accepted: boolean;
  evaluationId?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const entry = await db.query.userVocabulary.findFirst({
    where: and(
      eq(userVocabulary.id, input.entryId),
      eq(userVocabulary.userId, input.userId),
    ),
  });
  if (!entry) return { ok: false as const, error: "not_found" };

  const activeUseCount = entry.activeUseCount + (input.accepted ? 1 : 0);
  const mastery = masteryAfterUse({
    srsStage: entry.srsStage,
    correctCount: entry.correctCount,
    incorrectCount: entry.incorrectCount,
    activeUseCount,
  });

  const pointsAwarded = input.accepted ? VOCAB_POINTS.sentence : 0;

  const [usage] = await db
    .insert(vocabularyUsages)
    .values({
      userId: input.userId,
      userVocabularyId: entry.id,
      sentence: input.sentence,
      origin: input.origin,
      riwiAccepted: input.accepted,
      evaluationId: input.evaluationId ?? null,
      pointsAwarded,
    })
    .returning();

  if (input.accepted) {
    await db
      .update(userVocabulary)
      .set({
        activeUseCount,
        mastery,
        masteredAt: mastery === "mastered" ? now : entry.masteredAt,
      })
      .where(eq(userVocabulary.id, entry.id));

    await awardPoints({
      userId: input.userId,
      kind: "sentence",
      dedupeKey: dedupeKeys.sentence(input.userId, usage!.id),
      refType: "vocabulary_usage",
      refId: usage!.id,
    });
  }

  return {
    ok: true as const,
    usageId: usage!.id,
    mastery,
    points: pointsAwarded,
  };
}

/**
 * Upgrade a stored sentence once the evaluator has judged it.
 *
 * The sentence is written to the bank immediately (honest origin: "manual"), and
 * this call is what turns it into evaluated, accepted work — awarding the largest
 * vocabulary points and moving mastery. A second call for the same sentence is
 * harmless: the point award is keyed by the usage id, so it can only land once.
 */
export async function confirmSentenceUse(input: {
  userId: string;
  usageId: string;
  accepted: boolean;
  evaluationId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const usage = await db.query.vocabularyUsages.findFirst({
    where: and(
      eq(vocabularyUsages.id, input.usageId),
      eq(vocabularyUsages.userId, input.userId),
    ),
  });
  if (!usage) return { ok: false as const, error: "not_found" };
  if (usage.origin === "riwi")
    return { ok: false as const, error: "already_evaluated" };

  const entry = await db.query.userVocabulary.findFirst({
    where: eq(userVocabulary.id, usage.userVocabularyId),
  });
  if (!entry) return { ok: false as const, error: "not_found" };

  const pointsAwarded = input.accepted ? VOCAB_POINTS.sentence : 0;
  const activeUseCount = entry.activeUseCount + (input.accepted ? 1 : 0);
  const mastery = masteryAfterUse({
    srsStage: entry.srsStage,
    correctCount: entry.correctCount,
    incorrectCount: entry.incorrectCount,
    activeUseCount,
  });

  await db
    .update(vocabularyUsages)
    .set({
      origin: "riwi",
      riwiAccepted: input.accepted,
      evaluationId: input.evaluationId,
      pointsAwarded,
    })
    .where(eq(vocabularyUsages.id, usage.id));

  if (input.accepted) {
    await db
      .update(userVocabulary)
      .set({
        activeUseCount,
        mastery,
        masteredAt: mastery === "mastered" ? now : entry.masteredAt,
      })
      .where(eq(userVocabulary.id, entry.id));
  }

  if (input.accepted) {
    await awardPoints({
      userId: input.userId,
      kind: "sentence",
      dedupeKey: dedupeKeys.sentence(input.userId, usage.id),
      refType: "vocabulary_usage",
      refId: usage.id,
    });
  }

  return { ok: true as const, mastery, points: pointsAwarded };
}

export async function listSentenceBank(userId: string, limit = 50) {
  return db
    .select({
      id: vocabularyUsages.id,
      sentence: vocabularyUsages.sentence,
      origin: sql<"manual" | "riwi">`${vocabularyUsages.origin}`,
      accepted: vocabularyUsages.riwiAccepted,
      pointsAwarded: vocabularyUsages.pointsAwarded,
      evaluationId: vocabularyUsages.evaluationId,
      createdAt: vocabularyUsages.createdAt,
      term: lexemes.term,
    })
    .from(vocabularyUsages)
    .innerJoin(
      userVocabulary,
      eq(vocabularyUsages.userVocabularyId, userVocabulary.id),
    )
    .innerJoin(lexemes, eq(userVocabulary.lexemeId, lexemes.id))
    .where(eq(vocabularyUsages.userId, userId))
    .orderBy(desc(vocabularyUsages.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function listFolders(userId: string) {
  const rows = await db
    .select({
      id: vocabFolders.id,
      name: vocabFolders.name,
      createdAt: vocabFolders.createdAt,
      count: sql<number>`count(${userVocabulary.id})::int`,
    })
    .from(vocabFolders)
    // The join is scoped to the caller's own library as well as to the folder:
    // a count must never include a word that happens to point at this folder but
    // belongs to somebody else.
    .leftJoin(
      userVocabulary,
      and(
        eq(userVocabulary.folderId, vocabFolders.id),
        eq(userVocabulary.userId, userId),
      ),
    )
    .where(eq(vocabFolders.userId, userId))
    .groupBy(vocabFolders.id, vocabFolders.name, vocabFolders.createdAt)
    .orderBy(asc(vocabFolders.name));

  return rows;
}

export async function createFolder(userId: string, name: string) {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { ok: false as const, error: "invalid_name" };
  const [row] = await db
    .insert(vocabFolders)
    .values({ userId, name: trimmed })
    .onConflictDoNothing({ target: [vocabFolders.userId, vocabFolders.name] })
    .returning();
  if (row) return { ok: true as const, folder: { id: row.id, name: row.name } };
  // Pressing "Create" twice must not produce an error — but the caller is told
  // that nothing new was created, so the interface can say so honestly.
  const existing = await db.query.vocabFolders.findFirst({
    where: and(eq(vocabFolders.userId, userId), eq(vocabFolders.name, trimmed)),
  });
  return existing
    ? { ok: true as const, folder: { id: existing.id, name: existing.name }, existing: true }
    : { ok: false as const, error: "server_error" };
}

export async function moveToFolder(
  userId: string,
  entryIds: string[],
  folderId: string | null,
) {
  if (entryIds.length === 0) return { ok: true as const, moved: 0 };
  if (folderId) {
    const folder = await db.query.vocabFolders.findFirst({
      where: and(
        eq(vocabFolders.id, folderId),
        eq(vocabFolders.userId, userId),
      ),
    });
    // A folder id from another student's library must never be usable.
    if (!folder) return { ok: false as const, error: "folder_not_found" };
  }
  const updated = await db
    .update(userVocabulary)
    .set({ folderId })
    .where(
      and(
        eq(userVocabulary.userId, userId),
        inArray(userVocabulary.id, entryIds),
      ),
    )
    .returning({ id: userVocabulary.id });
  return { ok: true as const, moved: updated.length };
}

// ---------------------------------------------------------------------------
// Private leaderboard + streak (Asia/Tashkent)
// ---------------------------------------------------------------------------

export async function getStanding(userId: string) {
  const totals = await db
    .select({
      userId: vocabPointEvents.userId,
      points: sql<number>`coalesce(sum(${vocabPointEvents.points}), 0)::int`,
    })
    .from(vocabPointEvents)
    .groupBy(vocabPointEvents.userId)
    .orderBy(desc(sql`coalesce(sum(${vocabPointEvents.points}), 0)`));

  const ranked = totals.map((row, index) => ({ ...row, rank: index + 1 }));
  const mine = ranked.find((row) => row.userId === userId) ?? {
    userId,
    points: 0,
    rank: 0,
  };

  const days = await db
    .select({ createdAt: vocabPointEvents.createdAt })
    .from(vocabPointEvents)
    .where(eq(vocabPointEvents.userId, userId));
  const streak = streakFromDays(
    days.map((row) => dayKey(row.createdAt)),
    new Date(),
  );

  const names = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      inArray(
        users.id,
        ranked
          .slice(0, 10)
          .map((row) => row.userId)
          .concat(ranked.length ? [ranked[0]!.userId] : []),
      ),
    );
  const nameById = new Map(names.map((row) => [row.id, row.name]));

  const top = ranked.slice(0, 10).map((row) => ({
    rank: row.rank,
    userId: row.userId,
    name: nameById.get(row.userId) ?? "—",
    points: row.points,
    isMe: row.userId === userId,
  }));

  return { points: mine.points, rank: mine.rank, streak, top };
}

/** Recent awards, so the student can see where their points came from. */
export async function recentAwards(userId: string, limit = 10) {
  return db
    .select({
      id: vocabPointEvents.id,
      kind: vocabPointEvents.kind,
      points: vocabPointEvents.points,
      createdAt: vocabPointEvents.createdAt,
    })
    .from(vocabPointEvents)
    .where(eq(vocabPointEvents.userId, userId))
    .orderBy(desc(vocabPointEvents.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Weak words (used by the Coach recommendations and the games selector)
// ---------------------------------------------------------------------------

export async function weakestWords(userId: string, limit = 5) {
  const all = await listLibrary(userId);
  return all
    .filter((item) => isWeak(item))
    .sort(
      (a, b) =>
        a.correctCount - a.incorrectCount - (b.correctCount - b.incorrectCount),
    )
    .slice(0, limit);
}

/**
 * Words that entered the library from a given module — used by the reading and
 * listening modules to show "words from this text" without a second store.
 */
export async function wordsFromSource(
  userId: string,
  sourceType: string,
  limit = 50,
) {
  const all = await listLibrary(userId);
  return all.filter((item) => item.sourceType === sourceType).slice(0, limit);
}

/** Counters for the dashboard, all computed from real rows. */
export async function librarySummary(userId: string) {
  const all = await listLibrary(userId);
  const due = all.filter((item) => item.nextReviewAt.getTime() <= Date.now());
  const byMastery = all.reduce<Record<string, number>>((acc, item) => {
    acc[item.mastery] = (acc[item.mastery] ?? 0) + 1;
    return acc;
  }, {});
  return {
    total: all.length,
    due: due.length,
    byMastery,
    nextDueAt: due.length ? due[0]!.nextReviewAt : null,
  };
}
