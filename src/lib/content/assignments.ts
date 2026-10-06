import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { assignmentTargets, assignments, contentVersions, teacherStudentLinks, users } from "@/db/schema";
import { contentTypeKey, moduleDescriptor, referenceProblems } from "@/lib/content/taxonomy";
import { publishedVersion, versionById, versionContent, type VersionReader } from "@/lib/content/versions";
import { isAdministrator, roleAtLeast } from "@/lib/auth/roles";
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

export { versionContent };
