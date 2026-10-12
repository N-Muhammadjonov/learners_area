import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  assignmentResponses,
  assignmentTargets,
  assignments,
  contentVersions,
  grammarAttempts,
  grammarExercises,
  grammarTopics,
  listeningAttempts,
  listeningTests,
  mockAttempts,
  mockTests,
  readingAttempts,
  readingPassages,
  speakingAttempts,
  speakingPrompts,
  writingPrompts,
  writingSubmissions,
} from "@/db/schema";

/**
 * THE CROSS-SKILL ATTEMPT TIMELINE (§AD).
 *
 * ONE learner history projection. It is a READ over the real domain attempts —
 * Reading, Listening, Writing, Speaking, Grammar, Mock and Assignment — and it stores
 * nothing of its own:
 *
 *   • there is no timeline table. Every entry carries a `reference` naming the exact
 *     row it represents (`table` + `id`), so the timeline can never disagree with the
 *     attempt, and deleting learner history is never a decision made here;
 *   • no attempt is copied, moved or rewritten. The values an entry shows (score,
 *     word count, duration, correctness, status) come from the row itself;
 *   • canonical identity is a REFERENCE too: when an attempt bound a
 *     `contentVersionId`, the entry resolves it against `content_versions` in one
 *     query and reports the identity it names. Old work keeps naming the revision it
 *     was done against, which is the point of pinning at all;
 *   • the projection is bounded: one query per kind (each already limited), a merge in
 *     memory over at most `kinds × limit` rows, and `limit` itself capped. There is no
 *     N+1 and no unbounded payload.
 *
 * What it is NOT: a second source of truth, an analytics store, or a place to
 * reconstruct history that a domain row already records. If a fact is not in the
 * attempt row, the entry does not claim it.
 */

export const TIMELINE_KINDS = ["reading", "listening", "writing", "speaking", "grammar", "mock", "assignment"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/** Where an entry's truth lives: the table and the row, named exactly. */
export type TimelineReference = { table: string; id: string };

/** The canonical revision the work was done against, resolved by reference. */
export type TimelineContentRef = {
  versionId: string | null;
  versionNo: number | null;
  module: string | null;
  contentType: string | null;
  sourceRef: string | null;
};

/** Facts exactly as the domain row reports them — never recomputed here. */
export type TimelineFacts = {
  status: string;
  scoreEarned: number | null;
  scoreTotal: number | null;
  band: number | null;
  wordCount: number | null;
  durationMs: number | null;
  hasRecording: boolean | null;
  isCorrect: boolean | null;
};

export type TimelineEntry = {
  kind: TimelineKind;
  reference: TimelineReference;
  occurredAt: Date;
  completedAt: Date | null;
  /** What the learner sees as the name of the work; falls back to the domain's own words. */
  title: string;
  href: string;
  content: TimelineContentRef | null;
  facts: TimelineFacts;
  /** Present for Assignment entries: the task this response answers. */
  assignmentId: string | null;
};

export type TimelineOptions = {
  limit?: number;
  kinds?: readonly TimelineKind[];
  from?: Date | null;
  to?: Date | null;
  /**
   * Called when ONE kind could not be read. The rest of the history is still returned —
   * a failed region stays local — but the failure is reported to the caller instead of
   * being silently swallowed, so a screen can say what it could not show.
   */
  onUnavailable?: (kind: TimelineKind, error: unknown) => void;
};

export const TIMELINE_DEFAULT_LIMIT = 50;
export const TIMELINE_MAX_LIMIT = 200;

/** A prompt doubles as a name in a list: show its beginning, never the whole essay-sized body. */
const shorten = (value: string | null | undefined, max = 120): string | null => {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};

const facts = (partial: Partial<TimelineFacts> & { status: string }): TimelineFacts => ({
  scoreEarned: null,
  scoreTotal: null,
  band: null,
  wordCount: null,
  durationMs: null,
  hasRecording: null,
  isCorrect: null,
  ...partial,
});

/** The learner's own timeline: their attempts, nothing else. */
export async function getAttemptTimeline(userId: string, options: TimelineOptions = {}, executor: { select: typeof db.select } = db): Promise<TimelineEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? TIMELINE_DEFAULT_LIMIT, 1), TIMELINE_MAX_LIMIT);
  const kinds = (options.kinds && options.kinds.length > 0 ? [...new Set(options.kinds)] : [...TIMELINE_KINDS]).filter(
    (kind): kind is TimelineKind => (TIMELINE_KINDS as readonly string[]).includes(kind),
  );
  if (kinds.length === 0) return [];

  const windowOf = <T extends { occurredAt: Date | null }>(rows: T[]): T[] =>
    rows.filter((row) => (!row.occurredAt ? false : (!options.from || row.occurredAt >= options.from) && (!options.to || row.occurredAt <= options.to)));

  // One kind at a time: a learner's history is a handful of bounded queries, and
  // running them in sequence keeps a single busy connection from turning seven small
  // reads into a thundering herd. A kind that cannot be read is reported and skipped,
  // so the timeline degrades by region instead of disappearing (§failure isolation).
  const collected: TimelineEntry[][] = [];
  for (const kind of kinds) {
    try {
      collected.push(await readKind(kind, userId, limit, windowOf, executor));
    } catch (error) {
      if (!options.onUnavailable) throw error;
      options.onUnavailable(kind, error);
    }
  }

  return collected
    .flat()
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || a.reference.id.localeCompare(b.reference.id))
    .slice(0, limit);
}

