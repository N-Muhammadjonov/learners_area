import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  assignmentTargets,
  assignments,
  contentVersions,
  grammarTopics,
  lessons,
  listeningTests,
  readingPassages,
  speakingMaterials,
  speakingPrompts,
  teacherStudentLinks,
  users,
  generalReadingSets,
  videoLessons,
  vocabularyTopicPacks,
  writingPrompts,
} from "@/db/schema";
import { contentTypeKey, isKnownContentType, isKnownModule, moduleDescriptor, referenceProblems } from "@/lib/content/taxonomy";
import { liveWhere } from "@/lib/services/cms/publication";
import { publishedVersion, versionById, versionContent, type VersionReader } from "@/lib/content/versions";
import { isAdministrator, roleAtLeast } from "@/lib/auth/roles";
import { registerModuleAuthors, resolveModuleAuthor } from "@/lib/content/authors";
import type { ImportTransaction } from "@/lib/import/core/dry-run";

/**
 * ASSIGNMENTS over canonical content (§24, §25, §99).
 *
 * A task is not prose any more: it references canonical content by
 * (module, content type, source ref) and pins the EXACT revision the learner is
 * given. That is what makes two promises keepable:
 *
 *   - the learner always works on what the teacher set, even after the content is
 *     edited (the pinned revision is recorded on the assignment and on the work);
 *   - "what did this student actually do?" is answerable from the record, because
 *     the assignment, the attempt and the revision are connected by id.
 *
 * ROLE BOUNDARIES are enforced here, not in a route:
 *   - only staff create assignments;
 *   - a TEACHER may only set work for a student on their own roster
 *     (`teacher_student_links` — the same explicit roster the Reporter uses, so
 *     nothing is inferred); an administrator may set work for any student;
 *   - a learner may only see and answer their own tasks;
 *   - nobody assigns to a non-student.
 */

export type AssignmentActor = { id: string; role: string };

export type AssignmentIssue = { code: string; message: string; field?: string };

export type SaveAssignmentInput = {
  actor: AssignmentActor;
  title: string;
  description?: string | null;
  instructions?: string | null;
  /** Canonical content reference. At least one of `versionId` / `sourceRef` is required. */
  reference: { module: string; contentType: string; sourceRef: string; versionId?: string | null };
  studentIds: string[];
  dueAt?: Date | null;
};

export type SaveAssignmentResult =
  | { ok: true; assignmentId: string; targets: string[]; versionId: string }
  | { ok: false; issues: AssignmentIssue[] };

const issue = (code: string, message: string, field?: string): AssignmentIssue => ({ code, message, field });

/** May this actor set work for this student? The rule lives in one place. */
export async function mayAssignTo(
  actor: AssignmentActor,
  studentUserId: string,
  executor: { select: typeof db.select; query: typeof db.query } = db,
): Promise<{ allowed: boolean; reason?: "not_staff" | "not_a_student" | "outside_roster" }> {
  if (!roleAtLeast(actor.role as never, "teacher")) return { allowed: false, reason: "not_staff" };
  const [student] = await executor.select({ role: users.role }).from(users).where(eq(users.id, studentUserId)).limit(1);
  if (!student) return { allowed: false, reason: "not_a_student" };
  if (student.role !== "student") return { allowed: false, reason: "not_a_student" };
  if (isAdministrator(actor.role as never)) return { allowed: true };
  const [link] = await executor
    .select({ id: teacherStudentLinks.id })
    .from(teacherStudentLinks)
    .where(and(eq(teacherStudentLinks.teacherUserId, actor.id), eq(teacherStudentLinks.studentUserId, studentUserId)))
    .limit(1);
  return link ? { allowed: true } : { allowed: false, reason: "outside_roster" };
}

/** Who may read an assignment and its responses. */
export function mayReadAssignment(
  actor: AssignmentActor,
  assignment: { createdByUserId: string; targetUserId: string },
  targetStudentIds: string[],
): boolean {
  if (targetStudentIds.includes(actor.id)) return true;
  if (actor.id === assignment.createdByUserId) return true;
  return isAdministrator(actor.role as never);
}

/**
 * Create (or re-target) an assignment.
 *
 * The content reference is resolved against the VERSION STORE, never against user
 * input: the revision must exist, must belong to the named content, and must be
 * published — you cannot set work nobody can open (§44, §102).
 */
