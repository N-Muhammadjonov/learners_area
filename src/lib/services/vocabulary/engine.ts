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
  sentenceDedupeHash,
  streakFromDays,
  type PointKind,
} from "./points";
import { legacySenseKeyOf, senseKeyOf } from "./dedupe";
import { gradeSentence, gradeSpelling, shouldAwardGamePoint, submissionMatchesGame, type GameSubmission } from "./grading";
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
  sourceSnapshot?: import("@/lib/services/lexical/context").VocabularySourceSnapshot | null;
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
    sourceSnapshot: entry.sourceSnapshot,
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
    sourceSnapshot: entry.sourceSnapshot,
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
}, connection: Pick<typeof db, "insert"> = db): Promise<boolean> {
  const inserted = await connection
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
  /** Server-resolved canonical identity, never copied from an unvalidated HTTP body. */
  canonicalLexemeId?: string;
  authored?: boolean;
  sourceSnapshot?: import("@/lib/services/lexical/context").VocabularySourceSnapshot;
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
  | { ok: false; error: "folder_not_found" | "lexeme_not_found" }
> {
  return db.transaction(async (tx) => {
    // Serialize saves for this learner before reading their existing senses.
    // Canonical rows, personal entries, awards and activity commit together;
    // a replay cannot read an empty library while another save is in flight.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("update");
    // A folder id that belongs to somebody else must never be usable, so it is
    // verified once, before anything is written — the same rule the move endpoint
    // applies. Without this a caller could file their own word into another
    // student's folder and distort that folder's word count.
    if (input.folderId) {
      const folder = await tx.query.vocabFolders.findFirst({
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
    const canonicalIds = input.items.flatMap((item) => item.canonicalLexemeId ? [item.canonicalLexemeId] : []);
    const canonicalRows = canonicalIds.length ? await tx.select().from(lexemes).where(inArray(lexemes.id, canonicalIds)) : [];
    const canonical = new Map(canonicalRows.map((row) => [row.id, row]));
    if (canonicalIds.some((id) => !canonical.has(id))) return { ok: false as const, error: "lexeme_not_found" };
    const uniqueByKey = new Map<string, NewWordInput>();
    for (const item of input.items) {
      const key = item.canonicalLexemeId ?? senseKeyOf({ ...item, meaning: item.definitionEn });
      if (!uniqueByKey.has(key)) uniqueByKey.set(key, item);
    }
    const unique = [...uniqueByKey.values()];
    const ids: string[] = [];
    let added = 0;
    let points = 0;

    // Existing sense keys in this library: dedup must consider what is already
    // there, not only what arrived in this batch.
    const existingRows = await tx
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
      const resolved = item.canonicalLexemeId ? canonical.get(item.canonicalLexemeId) : undefined;
      let senseKey = resolved?.senseKey ?? senseKeyOf({
        term: item.term,
        partOfSpeech: item.partOfSpeech,
        meaning: item.definitionEn,
      });

      const normalizedTerm = item.term.trim().toLowerCase();
      // Old keys are retained only after full meaning/POS equality, never by a
      // truncated legacy key alone. A new differing sense receives its v2 key.
      const legacyKey = legacySenseKeyOf({ ...item, meaning: item.definitionEn });
      const candidates = resolved ? [resolved] : await tx.select().from(lexemes).where(or(
        eq(lexemes.senseKey, senseKey), eq(lexemes.senseKey, legacyKey), eq(lexemes.term, normalizedTerm),
      ));
      let lexeme = resolved ?? candidates.find((row) => senseKeyOf({ term: row.term, partOfSpeech: row.partOfSpeech, meaning: row.definitionEn }) === senseKey);
      if (lexeme) senseKey = lexeme.senseKey;
      const known = existingRows.find((row) => lexeme && row.lexemeId === lexeme.id)?.id ?? existingSense.get(senseKey);
      if (known) {
        ids.push(known);
        continue;
      }
      if (!lexeme) {
        const [created] = await tx
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
            provenance: item.authored ? "authored" : "user_provided",
            verificationStatus: item.authored ? "verified" : "unverified",
          })
          .onConflictDoNothing({ target: lexemes.senseKey })
          .returning();
        lexeme =
          created ??
          (await tx.query.lexemes.findFirst({ where: eq(lexemes.senseKey, senseKey) }));
      }
      if (!lexeme) continue;

      const [entry] = await tx
        .insert(userVocabulary)
        .values({
          userId: input.userId,
          lexemeId: lexeme.id,
          senseKey,
          folderId: input.folderId ?? null,
          topicPack: input.topicPack ?? null,
          sourceType: input.sourceType ?? "manual",
          sourceId: input.sourceId ?? null,
          sourceSnapshot: item.sourceSnapshot ?? null,
          srsStage: NEW_STAGE,
          mastery: "new",
          nextReviewAt: new Date(),
        })
        .returning();

      if (!entry) continue;
      ids.push(entry.id);
      existingSense.set(senseKey, entry.id);
      added += 1;

    }

    if (added > 0) await tx.update(users).set({
      lastMeaningfulActivityAt: sql`greatest(${users.lastMeaningfulActivityAt}, ${new Date()})`,
    }).where(eq(users.id, input.userId));
    await tx.insert(activityEvents).values({
      userId: input.userId,
      type: "VOCABULARY_ADDED",
      payload: {
        added,
        duplicates: input.items.length - unique.length,
        sourceType: input.sourceType ?? "manual",
        topicPack: input.topicPack ?? null,
      },
    });

    return {
      ok: true as const,
      added,
      duplicates: input.items.length - added,
      ids,
      points,
    };
  });
}

/** Add a whole topic pack in one action. */
export async function addTopicPack(userId: string, packId: string) {
  const pack = findPack(packId);
  if (!pack) return { ok: false as const, error: "unknown_pack" };
  const result = await addVocabularyBatch({
    userId,
    items: pack.words.map((word) => ({
      authored: true,
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
    dedupeKey: dedupeKeys.revision(input.userId, entry.id, entry.nextReviewAt),
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
      : [];
  else if (key === "assigned")
    words = all.filter((item) => item.sourceType === "assignment");

  const playable = words.slice(0, limit);
  const due = words.filter((item) => item.nextReviewAt.getTime() <= now).length;

  // `count` is what the games panel shows as playable, `due` says how many of
  // them can actually earn a practice point, and `total` is the whole filter.
  return { key, words: playable, count: playable.length, due, total: words.length };
}

/** Server-side membership check for every entry cited by a game answer. */
async function isEntryInGameSet(input: {
  userId: string;
  entry: typeof userVocabulary.$inferSelect;
  setKey: GameSetKey;
  folderId?: string;
  topicPack?: string;
  now: Date;
}): Promise<boolean> {
  const { entry, setKey, now } = input;
  if (setKey === "all") return true;
  if (setKey === "due") return entry.nextReviewAt.getTime() <= now.getTime();
  if (setKey === "weak") return isWeak({ ...entry, mastery: entry.mastery as Mastery });
  if (setKey === "reading") return entry.sourceType === "reading";
  if (setKey === "listening") return entry.sourceType === "listening";
  if (setKey === "assigned") return entry.sourceType === "assignment";
  if (setKey === "folder" && input.folderId) {
    const folder = await db.query.vocabFolders.findFirst({
      where: and(eq(vocabFolders.id, input.folderId), eq(vocabFolders.userId, input.userId)),
      columns: { id: true },
    });
    return Boolean(folder && entry.folderId === folder.id);
  }
  if (setKey === "topic") {
    return input.topicPack
      ? Boolean(findPack(input.topicPack) && entry.topicPack === input.topicPack)
      : Boolean(entry.topicPack && findPack(entry.topicPack));
  }
  return false;
}

/**
 * Record one game answer.
 *
 * The caller sends WHAT was answered, never whether it was right: the verdict is
 * produced here, from the stored word. Two consequences worth stating plainly:
 *
 *   - a flashcard self-assessment is recorded as practice but never earns a
 *     point; Matching Pairs instead sends both entry identities, which the
 *     server checks for ownership, set membership, and equality;
 *   - the casual point still cannot touch the spaced-repetition ladder, and it
 *     is deduplicated per word/game/set/day, so replaying the same game attempt
 *     cannot farm the leaderboard.
 */
export async function recordGameAnswer(input: {
  userId: string;
  entryId: string;
  setKey: GameSetKey;
  gameId: string;
  folderId?: string;
  topicPack?: string;
  submission: GameSubmission;
  now?: Date;
}): Promise<
  | { ok: false; error: "not_found" | "not_in_set" }
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

  const inSet = await isEntryInGameSet({
    userId: input.userId,
    entry,
    setKey: input.setKey,
    folderId: input.folderId,
    topicPack: input.topicPack,
    now,
  });
  if (!inSet) return { ok: false as const, error: "not_in_set" };

  const lexeme = await db.query.lexemes.findFirst({
    where: eq(lexemes.id, entry.lexemeId),
  });
  if (!lexeme) return { ok: false as const, error: "not_found" };

  let correct = false;
  let verified = false;
  const compatibleMode = submissionMatchesGame(input.gameId, input.submission.kind);
  if (!compatibleMode) {
    correct = false;
    verified = false;
  } else if (input.submission.kind === "spelling") {
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
  } else if (input.submission.kind === "pair") {
    const pairedEntry = await db.query.userVocabulary.findFirst({
      where: and(
        eq(userVocabulary.id, input.submission.pairEntryId),
        eq(userVocabulary.userId, input.userId),
      ),
    });
    if (!pairedEntry || !(await isEntryInGameSet({
      userId: input.userId,
      entry: pairedEntry,
      setKey: input.setKey,
      folderId: input.folderId,
      topicPack: input.topicPack,
      now,
    }))) return { ok: false as const, error: "not_in_set" };
    correct = entry.id === pairedEntry.id;
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
    shouldAwardGamePoint({ gameId: input.gameId, kind: input.submission.kind, verified, correct })
      ? await awardPoints({
          userId: input.userId,
          kind: "game_answer",
          dedupeKey: dedupeKeys.gameAnswer(
            input.userId,
            input.gameId,
            `${input.setKey}:${input.setKey === "folder" ? input.folderId ?? "" : input.setKey === "topic" ? input.topicPack ?? "any" : ""}:${dayKey(now)}`,
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
 * earns two points once per learner/word/normalized sentence; an unevaluated
 * sentence stays in the bank with its honest origin and earns nothing.
 */
export async function recordSentenceUse(input: {
  userId: string;
  entryId: string;
  sentence: string;
}) {
  const entry = await db.query.userVocabulary.findFirst({
    where: and(
      eq(userVocabulary.id, input.entryId),
      eq(userVocabulary.userId, input.userId),
    ),
  });
  if (!entry) return { ok: false as const, error: "not_found" };

  // This first write is always manual and unevaluated. Only confirmSentenceUse,
  // called after the RIWI evaluator returns, may mark it accepted or award points.
  const pointsAwarded = 0;

  const [usage] = await db
    .insert(vocabularyUsages)
    .values({
      userId: input.userId,
      userVocabularyId: entry.id,
      sentence: input.sentence,
      origin: "manual",
      riwiAccepted: false,
      evaluationId: null,
      pointsAwarded,
    })
    .returning();



  return {
    ok: true as const,
    usageId: usage!.id,
    mastery: entry.mastery,
    points: pointsAwarded,
  };
}

/**
 * Upgrade a stored sentence once the evaluator has judged it.
 *
 * The sentence is written to the bank immediately (honest origin: "manual"), and
 * this call is what turns it into evaluated, accepted work — awarding the largest
 * vocabulary points and moving mastery. A second call for the same sentence is
 * harmless: the ledger key is based on the learner, word, and normalized text,
 * so replaying the same accepted sentence under a new usage id cannot pay again.
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

  // The evaluator result is authoritative, but the point identity is derived
  // from the learner's exact normalized sentence and word, not a fresh usage id.
  // Re-posting the same sentence therefore cannot create a second award.
  const sentenceHash = sentenceDedupeHash(usage.sentence);
  const inserted = input.accepted
    ? await awardPoints({
        userId: input.userId,
        kind: "sentence",
        dedupeKey: dedupeKeys.sentence(input.userId, entry.id, sentenceHash),
        refType: "vocabulary_usage",
        refId: usage.id,
      })
    : false;
  const pointsAwarded = inserted ? VOCAB_POINTS.sentence : 0;
  const activeUseCount = entry.activeUseCount + (inserted ? 1 : 0);
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

  if (inserted) {
    await db
      .update(userVocabulary)
      .set({
        activeUseCount,
        mastery,
        masteredAt: mastery === "mastered" ? now : entry.masteredAt,
      })
      .where(eq(userVocabulary.id, entry.id));
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
  // Totals and recent activity are independent reads. Names join in the aggregate
  // so ranking does not require a third serial round trip.
  const [totals, days] = await Promise.all([
    db
      .select({
        userId: vocabPointEvents.userId,
        name: users.name,
        points: sql<number>`coalesce(sum(${vocabPointEvents.points}), 0)::int`,
      })
      .from(vocabPointEvents)
      .innerJoin(users, eq(users.id, vocabPointEvents.userId))
      .groupBy(vocabPointEvents.userId, users.name)
      .orderBy(desc(sql`coalesce(sum(${vocabPointEvents.points}), 0)`)),
    db
      .select({ createdAt: vocabPointEvents.createdAt })
      .from(vocabPointEvents)
      .where(eq(vocabPointEvents.userId, userId)),
  ]);

  const ranked = totals.map((row, index) => ({ ...row, rank: index + 1 }));
  const mine = ranked.find((row) => row.userId === userId) ?? {
    userId,
    name: "—",
    points: 0,
    rank: 0,
  };
  const streak = streakFromDays(days.map((row) => dayKey(row.createdAt)), new Date());
  const top = ranked.slice(0, 10).map((row) => ({
    rank: row.rank,
    userId: row.userId,
    name: row.name ?? "—",
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
    .where(and(eq(vocabPointEvents.userId, userId), gte(vocabPointEvents.points, 1), sql`${vocabPointEvents.kind} <> 'new_word'`))
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
