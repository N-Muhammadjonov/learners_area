import "server-only";
import { and, asc, desc, eq, exists, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  courseModules,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  liveClasses,
  resourceBlocks,
  units,
  users,
} from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { authorizeCapability, type RiwiActor } from "./capabilities";
import { hasOpenExam } from "./dictionary";
import { liveWhere } from "@/lib/services/cms/publication";

export const RIWI_COURSE_LESSON_MATCH_LIMIT = 32;
export const RIWI_COURSE_EXCERPT_MAX_CHARS = 1800;
const OPEN_LESSON_STATES = ["available", "assigned", "in_progress", "completed"] as const;
const UUID_IN_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "about", "can", "could", "do", "does", "explain", "for", "from", "give", "help", "how", "i", "in", "is", "it", "lesson", "learn", "me", "module", "my", "of", "on", "please", "show", "tell", "that", "the", "this", "to", "unit", "use", "what", "which", "why", "with", "would",
  "kurs", "dars", "bo'lim", "modul", "iltimos", "tushuntir", "izohla", "qanday", "nima", "uchun", "men", "menga", "shu", "bu",
  "урок", "курс", "модуль", "объясни", "пожалуйста", "покажи", "что", "как", "мне", "этот", "эта",
]);

type CourseLessonDatabase = Pick<typeof db, "select">;
type CourseLessonActor = Pick<RiwiActor, "id" | "role">;

type AuthorizedLessonRow = {
  lessonId: string;
  courseId: string;
  courseTitle: string;
  moduleTitle: string;
  unitTitle: string;
  lessonTitle: string;
  summary: string | null;
};

export type AuthorizedRiwiCourseLesson = {
  courseId: string;
  lessonId: string;
  sourceTitle: string;
  excerpt: string;
};

