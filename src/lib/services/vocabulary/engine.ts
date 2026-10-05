import "server-only";
import { touchMeaningfulActivity } from "@/lib/services/activity";
import { and, asc, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityEvents,
  lexemes,
  userVocabulary,
  userVocabularyContexts,
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
  TIMEZONE,
  VOCAB_POINTS,
  dayKey,
  dedupeKeys,
  sentenceDedupeHash,
  streakFromDays,
  type PointKind,
} from "./points";
import { legacySenseKeyOf, senseKeyOf } from "./dedupe";
import { linkSenseToUnit } from "@/lib/services/lexical/units";
import { sourceRevisitHref } from "@/lib/services/lexical/context";
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

/** Entry/card fields only; do not hydrate auth, identity, or unused SRS columns. */
const librarySelection = {
  entry: {
    id: userVocabulary.id,
    mastery: userVocabulary.mastery,
    srsStage: userVocabulary.srsStage,
    intervalDays: userVocabulary.intervalDays,
    nextReviewAt: userVocabulary.nextReviewAt,
    correctCount: userVocabulary.correctCount,
    incorrectCount: userVocabulary.incorrectCount,
    activeUseCount: userVocabulary.activeUseCount,
    folderId: userVocabulary.folderId,
    topicPack: userVocabulary.topicPack,
    sourceType: userVocabulary.sourceType,
    sourceSnapshot: userVocabulary.sourceSnapshot,
    createdAt: userVocabulary.createdAt,
  },
  lexeme: {
    term: lexemes.term,
    acceptedTranslations: lexemes.acceptedTranslations,
    partOfSpeech: lexemes.partOfSpeech,
    definitionEn: lexemes.definitionEn,
    translationUz: lexemes.translationUz,
    exampleSentence: lexemes.exampleSentence,
    collocations: lexemes.collocations,
  },
};

type LibraryFilter = {
  folderId?: string;
  topicPack?: string;
  masteries?: Mastery[];
  sourceType?: string;
  sourceId?: string;
  limit?: number;
  offset?: number;
  random?: boolean;
  dueOnly?: boolean;
  weakOnly?: boolean;
  hasTopic?: boolean;
};

function libraryConditions(userId: string, filter?: LibraryFilter) {
  const conditions = [eq(userVocabulary.userId, userId)];
  if (filter?.folderId) conditions.push(eq(userVocabulary.folderId, filter.folderId));
  if (filter?.topicPack) conditions.push(eq(userVocabulary.topicPack, filter.topicPack));
  if (filter?.masteries?.length) conditions.push(inArray(userVocabulary.mastery, filter.masteries));
  if (filter?.sourceType) conditions.push(eq(userVocabulary.sourceType, filter.sourceType));
  if (filter?.sourceId) conditions.push(eq(userVocabulary.sourceId, filter.sourceId));
  if (filter?.dueOnly) conditions.push(lte(userVocabulary.nextReviewAt, new Date()));
  if (filter?.hasTopic) conditions.push(sql`${userVocabulary.topicPack} IS NOT NULL`);
  if (filter?.weakOnly) conditions.push(sql`${userVocabulary.mastery} NOT IN ('mastered', 'active') AND
    (${userVocabulary.correctCount} + ${userVocabulary.incorrectCount} = 0 OR
     ${userVocabulary.correctCount}::numeric / NULLIF(${userVocabulary.correctCount} + ${userVocabulary.incorrectCount}, 0) < 0.6)`);
  return conditions;
}