export async function createAssignment(
  tx: ImportTransaction & { insert: typeof db.insert; update: typeof db.update },
  input: SaveAssignmentInput,
): Promise<SaveAssignmentResult> {
  const issues: AssignmentIssue[] = [];
  if (!input.title.trim()) issues.push(issue("missing_title", "An assignment needs a title.", "title"));
  const descriptor = moduleDescriptor(input.reference.module);
  if (!descriptor || !descriptor.contentTypes.includes(input.reference.contentType))
    issues.push(issue("unknown_content_type", `"${contentTypeKey(input.reference.module, input.reference.contentType)}" is not a known content type.`, "reference"));
  if (!input.reference.sourceRef.trim()) issues.push(issue("missing_source_ref", "An assignment must reference canonical content.", "reference"));
  if (input.studentIds.length === 0) issues.push(issue("no_targets", "An assignment needs at least one student.", "studentIds"));

  for (const problem of referenceProblems(
    { module: input.reference.module, contentType: input.reference.contentType, sourceRef: input.reference.sourceRef, versionId: input.reference.versionId ?? null },
    { requireVersion: Boolean(input.reference.versionId) },
  ))
    if (problem.code !== "version_required") issues.push(issue(problem.code, problem.message, "reference"));
  if (issues.length) return { ok: false, issues };

  // Resolve the revision to pin: the named one, or the latest published revision.
  const version = input.reference.versionId
    ? await versionById(input.reference.versionId, tx as unknown as VersionReader)
    : await publishedVersion(input.reference.module, input.reference.contentType, input.reference.sourceRef, tx as unknown as VersionReader);
  if (!version)
    return {
      ok: false,
      issues: [issue("version_not_found", "That content revision does not exist (or has never been published).", "reference")],
    };
  if (version.module !== input.reference.module || version.contentType !== input.reference.contentType || version.sourceRef !== input.reference.sourceRef)
    return { ok: false, issues: [issue("version_identity_mismatch", "That revision belongs to different content.", "reference")] };
  if (version.status !== "published")
    return { ok: false, issues: [issue("version_not_published", "Only a published revision can be assigned to a learner.", "reference")] };

  for (const studentId of input.studentIds) {
    const verdict = await mayAssignTo(input.actor, studentId, tx as never);
    if (!verdict.allowed)
      return {
        ok: false,
        issues: [
          issue(
            `assign_forbidden_${verdict.reason}`,
            verdict.reason === "outside_roster"
              ? "A teacher may only set work for students on their roster."
              : verdict.reason === "not_a_student"
                ? "Work can only be assigned to a student."
                : "Only staff can assign work.",
            "studentIds",
          ),
        ],
      };
  }

  const [created] = await tx
    .insert(assignments)
    .values({
      title: input.title.trim(),
      description: input.description ?? null,
      instructions: input.instructions ?? null,
      createdByUserId: input.actor.id,
      targetUserId: input.studentIds[0]!,
      module: input.reference.module,
      contentType: input.reference.contentType,
      sourceRef: input.reference.sourceRef,
      contentVersionId: version.id,
      dueAt: input.dueAt ?? null,
      updatedAt: new Date(),
    })
    .returning({ id: assignments.id });

  await tx.insert(assignmentTargets).values(
    input.studentIds.map((studentUserId) => ({
      assignmentId: created!.id,
      studentUserId,
      dueAt: input.dueAt ?? null,
    })),
  );

  return { ok: true, assignmentId: created!.id, targets: input.studentIds, versionId: version.id };
}

/**
 * Move one target's status. Assignments are withdrawn by status, never by deleting
 * the revision, so a completed learner keeps their completed record (§94).
 */
export async function setAssignmentTargetStatus(
  tx: ImportTransaction & { update: typeof db.update },
  input: { assignmentId: string; studentUserId: string; status: "not_started" | "in_progress" | "completed" },
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await tx
    .update(assignmentTargets)
    .set({ status: input.status, completedAt: input.status === "completed" ? now : null, updatedAt: now })
    .where(and(eq(assignmentTargets.assignmentId, input.assignmentId), eq(assignmentTargets.studentUserId, input.studentUserId)))
    .returning({ id: assignmentTargets.id });
  return rows.length > 0;
}

export type LearnerAssignment = {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: string;
  dueAt: Date | null;
  content: { module: string; contentType: string; sourceRef: string; versionId: string; versionNo: number | null; versionStatus: string | null };
};

