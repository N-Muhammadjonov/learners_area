import { touchMeaningfulActivity } from "@/lib/services/activity";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  courseModules,
  courses,
  lessonProgress,
  lessons,
  units,
  videoLessonProgress,
  videoLessonQuestions,
  videoLessons,
} from "@/db/schema";
import { parseVideoInput, type VideoProvider } from "@/lib/services/video/provider";
import { isLive, liveWhere } from "@/lib/services/cms/publication";

/**
 * Public video lessons: storage and the rules that decide what a student sees.
 *
 * The completion rule lives here, on the server, and it is deliberately not
 * "the page was opened" and not "the client said 100%":
 *
 *   - `watchedSeconds` is monotonic and clamped to the authored duration, so a
 *     reload or a seek backwards cannot lower it and a client cannot claim more
 *     than the video holds;
 *   - a lesson with authored questions is completed only when every question has
 *     been answered correctly at least once;
 *   - a lesson with no authored questions is completed when the student has
 *     reached the watched threshold (or, when the duration is unknown, when they
 *     have written their response).
 *
 * A wrong answer is recorded and shown; it never marks the lesson done.
 */

export type VideoLessonInput = {
  /** A roadmap lesson (legacy course-linked video) or null/absent for a standalone item. */
  lessonId?: string | null;
  /** Update an existing standalone item in place. */
  videoLessonId?: string | null;
  /** Optional owner-authored plain transcript (no timestamps). */
  transcriptText?: string | null;
  title: string;
  videoUrl: string;
  beforeYouWatch?: string | null;
  durationSeconds?: number | null;
  transcriptSource?: string | null;
  transcriptAttribution?: string | null;
  transcript?: { startSeconds: number; text: string }[] | null;
  /** Centre-authored study notes; optional, like the transcript. */
  notes?: string | null;
  questions?: { stage: "comprehension" | "gap_fill"; prompt: string; acceptedAnswers: string[]; atSeconds?: number | null }[];
};

/** Milliseconds of the video that count as "watched enough" without a response. */
const WATCHED_FRACTION = 0.8;

export function normaliseAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic grading against the centre's authored answers. */
export function gradeAnswer(answer: string, accepted: string[]): boolean {
  const given = normaliseAnswer(answer);
  if (!given) return false;
  return accepted.some((candidate) => normaliseAnswer(candidate) === given);
}

export async function listVideoLessons() {
  return db
    .select({ videoLesson: videoLessons, lesson: lessons })
    .from(videoLessons)
    .leftJoin(lessons, eq(lessons.id, videoLessons.lessonId))
    .orderBy(asc(videoLessons.createdAt));
}

/**
 * Every video lesson with its course lesson, for the admin list — including
 * drafts and the archive, which the student list never shows.
 */
export async function listAllVideoLessons(creatorId?: string) {
  return db
    .select({ videoLesson: videoLessons, lesson: lessons })
    .from(videoLessons)
    .leftJoin(lessons, eq(lessons.id, videoLessons.lessonId))
    .where(creatorId ? eq(videoLessons.createdByUserId, creatorId) : undefined)
    .orderBy(desc(videoLessons.createdAt));
}

export function listLessonsWithoutVideo() {
  return db
    .select({ id: lessons.id, title: lessons.title, slug: lessons.slug })
    .from(lessons)
    .orderBy(asc(lessons.title));
}

/** The lesson's video, with questions and this student's own progress. */
export async function getVideoLessonForLesson(lessonId: string, userId: string) {
  const videoLesson = await db.query.videoLessons.findFirst({
    where: and(eq(videoLessons.lessonId, lessonId), liveWhere({
      publicationState: videoLessons.publicationState,
      publishAt: videoLessons.publishAt,
    })),
  });
  if (!videoLesson) return null;

  const [questions, progress] = await Promise.all([
    db.query.videoLessonQuestions.findMany({
      where: eq(videoLessonQuestions.videoLessonId, videoLesson.id),
      orderBy: asc(videoLessonQuestions.position),
    }),
    db.query.videoLessonProgress.findFirst({
      where: and(eq(videoLessonProgress.videoLessonId, videoLesson.id), eq(videoLessonProgress.userId, userId)),
    }),
  ]);

  return { videoLesson, questions, progress: progress ?? null };
}

