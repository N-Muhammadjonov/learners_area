import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { courses, courseModules, units, lessons, lessonProgress } from "@/db/schema";

export async function getCourseRoadmap(slug: string, userId: string) {
  const course = await db.query.courses.findFirst({ where: eq(courses.slug, slug) });
  if (!course) return null;

  const modules = await db.query.courseModules.findMany({
    where: eq(courseModules.courseId, course.id),
    orderBy: asc(courseModules.order),
  });

  const moduleIds = modules.map((module) => module.id);
  const relevantUnits = moduleIds.length
    ? await db.query.units.findMany({ where: inArray(units.moduleId, moduleIds), orderBy: asc(units.order) })
    : [];

  const unitIds = relevantUnits.map((unit) => unit.id);
  const [relevantLessons, progressRows] = unitIds.length
    ? await Promise.all([
        db.query.lessons.findMany({ where: inArray(lessons.unitId, unitIds), orderBy: asc(lessons.order) }),
        db.select({ lessonId: lessonProgress.lessonId, state: lessonProgress.state })
          .from(lessonProgress)
          .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
          .where(and(eq(lessonProgress.userId, userId), inArray(lessons.unitId, unitIds))),
      ])
    : [[], []];
  const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p.state]));

  return {
    course,
    modules: modules.map((m) => ({
      ...m,
      units: relevantUnits
        .filter((u) => u.moduleId === m.id)
        .map((u) => ({
          ...u,
          lessons: relevantLessons
            .filter((l) => l.unitId === u.id)
            .map((l) => ({ ...l, state: progressByLesson.get(l.id) ?? l.defaultState })),
        })),
    })),
  };
}

export async function getLessonDetail(lessonId: string, userId: string) {
  const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, lessonId) });
  if (!lesson) return null;

  const [unit, row] = await Promise.all([
    db.query.units.findFirst({ where: eq(units.id, lesson.unitId) }),
    db.query.lessonProgress.findFirst({
      where: and(eq(lessonProgress.lessonId, lesson.id), eq(lessonProgress.userId, userId)),
    }),
  ]);

  const state = row?.state ?? lesson.defaultState;
  return {
    lesson,
    unitTitle: unit?.title ?? null,
    state,
    notes: row?.notes ?? null,
    completedAt: row?.completedAt ?? null,
  };
}