function queryTerms(query: string): string[] {
  return [...new Set((query.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((term) => term.length >= 3 && term.length <= 40 && !STOP_WORDS.has(term)))].slice(0, 8);
}

function chooseRelevantExcerpt(content: string, query: string, maximum = RIWI_COURSE_EXCERPT_MAX_CHARS): string {
  const paragraphs = content.split(/\n+/).flatMap((paragraph) => paragraph.match(/[^.!?]+[.!?]?/g) ?? [])
    .map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "";
  const terms = queryTerms(query);
  const ranked = paragraphs.map((text, index) => {
    const normalized = text.normalize("NFKC").toLocaleLowerCase();
    const score = terms.reduce((sum, term) => sum + (normalized.includes(term) ? 1 : 0), 0);
    return { text, index, score };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: typeof ranked = [];
  let size = 0;
  for (const item of ranked) {
    const nextSize = size + item.text.length + (selected.length ? 1 : 0);
    if (nextSize > maximum) continue;
    selected.push(item);
    size = nextSize;
    if (size >= Math.min(maximum, 900) && item.score > 0) break;
  }
  if (selected.length === 0) return ranked[0]!.text.slice(0, maximum);
  return selected.sort((left, right) => left.index - right.index).map((item) => item.text).join(" ").slice(0, maximum);
}

async function authorizedLessonRows(
  actor: CourseLessonActor,
  database: CourseLessonDatabase,
  lessonId?: string,
  now = new Date(),
): Promise<AuthorizedLessonRow[]> {
  const [subject] = await database.select({ role: users.role, accountStatus: users.accountStatus })
    .from(users).where(eq(users.id, actor.id)).limit(1);
  if (!subject || subject.role !== actor.role || subject.accountStatus !== "active") return [];

  const serverActor: RiwiActor = { id: actor.id, role: subject.role as Role, accountStatus: subject.accountStatus };
  if (!authorizeCapability(serverActor, "riwi.content.read").allowed) return [];
  // Course lessons are unavailable during an active exam even when a saved
  // conversation or a previously valid course assignment is presented.
  if (await hasOpenExam(serverActor, database)) return [];

  const allowedState = inArray(lessons.defaultState, [...OPEN_LESSON_STATES]);
  const studentState = or(
    inArray(lessonProgress.state, [...OPEN_LESSON_STATES]),
    and(isNull(lessonProgress.id), allowedState),
  );
  const enrolled = exists(database.select({ id: enrollments.id }).from(enrollments).where(and(
    eq(enrollments.userId, actor.id), eq(enrollments.courseId, courses.id),
  )));
  // A live-class teacher assignment is the current, explicit course scope. An
  // admin may read only when the same operational assignment names that admin;
  // the owner role never supplies this assignment implicitly.
  const operationalAssignment = exists(database.select({ id: liveClasses.id }).from(liveClasses).where(and(
    eq(liveClasses.courseId, courses.id), eq(liveClasses.teacherUserId, actor.id), ne(liveClasses.status, "cancelled"),
  )));
  const roleScope = actor.role === "student" ? enrolled
    : actor.role === "teacher" || actor.role === "admin" ? operationalAssignment
      : actor.role === "owner" ? undefined : undefined;
  if (actor.role !== "owner" && !roleScope) return [];

  const conditions = [liveWhere(courses, now)];
  if (lessonId) conditions.push(eq(lessons.id, lessonId));
  if (roleScope) conditions.push(roleScope);
  // Students use their live per-learner progress state (falling back to the
  // course default only when no progress row exists). Staff use the authored
  // lesson state; neither path can expose a locked lesson.
  conditions.push(actor.role === "student" ? studentState! : allowedState);

  return database.select({
    lessonId: lessons.id,
    courseId: courses.id,
    courseTitle: courses.title,
    moduleTitle: courseModules.title,
    unitTitle: units.title,
    lessonTitle: lessons.title,
    summary: lessons.summary,
  }).from(lessons)
    .innerJoin(units, eq(units.id, lessons.unitId))
    .innerJoin(courseModules, eq(courseModules.id, units.moduleId))
    .innerJoin(courses, eq(courses.id, courseModules.courseId))
    .leftJoin(lessonProgress, and(eq(lessonProgress.lessonId, lessons.id), eq(lessonProgress.userId, actor.id)))
    .where(and(...conditions))
    .orderBy(asc(courses.title), asc(courseModules.order), asc(units.order), asc(lessons.order), asc(lessons.id))
    .limit(lessonId ? 1 : RIWI_COURSE_LESSON_MATCH_LIMIT);
}

async function authorizedLessonContent(
  actor: CourseLessonActor,
  lessonId: string,
  courseId: string,
  query: string,
  database: CourseLessonDatabase,
): Promise<AuthorizedRiwiCourseLesson | null> {
  const row = (await authorizedLessonRows(actor, database, lessonId))[0];
  if (!row || row.courseId !== courseId) return null;
  const blocks = await database.select({ text: resourceBlocks.textContent })
    .from(resourceBlocks)
    .where(and(
      eq(resourceBlocks.ownerType, "lesson"), eq(resourceBlocks.ownerId, row.lessonId),
      eq(resourceBlocks.type, "text"),
    ))
    .orderBy(asc(resourceBlocks.position), asc(resourceBlocks.id))
    .limit(4);
  const sourceText = [row.summary, ...blocks.map((block) => block.text)]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .join("\n");
  const excerpt = chooseRelevantExcerpt(sourceText, query);
  if (!excerpt) return null;
  const sourceTitle = [row.courseTitle, row.moduleTitle, row.unitTitle, row.lessonTitle].filter(Boolean).join(" › ").slice(0, 200);
  return { courseId: row.courseId, lessonId: row.lessonId, sourceTitle, excerpt };
}

/**
 * Search only the actor's currently authorized course lessons. Retrieval is
 * bounded before ranking, ambiguous matches fail closed, and neither a caller
 * supplied role nor a lesson id can expand the query scope.
 */
export async function findAuthorizedRiwiCourseLesson(
  actor: CourseLessonActor,
  query: string,
  database: CourseLessonDatabase = db,
): Promise<AuthorizedRiwiCourseLesson | null> {
  const safeQuery = query.trim().slice(0, 4000);
  const requestedIds = [...new Set(safeQuery.match(UUID_IN_TEXT) ?? [])];
  if (requestedIds.length > 1) return null;
  if (requestedIds.length === 1) {
    const rows = await authorizedLessonRows(actor, database, requestedIds[0]);
    const row = rows[0];
    return row ? authorizedLessonContent(actor, row.lessonId, row.courseId, safeQuery, database) : null;
  }

  const terms = queryTerms(safeQuery);
  if (terms.length === 0) return null;
  const rows = await authorizedLessonRows(actor, database);
  const ranked = rows.map((row) => {
    const haystack = [row.courseTitle, row.moduleTitle, row.unitTitle, row.lessonTitle, row.summary ?? ""]
      .join(" ").normalize("NFKC").toLocaleLowerCase();
    return { row, score: terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0) };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.row.lessonId.localeCompare(right.row.lessonId));
  if (!ranked[0] || ranked[1]?.score === ranked[0].score) return null;
  return authorizedLessonContent(actor, ranked[0].row.lessonId, ranked[0].row.courseId, safeQuery, database);
}

/** Re-checks a persisted course/lesson pair; deleted, unpublished, locked, or revoked scope returns false. */
export async function isAuthorizedRiwiCourseLesson(
  actor: CourseLessonActor,
  scope: { courseId: string; lessonId: string },
  database: CourseLessonDatabase = db,
): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.courseId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.lessonId)) return false;
  return (await authorizedLessonRows(actor, database, scope.lessonId)).some((row) => row.courseId === scope.courseId);
}

/** Test-only stable surface for the current role-derived course policy. */
export const RIWI_OPEN_LESSON_STATES: readonly string[] = OPEN_LESSON_STATES;