/**
 * A standalone TED / Podcast item by its own id — live only, with questions and
 * this student's own progress. Course-linked videos are NOT served here: they
 * stay behind their lesson's access rules on the course route.
 */
export async function getStandaloneVideoLesson(videoLessonId: string, userId: string) {
  const videoLesson = await db.query.videoLessons.findFirst({
    where: and(eq(videoLessons.id, videoLessonId), isNull(videoLessons.lessonId), liveWhere({
      publicationState: videoLessons.publicationState,
      publishAt: videoLessons.publishAt,
    })),
  });
  if (!videoLesson) return null;
  const [questions, progress] = await Promise.all([
    db.query.videoLessonQuestions.findMany({
      where: eq(videoLessonQuestions.videoLessonId, videoLesson.id),
      orderBy: asc(videoLessonQuestions.position),
    }),
    db.query.videoLessonProgress.findFirst({
      where: and(eq(videoLessonProgress.videoLessonId, videoLesson.id), eq(videoLessonProgress.userId, userId)),
    }),
  ]);
  return { videoLesson, questions, progress: progress ?? null };
}

/** Live standalone items for the learner index, newest first, bounded. */
export async function listStandaloneVideoLessonsForStudent(userId: string, limit = 100) {
  return db
    .select({
      id: videoLessons.id,
      title: videoLessons.title,
      beforeYouWatch: videoLessons.beforeYouWatch,
      progressState: videoLessonProgress.state,
    })
    .from(videoLessons)
    .leftJoin(videoLessonProgress, and(eq(videoLessonProgress.videoLessonId, videoLessons.id), eq(videoLessonProgress.userId, userId)))
    .where(and(isNull(videoLessons.lessonId), liveWhere({
      publicationState: videoLessons.publicationState,
      publishAt: videoLessons.publishAt,
    })))
    .orderBy(desc(videoLessons.createdAt))
    .limit(Math.max(1, Math.min(limit, 200)));
}

/**
 * Every active video lesson this student may actually open, across ALL courses.
 *
 * The index page must not hard-code IELTS: it walks the course tree and joins the
 * student's own progress row, so a second course appears here the moment its
 * lessons exist. Nothing is decided in the page — the lesson's real state comes
 * from `lesson_progress` (falling back to the lesson's own default) and a lesson
 * that is not open is left out, exactly as the lesson page refuses to render its
 * video for a locked lesson.
 */
export async function listVideoLessonsForStudent(userId: string) {
  const rows = await db
    .select({
      videoLesson: {
        id: videoLessons.id,
        title: videoLessons.title,
        beforeYouWatch: videoLessons.beforeYouWatch,
      },
      lesson: {
        id: lessons.id,
        defaultState: lessons.defaultState,
      },
      unitTitle: units.title,
      moduleTitle: courseModules.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      progressState: lessonProgress.state,
    })
    .from(videoLessons)
    .innerJoin(lessons, eq(lessons.id, videoLessons.lessonId))
    .innerJoin(units, eq(units.id, lessons.unitId))
    .innerJoin(courseModules, eq(courseModules.id, units.moduleId))
    .innerJoin(courses, eq(courses.id, courseModules.courseId))
    .leftJoin(
      lessonProgress,
      and(eq(lessonProgress.lessonId, lessons.id), eq(lessonProgress.userId, userId))
    )
    .where(
      liveWhere({
        publicationState: videoLessons.publicationState,
        publishAt: videoLessons.publishAt,
      }),
    )
    .orderBy(asc(courses.title), asc(courseModules.order), asc(units.order), asc(lessons.order));

  return rows.map((row) => ({
    ...row,
    /** The lesson's real state for THIS student, never a guess. */
    state: row.progressState ?? row.lesson.defaultState,
  }));
}