/**
 * A learner's own assignments, each with the revision it pinned, and — when the
 * revision asks for it — the canonical content to work on. Assignments pointing at
 * a revision that has since been removed are still listed (the learner did the
 * work); they simply carry no content.
 */
export async function listAssignmentsForStudent(
  studentUserId: string,
  executor: { select: typeof db.select } = db,
): Promise<LearnerAssignment[]> {
  const rows = await executor
    .select({
      id: assignments.id,
      title: assignments.title,
      description: assignments.description,
      instructions: assignments.instructions,
      dueAt: assignments.dueAt,
      module: assignments.module,
      contentType: assignments.contentType,
      sourceRef: assignments.sourceRef,
      contentVersionId: assignments.contentVersionId,
      status: assignmentTargets.status,
    })
    .from(assignments)
    .innerJoin(assignmentTargets, eq(assignmentTargets.assignmentId, assignments.id))
    .where(eq(assignmentTargets.studentUserId, studentUserId))
    .orderBy(desc(assignments.createdAt));

  const versionIds = rows.map((row) => row.contentVersionId).filter((id): id is string => id !== null);
  const versions = versionIds.length
    ? await executor
        .select({ id: contentVersions.id, versionNo: contentVersions.versionNo, status: contentVersions.status })
        .from(contentVersions)
        .where(inArray(contentVersions.id, versionIds))
    : [];
  const byId = new Map(versions.map((version) => [version.id, version]));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    status: row.status,
    dueAt: row.dueAt,
    content: {
      module: row.module ?? "",
      contentType: row.contentType ?? "",
      sourceRef: row.sourceRef ?? "",
      versionId: row.contentVersionId ?? "",
      versionNo: row.contentVersionId ? byId.get(row.contentVersionId)?.versionNo ?? null : null,
      versionStatus: row.contentVersionId ? byId.get(row.contentVersionId)?.status ?? null : null,
    },
  }));
}