type Select = typeof db.select;

async function readKind(
  kind: TimelineKind,
  userId: string,
  limit: number,
  windowOf: <T extends { occurredAt: Date | null }>(rows: T[]) => T[],
  executor: { select: Select },
): Promise<TimelineEntry[]> {
  const rows: { occurredAt: Date | null; entry: TimelineEntry }[] = [];

  if (kind === "reading") {
    const data = await executor
      .select({
        id: readingAttempts.id,
        status: readingAttempts.status,
        startedAt: readingAttempts.startedAt,
        submittedAt: readingAttempts.submittedAt,
        score: readingAttempts.score,
        total: readingAttempts.totalQuestions,
        versionId: readingAttempts.contentVersionId,
        title: readingPassages.title,
        passageNo: readingPassages.passageNo,
      })
      .from(readingAttempts)
      .leftJoin(readingPassages, eq(readingPassages.id, readingAttempts.passageId))
      .where(eq(readingAttempts.userId, userId))
      .orderBy(desc(readingAttempts.startedAt))
      .limit(limit);
    for (const row of data)
      rows.push({
        occurredAt: row.startedAt,
        entry: {
          kind,
          reference: { table: "reading_attempts", id: row.id },
          occurredAt: row.startedAt ?? row.submittedAt ?? new Date(0),
          completedAt: row.submittedAt,
          title: row.title ?? (row.passageNo ? `Reading passage ${row.passageNo}` : "Reading"),
          href: `/app/reading/attempts/${row.id}`,
          content: row.versionId ? { versionId: row.versionId, versionNo: null, module: "reading", contentType: null, sourceRef: null } : null,
          facts: facts({ status: row.status, scoreEarned: row.score, scoreTotal: row.total }),
          assignmentId: null,
        },
      });
  }

  if (kind === "listening") {
    const data = await executor
      .select({
        id: listeningAttempts.id,
        status: listeningAttempts.status,
        startedAt: listeningAttempts.startedAt,
        submittedAt: listeningAttempts.submittedAt,
        score: listeningAttempts.score,
        total: listeningAttempts.totalQuestions,
        versionId: listeningAttempts.contentVersionId,
        title: listeningTests.title,
      })
      .from(listeningAttempts)
      .leftJoin(listeningTests, eq(listeningTests.id, listeningAttempts.testId))
      .where(eq(listeningAttempts.userId, userId))
      .orderBy(desc(listeningAttempts.startedAt))
      .limit(limit);
    for (const row of data)
      rows.push({
        occurredAt: row.startedAt,
        entry: {
          kind,
          reference: { table: "listening_attempts", id: row.id },
          occurredAt: row.startedAt ?? row.submittedAt ?? new Date(0),
          completedAt: row.submittedAt,
          title: row.title ?? "Listening",
          href: `/app/listening/attempts/${row.id}`,
          content: row.versionId ? { versionId: row.versionId, versionNo: null, module: "listening", contentType: null, sourceRef: null } : null,
          facts: facts({ status: row.status, scoreEarned: row.score, scoreTotal: row.total }),
          assignmentId: null,
        },
      });
  }

  if (kind === "writing") {
    const data = await executor
      .select({
        id: writingSubmissions.id,
        status: writingSubmissions.status,
        createdAt: writingSubmissions.createdAt,
        submittedAt: writingSubmissions.submittedAt,
        updatedAt: writingSubmissions.updatedAt,
        wordCount: writingSubmissions.wordCount,
        versionId: writingSubmissions.contentVersionId,
        prompt: writingPrompts.prompt,
      })
      .from(writingSubmissions)
      .leftJoin(writingPrompts, eq(writingPrompts.id, writingSubmissions.promptId))
      .where(eq(writingSubmissions.userId, userId))
      .orderBy(desc(writingSubmissions.updatedAt))
      .limit(limit);
    for (const row of data)
      rows.push({
        occurredAt: row.updatedAt,
        entry: {
          kind,
          reference: { table: "writing_submissions", id: row.id },
          occurredAt: row.submittedAt ?? row.updatedAt,
          completedAt: row.submittedAt,
          title: shorten(row.prompt) ?? "Writing",
          href: `/app/writing/submissions/${row.id}`,
          content: row.versionId ? { versionId: row.versionId, versionNo: null, module: "writing", contentType: null, sourceRef: null } : null,
          facts: facts({ status: row.status, wordCount: row.wordCount }),
          assignmentId: null,
        },
      });
  }

  if (kind === "speaking") {
    const data = await executor
      .select({
        id: speakingAttempts.id,
        status: speakingAttempts.status,
        startedAt: speakingAttempts.startedAt,
        submittedAt: speakingAttempts.submittedAt,
        durationMs: speakingAttempts.recordingDurationMs,
        recordingKey: speakingAttempts.recordingObjectKey,
        versionId: speakingAttempts.contentVersionId,
        part: speakingAttempts.part,
        topic: speakingPrompts.topic,
        promptText: speakingPrompts.promptText,
      })
      .from(speakingAttempts)
      .leftJoin(speakingPrompts, eq(speakingPrompts.id, speakingAttempts.promptId))
      .where(eq(speakingAttempts.userId, userId))
      .orderBy(desc(speakingAttempts.createdAt))
      .limit(limit);
    for (const row of data)
      rows.push({
        occurredAt: row.startedAt,
        entry: {
          kind,
          reference: { table: "speaking_attempts", id: row.id },
          occurredAt: row.startedAt ?? row.submittedAt ?? new Date(0),
          completedAt: row.submittedAt,
          title: shorten(row.topic ?? row.promptText) ?? (row.part ? `Speaking part ${row.part}` : "Speaking"),
          href: "/app/speaking/history",
          content: row.versionId ? { versionId: row.versionId, versionNo: null, module: "speaking", contentType: null, sourceRef: null } : null,
          // The recording stays where it is; the timeline reports only that it exists.
          facts: facts({ status: row.status, durationMs: row.durationMs, hasRecording: Boolean(row.recordingKey) }),
          assignmentId: null,
        },
      });
  }

  if (kind === "grammar") {
    const data = await executor
      .select({
        id: grammarAttempts.id,
        activity: grammarAttempts.activity,
        isCorrect: grammarAttempts.isCorrect,
        attemptedAt: grammarAttempts.attemptedAt,
        versionId: grammarAttempts.contentVersionId,
        topicId: grammarExercises.topicId,
        topicTitle: grammarTopics.title,
        prompt: grammarExercises.promptText,
      })
      .from(grammarAttempts)
      .leftJoin(grammarExercises, eq(grammarExercises.id, grammarAttempts.exerciseId))
      .leftJoin(grammarTopics, eq(grammarTopics.id, grammarExercises.topicId))
      .where(eq(grammarAttempts.userId, userId))
      .orderBy(desc(grammarAttempts.attemptedAt))
      .limit(limit);
    for (const row of data)
      rows.push({
        occurredAt: row.attemptedAt,
        entry: {
          kind,
          reference: { table: "grammar_attempts", id: row.id },
          occurredAt: row.attemptedAt,
          completedAt: row.attemptedAt,
          title: row.topicTitle ?? row.prompt ?? "Grammar",
          href: row.topicId ? `/app/grammar/${row.topicId}` : "/app/grammar",
          content: row.versionId ? { versionId: row.versionId, versionNo: null, module: "grammar", contentType: null, sourceRef: null } : null,
          facts: facts({ status: row.activity ?? "answered", isCorrect: row.isCorrect }),
          assignmentId: null,
        },
      });
  }

  if (kind === "mock") {
    const data = await executor
      .select({
        id: mockAttempts.id,
        status: mockAttempts.status,
        startedAt: mockAttempts.startedAt,
        finishedAt: mockAttempts.finishedAt,
        rawScore: mockAttempts.rawScore,
        estimatedBand: mockAttempts.estimatedBand,
        snapshot: mockAttempts.mockSnapshot,
        bindings: mockAttempts.contentVersionBindings,
        title: mockTests.title,
      })
      .from(mockAttempts)
      .leftJoin(mockTests, eq(mockTests.id, mockAttempts.mockTestId))
      .where(eq(mockAttempts.userId, userId))
      .orderBy(desc(mockAttempts.startedAt))
      .limit(limit);
    for (const row of data) {
      const boundIds = Object.values(row.bindings ?? {}).filter((value): value is string => typeof value === "string" && value.length > 0);
      rows.push({
        occurredAt: row.startedAt,
        entry: {
          kind,
          reference: { table: "mock_attempts", id: row.id },
          occurredAt: row.startedAt ?? row.finishedAt ?? new Date(0),
          completedAt: row.finishedAt,
          // The attempt's own snapshot is the name a learner recognises, even if the mock was later edited.
          title: row.snapshot?.title ?? row.title ?? "Mock test",
          href: "/app/mocks",
          content: boundIds.length > 0 ? { versionId: boundIds[0]!, versionNo: null, module: "mock", contentType: null, sourceRef: null } : null,
          facts: facts({ status: row.status, band: row.estimatedBand, scoreEarned: row.rawScore }),
          assignmentId: null,
        },
      });
    }
  }

  if (kind === "assignment") {
    const data = await executor
      .select({
        id: assignmentResponses.id,
        createdAt: assignmentResponses.createdAt,
        updatedAt: assignmentResponses.updatedAt,
        assignmentId: assignments.id,
        title: assignments.title,
        module: assignments.module,
        contentType: assignments.contentType,
        sourceRef: assignments.sourceRef,
        versionId: assignments.contentVersionId,
        targetStatus: assignmentTargets.status,
        targetCompletedAt: assignmentTargets.completedAt,
      })
      .from(assignmentResponses)
      .leftJoin(assignments, eq(assignments.id, assignmentResponses.assignmentId))
      .leftJoin(
        assignmentTargets,
        and(eq(assignmentTargets.assignmentId, assignmentResponses.assignmentId), eq(assignmentTargets.studentUserId, assignmentResponses.userId)),
      )
      .where(eq(assignmentResponses.userId, userId))
      .orderBy(desc(assignmentResponses.updatedAt))
      .limit(limit);
    for (const row of data)
      rows.push({
        occurredAt: row.updatedAt,
        entry: {
          kind,
          reference: { table: "assignment_responses", id: row.id },
          occurredAt: row.updatedAt ?? row.createdAt,
          completedAt: row.targetCompletedAt,
          title: row.title ?? "Assignment",
          href: "/app/assignments",
          // The assignment's own tuple is the pinned identity; a compatibility row may
          // carry the tuple without a revision, and then versionNo stays null.
          content:
            row.module && row.contentType && row.sourceRef
              ? { versionId: row.versionId ?? null, versionNo: null, module: row.module, contentType: row.contentType, sourceRef: row.sourceRef }
              : null,
          facts: facts({ status: row.targetStatus ?? "submitted" }),
          assignmentId: row.assignmentId ?? null,
        },
      });
  }

  return windowOf(rows).map((row) => row.entry);
}