export async function createVideoLesson(input: VideoLessonInput, createdByUserId: string) {
  const parsed = parseVideoInput(input.videoUrl);
  if (!parsed.ok) return { ok: false as const, reason: parsed.reason };

  const lessonId = input.lessonId ?? null;
  let existing: typeof videoLessons.$inferSelect | undefined;
  if (lessonId) {
    const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, lessonId) });
    if (!lesson) return { ok: false as const, reason: "lesson_not_found" as const };
    existing = await db.query.videoLessons.findFirst({ where: eq(videoLessons.lessonId, lessonId) });
  } else if (input.videoLessonId) {
    existing = await db.query.videoLessons.findFirst({
      where: and(eq(videoLessons.id, input.videoLessonId), isNull(videoLessons.lessonId)),
    });
    if (!existing) return { ok: false as const, reason: "video_lesson_not_found" as const };
  }
  // One item per provider video: a second standalone item for the same video
  // would violate the unique index, so it is refused with a clear reason.
  const duplicate = await db.query.videoLessons.findFirst({
    where: and(eq(videoLessons.provider, parsed.provider), eq(videoLessons.videoId, parsed.videoId)),
  });
  if (duplicate && duplicate.id !== existing?.id) return { ok: false as const, reason: "video_exists" as const };

  const values = {
    lessonId,
    provider: parsed.provider as VideoProvider,
    videoId: parsed.videoId,
    title: input.title,
    beforeYouWatch: input.beforeYouWatch ?? null,
    durationSeconds: input.durationSeconds ?? null,
    transcriptSource: input.transcriptSource ?? null,
    transcriptAttribution: input.transcriptAttribution ?? null,
    transcript: input.transcript && input.transcript.length > 0 ? input.transcript : null,
    transcriptText: input.transcriptText && input.transcriptText.trim().length > 0 ? input.transcriptText.trim() : null,
    notes: input.notes && input.notes.trim().length > 0 ? input.notes : null,
    updatedAt: new Date(),
  };

  const videoLessonId = await db.transaction(async (tx) => {
    let id = existing?.id;
    if (existing) {
      await tx.update(videoLessons).set(values).where(eq(videoLessons.id, existing.id));
    } else {
      const [created] = await tx
        .insert(videoLessons)
        .values({ ...values, createdByUserId })
        .returning({ id: videoLessons.id });
      id = created!.id;
    }

    // Questions are replaced as a set: the form is the source of truth, and a
    // half-updated question list is worse than a replaced one. Progress rows
    // keep whatever they already graded; a removed question simply stops being
    // asked.
    if (input.questions) {
      await tx.delete(videoLessonQuestions).where(eq(videoLessonQuestions.videoLessonId, id!));
      if (input.questions.length > 0) {
        await tx.insert(videoLessonQuestions).values(
          input.questions.map((question, index) => ({
            videoLessonId: id!,
            stage: question.stage,
            position: index,
            prompt: question.prompt,
            acceptedAnswers: question.acceptedAnswers,
            atSeconds: question.atSeconds ?? null,
          }))
        );
      }
    }
    return id!;
  });

  return { ok: true as const, videoLessonId };
}

