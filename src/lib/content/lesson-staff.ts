import "server-only";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions, courseModules, courses, lessons, units } from "@/db/schema";
import { isLearningArea, type LearningArea } from "@/lib/content/learning-areas";

/**
 * The staff-side read model for the lesson authoring desk.
 *
 * This module READS. It never writes a lesson: every write goes through
 * `saveContentDraft` / `publishContentVersion` (the same services the admin content
 * workspace uses), so there is exactly one authoring path in the product.
 *
 * Why a staff reader exists at all: a learner library shows live lessons only, while
 * an author must see their DRAFT lessons too — including the ones nobody classified
 * into an area yet, which is exactly the work an author has to finish.
 */

export type StaffLessonRow = {
  id: string;
  title: string;
  slug: string;
  sourceRef: string;
  learningArea: string | null;
  publicationState: string;
  /** The newest lesson revision for this lesson, when one exists. */
  version: { id: string; versionNo: number; publicationState: string } | null;
  blockCount: number;
};

/** How many lesson rows one staff page shows. */
export const STAFF_LESSON_PAGE_MAX = 200;

/**
 * Lesson rows an author may work on: the area they asked for, plus unclassified.
 *
 * The area is a WHERE clause, not a post-filter: the same defect the learner catalogue
 * had (take the newest N rows first, ask what they are afterwards) would hide a
 * legitimate Listening lesson behind newer unrelated lessons on the authoring desk too.
 *
 * The filter is inclusive of NULL on purpose here (and only here): an unclassified
 * lesson is not "another area's lesson", it is unfinished work, and the authoring desk
 * is where it gets finished. A learner library never does this — it requires an area.
 */
export async function listLessonsForStaff(
  area: LearningArea,
  executor: { select: typeof db.select } = db,
): Promise<StaffLessonRow[]> {
  if (!isLearningArea(area)) return [];
  const rows = await executor
    .select({
      id: lessons.id,
      title: lessons.title,
      slug: lessons.slug,
      sourceRef: lessons.sourceRef,
      learningArea: lessons.learningArea,
      publicationState: lessons.publicationState,
      updatedAt: lessons.updatedAt,
    })
    .from(lessons)
    .where(or(eq(lessons.learningArea, area), isNull(lessons.learningArea)))
    .orderBy(desc(lessons.updatedAt))
    .limit(STAFF_LESSON_PAGE_MAX);

  const areaRows = rows;
  if (areaRows.length === 0) return [];
  const refs = [...new Set(areaRows.map((row) => row.sourceRef).filter((ref): ref is string => Boolean(ref)))];

  const versions = refs.length
    ? await executor
        .select({
          id: contentVersions.id,
          sourceRef: contentVersions.sourceRef,
          versionNo: contentVersions.versionNo,
          publicationState: contentVersions.publicationState,
        })
        .from(contentVersions)
        .where(and(eq(contentVersions.module, "lesson"), eq(contentVersions.contentType, "lesson"), inArray(contentVersions.sourceRef, refs)))
        .orderBy(desc(contentVersions.versionNo))
    : [];
  const latest = new Map<string, StaffLessonRow["version"]>();
  for (const version of versions) if (!latest.has(version.sourceRef)) latest.set(version.sourceRef, { id: version.id, versionNo: version.versionNo, publicationState: version.publicationState });

  return areaRows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    sourceRef: row.sourceRef ?? "",
    learningArea: row.learningArea,
    publicationState: row.publicationState,
    version: row.sourceRef ? (latest.get(row.sourceRef) ?? null) : null,
    blockCount: 0,
  }));
}

export type UnitOption = { id: string; label: string; course: string };

/**
 * Where a lesson may live. A lesson belongs to a unit, so the desk has to offer the
 * curriculum that exists — a lesson cannot be created into nowhere.
 */
export async function listUnitOptions(executor: { select: typeof db.select } = db): Promise<UnitOption[]> {
  const rows = await executor
    .select({ id: units.id, unit: units.title, module: courseModules.title, course: courses.title })
    .from(units)
    .innerJoin(courseModules, eq(units.moduleId, courseModules.id))
    .innerJoin(courses, eq(courseModules.courseId, courses.id))
    .orderBy(asc(courses.title), asc(courseModules.order), asc(units.order))
    .limit(500);
  return rows.map((row) => ({ id: row.id, label: `${row.course} › ${row.module} › ${row.unit}`, course: row.course }));
}