/**
 * Resolve the canonical identity named by the entries' `contentVersionId` references.
 *
 * One query for the whole page, and a miss is left as a miss: an attempt whose revision
 * is gone still appears, with its own facts, rather than being hidden or invented.
 */
export async function resolveTimelineContent(entries: TimelineEntry[], executor: { select: typeof db.select } = db): Promise<TimelineEntry[]> {
  const versionIds = [...new Set(entries.map((entry) => entry.content?.versionId).filter((id): id is string => Boolean(id)))];
  if (versionIds.length === 0) return entries;

  const rows = await executor
    .select({
      id: contentVersions.id,
      module: contentVersions.module,
      contentType: contentVersions.contentType,
      sourceRef: contentVersions.sourceRef,
      versionNo: contentVersions.versionNo,
      title: contentVersions.title,
    })
    .from(contentVersions)
    .where(inArray(contentVersions.id, versionIds));
  const byId = new Map(rows.map((row) => [row.id, row]));

  return entries.map((entry) => {
    const versionId = entry.content?.versionId;
    if (!versionId) return entry;
    const version = byId.get(versionId);
    if (!version) return entry;
    return {
      ...entry,
      content: {
        versionId: version.id,
        versionNo: version.versionNo,
        module: version.module,
        contentType: version.contentType,
        sourceRef: version.sourceRef,
      },
    };
  });
}

/** The timeline a learner reads: their own history, with identities resolved. */
export async function getLearnerTimeline(
  userId: string,
  options: TimelineOptions = {},
  executor: { select: typeof db.select } = db,
): Promise<TimelineEntry[]> {
  return resolveTimelineContent(await getAttemptTimeline(userId, options, executor), executor);
}
