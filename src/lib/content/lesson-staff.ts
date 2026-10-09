import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
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

/** One revision, as much as a list row needs to state what it is. */
export type StaffRevision = { id: string; versionNo: number; publicationState: string };

export type StaffLessonRow = {
  id: string;
  title: string;
  slug: string;
  sourceRef: string;
  learningArea: string | null;
  publicationState: string;
  /**
   * The newest lesson revision, kept for callers that only need "is there one".
   * The two fields below are what tells an author which revision they would edit.
   */
  version: StaffRevision | null;
  /** The revision an author may edit in place, when one exists. */
  draft: StaffRevision | null;
  /** The revision students are being served. */
  published: StaffRevision | null;
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
          status: contentVersions.status,
        })
        .from(contentVersions)
        .where(and(eq(contentVersions.module, "lesson"), eq(contentVersions.contentType, "lesson"), inArray(contentVersions.sourceRef, refs)))
        .orderBy(desc(contentVersions.versionNo))
    : [];
  const latest = new Map<string, StaffLessonRow["version"]>();
  const drafts = new Map<string, StaffLessonRow["draft"]>();
  const published = new Map<string, StaffLessonRow["published"]>();
  for (const version of versions) {
    const ref = { id: version.id, versionNo: version.versionNo, publicationState: version.publicationState };
    if (!latest.has(version.sourceRef)) latest.set(version.sourceRef, ref);
    // Drafts are newest-first, so the first one seen is the editable revision.
    if (version.status === "draft" && version.publicationState === "draft" && !drafts.has(version.sourceRef)) drafts.set(version.sourceRef, ref);
    if (version.status === "published" && version.publicationState === "published" && !published.has(version.sourceRef))
      published.set(version.sourceRef, ref);
  }

  return areaRows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    sourceRef: row.sourceRef ?? "",
    learningArea: row.learningArea,
    publicationState: row.publicationState,
    version: row.sourceRef ? (latest.get(row.sourceRef) ?? null) : null,
    draft: row.sourceRef ? (drafts.get(row.sourceRef) ?? null) : null,
    published: row.sourceRef ? (published.get(row.sourceRef) ?? null) : null,
    blockCount: 0,
  }));
}

export type UnitOption = { id: string; label: string; course: string };

/**
 * Where a lesson may live. A lesson belongs to a unit, so the desk has to offer the
 * curriculum that exists — a lesson cannot be created into nowhere.
 */
/** One bounded page of unit options. The desk never loads the whole curriculum at once. */
const UNIT_PAGE = 500;

export type UnitOptionPage = {
  options: UnitOption[];
  /** True when more units match than were returned. */
  hasMore: boolean;
  /**
   * Opaque keyset cursor for the next page, or null at the end.
   *
   * Search alone cannot guarantee reachability: 620 units sharing one title inside one
   * module leave nothing to type that narrows below the page size, so everything past
   * the first page would be unselectable. The listing order
   * (course title, module order, unit order, id) is TOTAL, so a keyset cursor walks it
   * exactly once — no duplicates, no omissions, and no OFFSET rescan.
   */
  nextCursor: string | null;
  /** How many units match in total, so the desk can be specific. */
  matching: number;
  /** The page size this read was bounded to. */
  pageSize: number;
};

/** Encode/decode the ordering key. Opaque to callers; validated on the way back in. */
function encodeUnitCursor(row: { course: string; moduleOrder: number; unitOrder: number; id: string }): string {
  return Buffer.from(JSON.stringify([row.course, row.moduleOrder, row.unitOrder, row.id]), "utf8").toString("base64url");
}

function decodeUnitCursor(raw: string): { course: string; moduleOrder: number; unitOrder: number; id: string } {
  if (raw.trim() === "") throw new Error("invalid unit cursor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid unit cursor");
  }
  if (
    !Array.isArray(parsed) || parsed.length !== 4 ||
    typeof parsed[0] !== "string" || typeof parsed[1] !== "number" ||
    typeof parsed[2] !== "number" || typeof parsed[3] !== "string"
  ) {
    // A malformed cursor must not quietly fall back to page 1: that would silently
    // restart the walk and re-serve rows the caller has already seen.
    throw new Error("invalid unit cursor");
  }
  return { course: parsed[0], moduleOrder: parsed[1], unitOrder: parsed[2], id: parsed[3] };
}

export async function listUnitOptions(
  executor: { select: typeof db.select } = db,
  opts: { search?: string; cursor?: string } = {},
): Promise<UnitOptionPage> {
  // A bare limit made unit #501+ silently unselectable once a centre grew past one page.
  // The read stays bounded, but a server-side search over the full corpus keeps every
  // unit reachable, and the caller is told when a page is not the whole truth.
  const term = (opts.search ?? "").trim();
  const where = term
    ? sql`(${units.title} ilike ${`%${term}%`} or ${courseModules.title} ilike ${`%${term}%`} or ${courses.title} ilike ${`%${term}%`})`
    : undefined;

  // Row-value comparison against the exact ordering tuple: everything strictly after
  // the last row the caller saw, in one index-friendly predicate.
  // `!= null`, not truthiness: an empty-string cursor is a malformed cursor the caller
  // actually sent, and must be refused rather than falling through to page 1.
  const after = opts.cursor != null ? decodeUnitCursor(opts.cursor) : null;
  const keyset = after
    ? sql`(${courses.title}, ${courseModules.order}, ${units.order}, ${units.id}) > (${after.course}, ${after.moduleOrder}, ${after.unitOrder}, ${after.id})`
    : undefined;
  const conds = [where, keyset].filter(Boolean) as SQL[];
  const scope = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

  const base = executor
    .select({
      id: units.id,
      unit: units.title,
      module: courseModules.title,
      course: courses.title,
      moduleOrder: courseModules.order,
      unitOrder: units.order,
    })
    .from(units)
    .innerJoin(courseModules, eq(units.moduleId, courseModules.id))
    .innerJoin(courses, eq(courseModules.courseId, courses.id));

  const rows = await (scope ? base.where(scope) : base)
    .orderBy(asc(courses.title), asc(courseModules.order), asc(units.order), asc(units.id))
    .limit(UNIT_PAGE + 1);

  const hasMore = rows.length > UNIT_PAGE;
  const page = hasMore ? rows.slice(0, UNIT_PAGE) : rows;

  const countBase = executor
    .select({ matching: sql<number>`count(*)::int` })
    .from(units)
    .innerJoin(courseModules, eq(units.moduleId, courseModules.id))
    .innerJoin(courses, eq(courseModules.courseId, courses.id));
  const [{ matching = 0 } = {}] = await (where ? countBase.where(where) : countBase);

  const last = page[page.length - 1];
  return {
    options: page.map((row) => ({ id: row.id, label: `${row.course} › ${row.module} › ${row.unit}`, course: row.course })),
    hasMore,
    nextCursor: hasMore && last
      ? encodeUnitCursor({ course: last.course, moduleOrder: last.moduleOrder, unitOrder: last.unitOrder, id: last.id })
      : null,
    matching,
    pageSize: UNIT_PAGE,
  };
}