export async function listLibrary(userId: string, filter?: LibraryFilter, database: typeof db = db): Promise<LibraryItem[]> {
  const conditions = libraryConditions(userId, filter);
  const rows = await database
    .select(librarySelection)
    .from(userVocabulary)
    .innerJoin(lexemes, eq(userVocabulary.lexemeId, lexemes.id))
    .where(and(...conditions))
    .orderBy(...(filter?.random ? [sql`random()`] : [asc(userVocabulary.nextReviewAt), asc(lexemes.term)]))
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
    .select(librarySelection)
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
    // Whole own library (narrow columns): ranking uses Unicode/apostrophe folding
    // that SQL LIKE cannot mirror, and a row cap made words beyond it unfindable.
    .where(eq(userVocabulary.userId, userId));

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

type SaveTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Record where a saved sense was met. One row per (item, occurrence): a replayed
 * save is a no-op, a new place adds a row and bumps seen_count / last_seen_at.
 * Only server-resolved snapshots reach here (routes build them from occurrences).
 */
async function appendSourceContext(
  tx: SaveTx,
  userVocabularyId: string,
  snapshot: import("@/lib/services/lexical/context").VocabularySourceSnapshot,
  input: { userId: string; sourceType?: string; sourceId?: string | null },
  options: { first?: boolean } = {},
) {
  const sourceType = snapshot.sourceType ?? (input.sourceType === "listening" ? "listening" : "reading");
  const inserted = await tx.insert(userVocabularyContexts).values({
    userVocabularyId,
    userId: input.userId,
    occurrenceId: snapshot.occurrenceId,
    sourceType,
    sourceId: snapshot.listeningTestId ?? snapshot.attemptId ?? snapshot.passageId ?? input.sourceId ?? null,
    snapshot,
  }).onConflictDoNothing().returning({ id: userVocabularyContexts.id });
  if (!inserted.length || options.first) return;
  await tx.update(userVocabulary).set({
    seenCount: sql`${userVocabulary.seenCount} + 1`,
    lastSeenAt: new Date(),
  }).where(and(eq(userVocabulary.id, userVocabularyId), eq(userVocabulary.userId, input.userId)));
}

export async function addVocabularyBatch(input: {
  userId: string;
  items: NewWordInput[];
  folderId?: string | null;
  topicPack?: string | null;
  sourceType?: string;
  sourceId?: string | null;
}, transaction?: SaveTx): Promise<
  | { ok: true; added: number; duplicates: number; ids: string[]; points: number }
  | { ok: false; error: "folder_not_found" | "lexeme_not_found" }
> {
  const save = async (tx: SaveTx) => {
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
      if (!folder) return { ok: false as const, error: "folder_not_found" as const };
    }

    let destinationFolderId = input.folderId ?? null;
    if (!destinationFolderId && (input.sourceType === "listening" || input.sourceType === "reading")) {
      const name = input.sourceType === "listening" ? "Listening" : "Reading";
      const [created] = await tx.insert(vocabFolders).values({ userId: input.userId, name })
        .onConflictDoNothing({ target: [vocabFolders.userId, vocabFolders.name] }).returning({ id: vocabFolders.id });
      const existing = created ?? await tx.query.vocabFolders.findFirst({ where: and(eq(vocabFolders.userId, input.userId), eq(vocabFolders.name, name)) });
      if (!existing) throw new Error("Default vocabulary folder unavailable");
      destinationFolderId = existing.id;
    }

    // The identity of a word is its spelling, its part of speech and its ENGLISH
    // MEANING. Both the within-batch collapse and the "is it already in the
    // library" check use this one key, so two senses of one spelling stay apart
    // while the same sense pasted twice collapses — no matter how it was typed.
    const canonicalIds = input.items.flatMap((item) => item.canonicalLexemeId ? [item.canonicalLexemeId] : []);
    const canonicalRows = canonicalIds.length ? await tx.select().from(lexemes).where(inArray(lexemes.id, canonicalIds)) : [];
    const canonical = new Map(canonicalRows.map((row) => [row.id, row]));
    if (canonicalIds.some((id) => !canonical.has(id))) return { ok: false as const, error: "lexeme_not_found" as const };
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
        // Same sense met again in a NEW place: keep one item, append the context.
        // SRS fields are not touched — meeting a word is not reviewing it.
        if (item.sourceSnapshot) await appendSourceContext(tx, known, item.sourceSnapshot, input);
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
      if (!lexeme.lexicalUnitId) {
        lexeme = { ...lexeme, lexicalUnitId: await linkSenseToUnit(tx, lexeme, lexeme.provenance ?? "user_provided") };
      }

      const [entry] = await tx
        .insert(userVocabulary)
        .values({
          userId: input.userId,
          lexemeId: lexeme.id,
          senseKey,
          folderId: destinationFolderId,
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
      if (item.sourceSnapshot) await appendSourceContext(tx, entry.id, item.sourceSnapshot, input, { first: true });
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
  };
  return transaction ? save(transaction) : db.transaction(save);
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
  database: typeof db = db,
) {
  if (key === "folder" && !options?.folderId) return { key, words: [], count: 0, due: 0, total: 0 };
  const limit = Math.min(500, Math.max(1, options?.limit ?? 24));
  // Filter BEFORE sampling. Even a folder beyond the first 500 library rows is
  // playable, and each new round samples from the entire owned folder.
  const filter: LibraryFilter = {
    folderId: key === "folder" ? options?.folderId : undefined,
    topicPack: key === "topic" ? options?.topicPack : undefined,
    hasTopic: key === "topic" && !options?.topicPack,
    sourceType: key === "reading" || key === "listening" ? key : key === "assigned" ? "assignment" : undefined,
    dueOnly: key === "due",
    weakOnly: key === "weak",
    random: true,
    limit,
  };
  const [words, totals] = await Promise.all([
    listLibrary(userId, filter, database),
    database.select({
      total: sql<number>`count(*)::int`,
      due: sql<number>`count(*) FILTER (WHERE ${userVocabulary.nextReviewAt} <= now())::int`,
    }).from(userVocabulary).where(and(...libraryConditions(userId, filter))),
  ]);
  return { key, words, count: words.length, due: totals[0]?.due ?? 0, total: totals[0]?.total ?? 0 };
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
 *     is deduplicated per learner/word/Tashkent-day across every game mode, so replaying
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
          dedupeKey: dedupeKeys.gameAnswer(input.userId, input.entryId, dayKey(now)),
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

/**
 * The learner's most recent flashcard self-assessment, per saved word.
 *
 * A flashcard judgement is practice, never SRS: it is written as a
 * `VOCAB_GAME_PRACTICED` activity with `kind: "self"` and it earns no point (see
 * `recordGameAnswer` above). Reading those rows back is what makes the marks
 * durable — a reloaded pass shows the same Learned / Not yet state the learner
 * left behind instead of pretending the deck is untouched. The body of the
 * activity row is the source of truth; this deliberately adds no second store.
 *
 * Only the caller's own rows are read, the newest judgement per entry wins, and
 * `connection` defaults to the application pool so tests can exercise the real
 * query against a real PostgreSQL.
 */
export async function loadSelfAssessments(
  userId: string,
  entryIds: string[],
  connection: typeof db = db,
): Promise<Record<string, "known" | "notYet">> {
  if (entryIds.length === 0) return {};
  const rows = await connection
    .select({
      entryId: sql<string | null>`${activityEvents.payload} ->> 'entryId'`,
      known: sql<boolean | null>`(${activityEvents.payload} ->> 'correct')::boolean`,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.userId, userId),
        eq(activityEvents.type, "VOCAB_GAME_PRACTICED"),
        sql`${activityEvents.payload} ->> 'kind' = 'self'`,
        inArray(sql<string>`${activityEvents.payload} ->> 'entryId'`, entryIds),
      ),
    )
    .orderBy(desc(activityEvents.createdAt));

  const latest: Record<string, "known" | "notYet"> = {};
  for (const row of rows) {
    if (!row.entryId || row.entryId in latest) continue;
    latest[row.entryId] = row.known === true ? "known" : "notYet";
  }
  return latest;
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
}, database: typeof db = db) {
  const entry = await database.query.userVocabulary.findFirst({
    where: and(
      eq(userVocabulary.id, input.entryId),
      eq(userVocabulary.userId, input.userId),
    ),
  });
  if (!entry) return { ok: false as const, error: "not_found" };

  // This first write is always manual and unevaluated. Only confirmSentenceUse,
  // called after the RIWI evaluator returns, may mark it accepted or award points.
  const pointsAwarded = 0;

  const [usage] = await database
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
  /** Who judged the sentence: RIWI (Vocabulary "use") or the external AI (Writing Activation Lab). */
  origin?: "riwi" | "external_ai";
}, database: typeof db = db) {
  const now = input.now ?? new Date();
  const origin = input.origin ?? "riwi";
  const usage = await database.query.vocabularyUsages.findFirst({
    where: and(
      eq(vocabularyUsages.id, input.usageId),
      eq(vocabularyUsages.userId, input.userId),
    ),
  });
  if (!usage) return { ok: false as const, error: "not_found" };
  if (usage.origin !== "manual")
    return { ok: false as const, error: "already_evaluated" };

  const entry = await database.query.userVocabulary.findFirst({
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
      }, database)
    : false;
  const pointsAwarded = inserted ? VOCAB_POINTS.sentence : 0;
  const activeUseCount = entry.activeUseCount + (inserted ? 1 : 0);
  const mastery = masteryAfterUse({
    srsStage: entry.srsStage,
    correctCount: entry.correctCount,
    incorrectCount: entry.incorrectCount,
    activeUseCount,
  });

  await database
    .update(vocabularyUsages)
    .set({
      origin,
      riwiAccepted: input.accepted,
      evaluationId: input.evaluationId,
      pointsAwarded,
    })
    .where(eq(vocabularyUsages.id, usage.id));

  if (inserted) {
    await database
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
  const trimmed = name.trim().slice(0, 200);
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
    if (!folder) return { ok: false as const, error: "folder_not_found" as const };
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

/** Preserve the exact failed leaderboard query stage without leaking SQL or data. */
async function leaderboardQuery<T>(stage: string, run: () => PromiseLike<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    const failure = new Error("vocabulary_leaderboard_query_failed") as Error & { leaderboardStage: string; cause?: unknown };
    failure.leaderboardStage = stage;
    failure.cause = cause;
    throw failure;
  }
}

export function buildEffectivePointRows() {
  return db.$with("effective_vocab_point_rows").as(
    db.select({
      id: vocabPointEvents.id,
      userId: vocabPointEvents.userId,
      kind: vocabPointEvents.kind,
      createdAt: vocabPointEvents.createdAt,
      effectivePoints: sql<number>`CASE
        WHEN ${vocabPointEvents.kind} = 'new_word' THEN ${POINT_VALUES.new_word}
        WHEN ${vocabPointEvents.kind} = 'revision' THEN ${POINT_VALUES.revision}
        WHEN ${vocabPointEvents.kind} = 'game_answer' THEN CASE
          WHEN row_number() OVER (
            PARTITION BY ${vocabPointEvents.kind}, ${vocabPointEvents.userId},
              coalesce(${vocabPointEvents.refId}, ${vocabPointEvents.id}::text),
              ((${vocabPointEvents.createdAt} AT TIME ZONE ${TIMEZONE}::text)::date)
            ORDER BY ${vocabPointEvents.createdAt} ASC, ${vocabPointEvents.id} ASC
          ) = 1 THEN ${POINT_VALUES.game_answer}
          ELSE 0
        END
        WHEN ${vocabPointEvents.kind} = 'sentence' THEN ${POINT_VALUES.sentence}
        ELSE 0
      END::int`.as("effective_points"),
    }).from(vocabPointEvents),
  );
}

export function buildStandingQueries(userId: string) {
  const effectiveRows = buildEffectivePointRows();
  return {
    totals: () => db.with(effectiveRows)
      .select({
        userId: effectiveRows.userId,
        name: users.name,
        points: sql<number>`coalesce(sum(${effectiveRows.effectivePoints}), 0)::int`,
      })
      .from(effectiveRows)
      .innerJoin(users, eq(users.id, effectiveRows.userId))
      .where(eq(users.role, "student"))
      .groupBy(effectiveRows.userId, users.name)
      .having(sql`sum(${effectiveRows.effectivePoints}) > 0`)
      .orderBy(desc(sql`sum(${effectiveRows.effectivePoints})`), asc(users.name), asc(effectiveRows.userId)),
    streakDays: () => db.with(effectiveRows)
      .select({ createdAt: effectiveRows.createdAt })
      .from(effectiveRows)
      .where(and(eq(effectiveRows.userId, userId), gt(effectiveRows.effectivePoints, 0))),
  };
}

export async function getStanding(userId: string) {
  // Effective score is derived from the current contract, not historical stored
  // amounts. Legacy game-answer duplicates are collapsed per learner/entry/day.
  const queries = buildStandingQueries(userId);
  const [totals, days] = await Promise.all([
    leaderboardQuery("standing_totals", queries.totals),
    leaderboardQuery("standing_streak_days", queries.streakDays),
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

/** Recent provenance with current effective values, not obsolete stored amounts. */
export function buildRecentAwardsQuery(userId: string, limit = 10) {
  const effectiveRows = buildEffectivePointRows();
  return db.with(effectiveRows)
    .select({
      id: effectiveRows.id,
      kind: effectiveRows.kind,
      points: effectiveRows.effectivePoints,
      createdAt: effectiveRows.createdAt,
    })
    .from(effectiveRows)
    .where(and(eq(effectiveRows.userId, userId), gt(effectiveRows.effectivePoints, 0)))
    .orderBy(desc(effectiveRows.createdAt))
    .limit(limit);
}

export async function recentAwards(userId: string, limit = 10) {
  return leaderboardQuery("awards_recent", () => buildRecentAwardsQuery(userId, limit));
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
  sourceId?: string,
) {
  return listLibrary(userId, { sourceType, sourceId, limit });
}

/** Counters for the dashboard, all computed from real rows. */
export async function librarySummary(userId: string) {
  // One bounded aggregate returns the global counters plus complete source
  // counts. Never fetch complete word rows just to fill summary/map widgets.
  const rows = await db
    .select({
      mastery: userVocabulary.mastery,
      sourceType: userVocabulary.sourceType,
      total: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${userVocabulary.nextReviewAt} <= now())::int`,
      nextDueAt: sql<Date | null>`min(${userVocabulary.nextReviewAt}) filter (where ${userVocabulary.nextReviewAt} <= now())`,
    })
    .from(userVocabulary)
    .where(eq(userVocabulary.userId, userId))
    .groupBy(userVocabulary.mastery, userVocabulary.sourceType);

  const byMastery: Record<string, number> = { new: 0, learning: 0, known: 0, active: 0, mastered: 0 };
  const bySource: Record<string, number> = {};
  let total = 0;
  let due = 0;
  let nextDueAt: Date | null = null;
  for (const row of rows) {
    const rowTotal = Number(row.total);
    total += rowTotal;
    due += Number(row.due);
    if (row.mastery in byMastery) byMastery[row.mastery] = (byMastery[row.mastery] ?? 0) + rowTotal;
    const source = row.sourceType ?? "manual";
    bySource[source] = (bySource[source] ?? 0) + rowTotal;
    if (row.nextDueAt && (!nextDueAt || row.nextDueAt < nextDueAt)) nextDueAt = row.nextDueAt;
  }

  return { total, due, byMastery, bySource, nextDueAt };
}

/**
 * Every place THIS learner met one saved sense, newest first, with a revisit link.
 * Scoped by user id on both the item and the context rows: another learner's id
 * returns null, never their contexts.
 */
export async function listVocabularyContexts(userId: string, userVocabularyId: string) {
  const item = await db.query.userVocabulary.findFirst({
    where: and(eq(userVocabulary.id, userVocabularyId), eq(userVocabulary.userId, userId)),
    columns: { id: true, seenCount: true, firstSeenAt: true, lastSeenAt: true },
  });
  if (!item) return null;
  const rows = await db.select().from(userVocabularyContexts)
    .where(and(eq(userVocabularyContexts.userVocabularyId, item.id), eq(userVocabularyContexts.userId, userId)))
    .orderBy(desc(userVocabularyContexts.seenAt));
  return {
    seenCount: item.seenCount, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt,
    contexts: rows.map((row) => ({
      id: row.id, sourceType: row.sourceType, seenAt: row.seenAt,
      sourceTitle: row.snapshot.sourceTitle, surfaceForm: row.snapshot.surfaceForm, sentenceText: row.snapshot.sentenceText,
      sectionNumber: row.snapshot.sectionNumber ?? null, startMs: row.snapshot.startMs ?? null, endMs: row.snapshot.endMs ?? null,
      revisitHref: sourceRevisitHref(row.snapshot),
    })),
  };
}