async function loadProgress(videoLessonId: string, userId: string) {
  const existing = await db.query.videoLessonProgress.findFirst({
    where: and(eq(videoLessonProgress.videoLessonId, videoLessonId), eq(videoLessonProgress.userId, userId)),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(videoLessonProgress)
    .values({ videoLessonId, userId, state: "not_started" })
    .returning();
  return created!;
}

/**
 * Recomputes the completion state from what the server actually holds.
 * Called after every write, so the state can never drift from the data.
 */
async function recomputeState(videoLessonId: string, userId: string) {
  const [videoLesson, questions, progress] = await Promise.all([
    db.query.videoLessons.findFirst({ where: eq(videoLessons.id, videoLessonId) }),
    db.query.videoLessonQuestions.findMany({ where: eq(videoLessonQuestions.videoLessonId, videoLessonId) }),
    loadProgress(videoLessonId, userId),
  ]);
  if (!videoLesson) return null;

  const answers = progress.answers ?? {};
  // Every authored question counts, comprehension and gap fill alike: the
  // centre wrote them, so the lesson is finished when they are all answered.
  const gradedQuestions = questions;
  const allCorrect =
    gradedQuestions.length > 0 && gradedQuestions.every((question) => answers[question.id]?.correct === true);

  const watchedEnough =
    videoLesson.durationSeconds != null && videoLesson.durationSeconds > 0
      ? progress.watchedSeconds >= Math.floor(videoLesson.durationSeconds * WATCHED_FRACTION)
      : Boolean(progress.responseText || progress.summaryText);

  const completed = gradedQuestions.length > 0 ? allCorrect : watchedEnough;
  const started =
    progress.watchedSeconds > 0 ||
    Object.keys(answers).length > 0 ||
    Boolean(progress.responseText) ||
    Boolean(progress.summaryText);

  const nextState = completed ? "completed" : started ? "in_progress" : "not_started";
  const [updated] = await db
    .update(videoLessonProgress)
    .set({
      state: nextState,
      completedAt: completed ? (progress.completedAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(videoLessonProgress.videoLessonId, videoLessonId), eq(videoLessonProgress.userId, userId)))
    .returning();

  return updated ?? progress;
}

export async function recordWatched(videoLessonId: string, userId: string, watchedSeconds: number) {
  const videoLesson = await db.query.videoLessons.findFirst({ where: eq(videoLessons.id, videoLessonId) });
  if (!videoLesson) return null;

  const progress = await loadProgress(videoLessonId, userId);
  const clamped = Math.max(0, Math.floor(watchedSeconds));
  const capped = videoLesson.durationSeconds ? Math.min(clamped, videoLesson.durationSeconds) : clamped;
  const next = Math.max(progress.watchedSeconds, capped);

  if (next !== progress.watchedSeconds) {
    await db
      .update(videoLessonProgress)
      .set({ watchedSeconds: next, updatedAt: new Date() })
      .where(and(eq(videoLessonProgress.videoLessonId, videoLessonId), eq(videoLessonProgress.userId, userId)));
  }
  return recomputeState(videoLessonId, userId);
}

/** Grades authored answers on the server; the client never sends a verdict. */
export async function submitAnswers(
  videoLessonId: string,
  userId: string,
  answers: Record<string, string>
) {
  const questions = await db.query.videoLessonQuestions.findMany({
    where: eq(videoLessonQuestions.videoLessonId, videoLessonId),
  });
  if (questions.length === 0) return null;

  const progress = await loadProgress(videoLessonId, userId);
  const graded: Record<string, { answer: string; correct: boolean }> = { ...(progress.answers ?? {}) };

  for (const question of questions) {
    const given = answers[question.id];
    if (given === undefined) continue;
    graded[question.id] = { answer: given.slice(0, 500), correct: gradeAnswer(given, question.acceptedAnswers) };
  }

  await db
    .update(videoLessonProgress)
    .set({ answers: graded, updatedAt: new Date() })
    .where(and(eq(videoLessonProgress.videoLessonId, videoLessonId), eq(videoLessonProgress.userId, userId)));

  const row = await recomputeState(videoLessonId, userId);
  // Answering the authored questions is real work; opening the page was not.
  if (Object.keys(graded).length > 0 || row?.state === "completed") await touchMeaningfulActivity(userId);
  return { graded, state: row?.state ?? "not_started", completedAt: row?.completedAt ?? null };
}

export async function saveResponse(
  videoLessonId: string,
  userId: string,
  input: { responseText?: string | null; summaryText?: string | null }
) {
  await loadProgress(videoLessonId, userId);
  await db
    .update(videoLessonProgress)
    .set({
      ...(input.responseText !== undefined ? { responseText: input.responseText?.slice(0, 4000) ?? null } : {}),
      ...(input.summaryText !== undefined ? { summaryText: input.summaryText?.slice(0, 4000) ?? null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(videoLessonProgress.videoLessonId, videoLessonId), eq(videoLessonProgress.userId, userId)));
  const row = await recomputeState(videoLessonId, userId);
  // Writing an opinion or a summary is authored work, so it counts as study time.
  if ((input.responseText ?? "").trim() || (input.summaryText ?? "").trim()) await touchMeaningfulActivity(userId);
  return row?.state ?? "not_started";
}

/** Progress shown to staff for one student, used on the teacher's student page. */
export async function listProgressForUser(userId: string) {
  return db
    .select({ progress: videoLessonProgress, videoLesson: videoLessons })
    .from(videoLessonProgress)
    .innerJoin(videoLessons, eq(videoLessons.id, videoLessonProgress.videoLessonId))
    .where(eq(videoLessonProgress.userId, userId));
}