/** The canonical content behind an assignment, read from its PINNED revision. */
export async function assignmentContent(
  assignmentId: string,
  executor: VersionReader & { select: typeof db.select } = db,
): Promise<unknown | null> {
  const [row] = await executor
    .select({ contentVersionId: assignments.contentVersionId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!row?.contentVersionId) return null;
  return versionContent(row.contentVersionId, executor as unknown as VersionReader);
}

/** Staff view: the assignments this actor created, with their targets. */
export async function listAssignmentsCreatedBy(actorUserId: string, executor: { select: typeof db.select } = db) {
  const rows = await executor
    .select({
      id: assignments.id,
      title: assignments.title,
      module: assignments.module,
      contentType: assignments.contentType,
      sourceRef: assignments.sourceRef,
      contentVersionId: assignments.contentVersionId,
      dueAt: assignments.dueAt,
      studentUserId: assignmentTargets.studentUserId,
      status: assignmentTargets.status,
      completedAt: assignmentTargets.completedAt,
    })
    .from(assignments)
    .leftJoin(assignmentTargets, eq(assignmentTargets.assignmentId, assignments.id))
    .where(eq(assignments.createdByUserId, actorUserId))
    .orderBy(desc(assignments.createdAt));

  const byAssignment = new Map<string, {
    id: string;
    title: string;
    module: string | null;
    contentType: string | null;
    sourceRef: string | null;
    contentVersionId: string | null;
    dueAt: Date | null;
    targets: { studentUserId: string; status: string; completedAt: Date | null }[];
  }>();
  for (const row of rows) {
    const entry = byAssignment.get(row.id) ?? {
      id: row.id,
      title: row.title,
      module: row.module,
      contentType: row.contentType,
      sourceRef: row.sourceRef,
      contentVersionId: row.contentVersionId,
      dueAt: row.dueAt,
      targets: [],
    };
    if (row.studentUserId)
      entry.targets.push({ studentUserId: row.studentUserId, status: row.status ?? "not_started", completedAt: row.completedAt ?? null });
    byAssignment.set(row.id, entry);
  }
  return [...byAssignment.values()];
}

export type AssignableItem = {
  module: string;
  contentType: string;
  sourceRef: string;
  title: string;
  track: string;
  /** The revision a new assignment would pin: the newest one a learner could open. */
  versionId: string;
  versionNo: number;
  publicationState: string;
};

/**
 * What a teacher may choose from (§24/§41).
 *
 * "Assignable" has one meaning, and it is the same meaning `createAssignment`
 * enforces when a task is actually created: a revision that is PUBLISHED. A draft
 * is not assignable (nobody could open it), an archived item is not assignable
 * (it was withdrawn), and a scheduled item is not assignable before its moment
 * (`publishContentVersion` leaves a scheduled revision in the `draft` version
 * status, so it is excluded here for the same reason a draft is).
 *
 * Per content item the NEWEST published revision wins — a higher-numbered DRAFT
 * never displaces a published revision, which is exactly the rule
 * `publishedVersion` applies when the assignment is created. The two are kept in
 * step deliberately: the list a teacher picks from and the revision that gets
 * pinned must never disagree, so the tests assert that whatever this returns for
 * an item is precisely what `createAssignment` pins when asked without a version.
 *
 * Foreign/private content is out of scope here by construction: this reads the
 * shared canonical store, and what a given teacher may set is enforced per student
 * by `mayAssignTo`.
 */
/**
 * The canonical rows behind a revision, resolved per target type.
 *
 * Each entry asks the SAME question the learner read asks — is this row live? — and
 * it asks it with the same rule: `liveWhere` (published, or scheduled and due). There
 * is deliberately no second visibility rule here: `is_active` is NOT consulted,
 * because publication is the one answer to "may a learner see this?" and a second
 * filter would be a second answer (`publication.test.ts` enforces that).
 *
 * The check exists for the case where the row moved on its own after the revision was
 * published: a delete, an archive, or a schedule that never opened.
 */
const TARGET_LIVENESS: Record<
  string,
  (executor: VersionReader, ids: string[]) => Promise<{ id: string }[]>
> = {
  listening_test: (executor, ids) =>
    executor
      .select({ id: listeningTests.id })
      .from(listeningTests)
      .where(and(inArray(listeningTests.id, ids), liveWhere({ publicationState: listeningTests.publicationState, publishAt: listeningTests.publishAt }))),
  reading_passage: (executor, ids) =>
    executor
      .select({ id: readingPassages.id })
      .from(readingPassages)
      .where(and(inArray(readingPassages.id, ids), liveWhere({ publicationState: readingPassages.publicationState, publishAt: readingPassages.publishAt }))),
  general_reading_set: (executor, ids) =>
    executor
      .select({ id: generalReadingSets.id })
      .from(generalReadingSets)
      .where(and(inArray(generalReadingSets.id, ids), liveWhere({ publicationState: generalReadingSets.publicationState, publishAt: generalReadingSets.publishAt }))),
  writing_prompt: (executor, ids) =>
    executor
      .select({ id: writingPrompts.id })
      .from(writingPrompts)
      .where(and(inArray(writingPrompts.id, ids), liveWhere({ publicationState: writingPrompts.publicationState, publishAt: writingPrompts.publishAt }))),
  speaking_prompt: (executor, ids) =>
    executor
      .select({ id: speakingPrompts.id })
      .from(speakingPrompts)
      .where(and(inArray(speakingPrompts.id, ids), liveWhere({ publicationState: speakingPrompts.publicationState, publishAt: speakingPrompts.publishAt }))),
  /*
   * Speaking materials were the one authored type missing from this map, and the omission was not
   * neutral. `speaking:material` is a known content type, POST /api/assignments accepts it and pins
   * the revision it is given (HTTP 201), and a teacher can author one through a supported surface —
   * but this picker never listed it, because an undeclared target type is deliberately left out
   * rather than assumed live. The result was a capability the API had and the product never showed:
   * a published resource a teacher could not select as work.
   *
   * The rule is the SAME one the learner read applies — src/lib/data/speaking.ts
   * listLiveMaterialRows() filters on liveWhere(publicationState, publishAt) and nothing else — so
   * the picker offers exactly what a learner could open, and withdraws a resource that was
   * unpublished or scheduled after its revision was pinned. `is_active` is deliberately not part of
   * it: the learner read does not consult it, and adding it here would hide material that is
   * reachable, which is the opposite failure.
   */
  speaking_material: (executor, ids) =>
    executor
      .select({ id: speakingMaterials.id })
      .from(speakingMaterials)
      .where(and(inArray(speakingMaterials.id, ids), liveWhere({ publicationState: speakingMaterials.publicationState, publishAt: speakingMaterials.publishAt }))),
  // Grammar topics carry no publish moment, so `published` is the whole rule — the
  // same rule their learner read applies.
  grammar_topic: (executor, ids) =>
    executor
      .select({ id: grammarTopics.id })
      .from(grammarTopics)
      .where(and(inArray(grammarTopics.id, ids), eq(grammarTopics.publicationState, "published"))),
  lesson: (executor, ids) =>
    executor
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(inArray(lessons.id, ids), liveWhere({ publicationState: lessons.publicationState, publishAt: lessons.publishAt }))),
  vocabulary_topic_pack: (executor, ids) =>
    executor
      .select({ id: vocabularyTopicPacks.id })
      .from(vocabularyTopicPacks)
      .where(and(inArray(vocabularyTopicPacks.id, ids), liveWhere({ publicationState: vocabularyTopicPacks.publicationState, publishAt: vocabularyTopicPacks.publishAt }))),
  video_lesson: (executor, ids) =>
    executor
      .select({ id: videoLessons.id })
      .from(videoLessons)
      .where(and(inArray(videoLessons.id, ids), liveWhere({ publicationState: videoLessons.publicationState, publishAt: videoLessons.publishAt }))),
};

async function liveTargetIds(
  rows: { targetType: string | null; targetId: string | null }[],
  executor: VersionReader,
): Promise<Set<string>> {
  const byType = new Map<string, Set<string>>();
  for (const row of rows)
    if (row.targetType && row.targetId) {
      const ids = byType.get(row.targetType) ?? new Set<string>();
      ids.add(row.targetId);
      byType.set(row.targetType, ids);
    }

  const live = new Set<string>();
  for (const [targetType, ids] of byType) {
    const query = TARGET_LIVENESS[targetType];
    // A target type this module does not know (a type added by another surface) is
    // not silently treated as live: it is left out of the set, so the revision is
    // not offered until the contract is declared here.
    if (!query) continue;
    for (const row of await query(executor, [...ids])) live.add(`${targetType}|${row.id}`);
  }
  return live;
}

export async function listAssignableContent(
  filter: { module?: string; contentType?: string } = {},
  executor: VersionReader = db,
): Promise<AssignableItem[]> {
  const rows = await executor
    .select({
      module: contentVersions.module,
      contentType: contentVersions.contentType,
      sourceRef: contentVersions.sourceRef,
      title: contentVersions.title,
      track: contentVersions.track,
      versionId: contentVersions.id,
      versionNo: contentVersions.versionNo,
      publicationState: contentVersions.publicationState,
      targetType: contentVersions.targetType,
      targetId: contentVersions.targetId,
    })
    .from(contentVersions)
    .where(and(eq(contentVersions.status, "published"), eq(contentVersions.publicationState, "published")))
    .orderBy(desc(contentVersions.versionNo));

  // A revision is only offered when its content type is one the registry knows. A
  // row whose pair is unknown cannot be opened by any module renderer, so offering
  // it would hand a teacher a task nobody can start.
  const known = rows.filter((row) => isKnownModule(row.module) && isKnownContentType(row.module, row.contentType));

  // A published revision is not enough on its own: the canonical ROW behind it must
  // still be there and still be learner-live. A deleted row or one withdrawn in
  // place (archived, deactivated, a schedule that has not opened) would otherwise be
  // offered by the revision store while being impossible to open. The check is
  // bounded — one query per target type present, never one per row.
  const liveTargets = await liveTargetIds(known, executor);

  const byItem = new Map<string, AssignableItem>();
  for (const row of known) {
    if (filter.module && row.module !== filter.module) continue;
    if (filter.contentType && row.contentType !== filter.contentType) continue;
    if (row.targetType && row.targetId && !liveTargets.has(`${row.targetType}|${row.targetId}`)) continue;
    const key = `${contentTypeKey(row.module, row.contentType)}|${row.sourceRef}`;
    if (byItem.has(key)) continue; // ordered newest-first: the first row is the winner
    byItem.set(key, {
      module: row.module,
      contentType: row.contentType,
      sourceRef: row.sourceRef,
      title: row.title,
      track: row.track,
      versionId: row.versionId,
      versionNo: row.versionNo,
      publicationState: row.publicationState,
    });
  }
  return [...byItem.values()].sort((a, b) =>
    `${a.module}:${a.contentType}:${a.title}`.localeCompare(`${b.module}:${b.contentType}:${b.title}`),
  );
}

export { versionContent };
