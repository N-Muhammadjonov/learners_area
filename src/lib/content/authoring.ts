import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions } from "@/db/schema";
import { AuthoringPayloadError, registerModuleAuthors, resolveModuleAuthor, type PublicationSync } from "@/lib/content/authors";
import { contentTypeKey, moduleDescriptor, referenceProblems } from "@/lib/content/taxonomy";
import { pinVersion, versionContent, type VersionRecord } from "@/lib/content/versions";
import { fullTestStructureProblem } from "@/lib/listening/product";

/** The transaction surface authoring needs: version rows plus the content rows an author writes. */
export type VersionWriter = Parameters<typeof pinVersion>[0];
import type { ImportTransaction } from "@/lib/import/core/dry-run";
import {
  PUBLICATION_STATES,
  canTransition,
  isPublicationState,
  publicationProblem,
  type PublicationState,
} from "@/lib/services/cms/publication";

/**
 * AUTHORING — the staff-side lifecycle of a content item, from "create from
 * scratch" to a published revision (§34, §35, §41, §44).
 *
 * The rules that matter, enforced here rather than in a form:
 *
 *   - A DRAFT is a real row with a real version. Nothing can be composed from it
 *     (mock section, assignment, lesson block) until it is published, so
 *     publication is the only door to a student.
 *   - Revising a draft revises its OWN identity. A published revision is
 *     immutable: editing it produces a new version, never a rewritten history.
 *   - Publishing moves the CONTENT row's own visibility with the revision, because
 *     that is what student queries read. Publishing a revision whose rows stayed
 *     dark would publish nothing.
 *   - Nothing is ever deleted. Archiving withdraws content and leaves every
 *     attempt, question and answer key readable (§41, §94).
 *   - Scheduling requires a moment, and the content row must be able to hold one;
 *     a type that cannot is refused rather than silently published.
 */

export type AuthoringActor = {
  id: string;
  role: string;
  /** `mayPublishContent` from the permission layer; the service does not guess roles. */
  mayPublish: boolean;
};

export type AuthoringIssue = { code: string; message: string; field?: string };

export type SaveDraftInput = {
  actor: AuthoringActor;
  module: string;
  contentType: string;
  sourceRef: string;
  title: string;
  track?: string;
  payload: unknown;
  note?: string | null;
  provenance?: Record<string, unknown> | null;
  /** Set when revising an existing DRAFT revision of the same item. */
  versionId?: string | null;
};

export type SaveDraftResult = { ok: true; version: VersionRecord; created: boolean } | { ok: false; issues: AuthoringIssue[] };

/** A source ref is a stable, URL-safe, lower-case identity — never a title. */
export function slugSourceRef(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function referenceIssues(input: Pick<SaveDraftInput, "module" | "contentType" | "sourceRef" | "track">): AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];
  const descriptor = moduleDescriptor(input.module);
  if (!descriptor) return [{ code: "unknown_module", message: `Unknown module "${input.module}".`, field: "module" }];
  if (!descriptor.contentTypes.includes(input.contentType))
    issues.push({
      code: "unknown_content_type",
      message: `"${input.contentType}" is not a content type of the ${descriptor.label} module (${descriptor.contentTypes.join(", ")}).`,
      field: "contentType",
    });
  if (!input.sourceRef.trim()) issues.push({ code: "missing_source_ref", message: "A source reference is required.", field: "sourceRef" });
  else if (slugSourceRef(input.sourceRef) !== input.sourceRef)
    issues.push({
      code: "unstable_source_ref",
      message: "A source reference must be lower-case a–z, 0–9, dot, dash or underscore (it identifies the item forever, so a title will not do).",
      field: "sourceRef",
    });

  const problems = referenceProblems({
    module: input.module,
    contentType: input.contentType,
    sourceRef: input.sourceRef,
    track: input.track ?? "unspecified",
    versionId: null,
  });
  for (const problem of problems)
    if (problem.code !== "version_required")
      issues.push({ code: problem.code, message: problem.message, field: problem.code === "track_mismatch" ? "track" : undefined });
  return issues;
}

/**
 * Create or revise a draft: the module's author writes the canonical rows, then
 * `pinVersion` records the revision that describes them — one transaction, so a
 * payload that fails anywhere leaves nothing half-written.
 */
export async function saveContentDraft(tx: ImportTransaction & VersionWriter, input: SaveDraftInput): Promise<SaveDraftResult> {
  registerModuleAuthors();
  const issues = referenceIssues(input);
  if (!input.title.trim()) issues.push({ code: "missing_title", message: "A title is required.", field: "title" });

  const author = resolveModuleAuthor(input.module, input.contentType);
  if (!author)
    issues.push({
      code: "authoring_not_available",
      message: `Creating ${input.module}:${input.contentType} from scratch is not available yet.`,
      field: "contentType",
    });
  if (issues.length || !author) return { ok: false, issues };

  const parsed = author.payloadSchema.safeParse(input.payload);
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 8).map((issue) => ({
        code: "invalid_payload",
        message: issue.message,
        field: issue.path.join(".") || undefined,
      })),
    };

  if (input.versionId) {
    const [existing] = await tx.select().from(contentVersions).where(eq(contentVersions.id, input.versionId)).limit(1);
    if (!existing) return { ok: false, issues: [{ code: "version_not_found", message: "Unknown content version." }] };
    if (existing.status === "published" || existing.status === "archived")
      return {
        ok: false,
        issues: [
          {
            code: "published_is_immutable",
            message: "A published revision is immutable: revise it into a new version instead of rewriting history.",
          },
        ],
      };
    if (existing.module !== input.module || existing.contentType !== input.contentType || existing.sourceRef !== input.sourceRef)
      return { ok: false, issues: [{ code: "version_identity_mismatch", message: "That revision belongs to different content." }] };
  }

  let target;
  try {
    target = await author.persist(tx as ImportTransaction, parsed.data, {
      actorUserId: input.actor.id,
      sourceRef: input.sourceRef,
      title: input.title.trim(),
      track: input.track ?? "unspecified",
      // The revision the caller is saving into (already validated as an editable draft
      // of exactly this item above), so a working copy is written in place.
      versionId: input.versionId ?? null,
    });
  } catch (error) {
    // A payload the DOMAIN refuses (an unknown question type, an unknown reading
    // kind) is a validation answer, not a crash: it comes back as issues, and the
    // caller's transaction rolls back with nothing written.
    if (error instanceof AuthoringPayloadError)
      return {
        ok: false,
        issues: error.issues.issues
          .slice(0, 8)
          .map((issue) => ({ code: "invalid_payload", message: issue.message, field: issue.path.join(".") || undefined })),
      };
    throw error;
  }

  const pinned = await pinVersion(tx, {
    module: input.module,
    contentType: input.contentType,
    sourceRef: input.sourceRef,
    // Reading drafts own new immutable canonical targets, even for identical text.
    forceNewVersion: input.module === "reading",
    title: input.title.trim(),
    track: input.track ?? "unspecified",
    content: target.content,
    publicationState: "draft",
    targetType: target.targetType,
    targetId: target.targetId,
    actorUserId: input.actor.id,
    provenance: input.provenance ?? { origin: "authored", summary: target.summary },
    note: input.note ?? null,
  });
  return { ok: true, version: pinned.version, created: pinned.created };
}

/* -------------------------------------------------------------------------- */
/* Publication                                                                */
/* -------------------------------------------------------------------------- */

export type PublicationRequest = {
  actor: AuthoringActor;
  versionId: string;
  to: PublicationState;
  publishAt?: Date | null;
};

export type PublicationResult =
  | { ok: true; version: VersionRecord; state: PublicationState }
  | { ok: false; issues: AuthoringIssue[] };

/**
 * What must be true before a revision may be handed to students. Checked at
 * publication time, so an archived content row or a missing answer key blocks the
 * state change instead of being noticed by a learner.
 */
export async function publicationIssues(
  tx: ImportTransaction,
  version: VersionRecord,
  to: PublicationState,
): Promise<AuthoringIssue[]> {
  const issues: AuthoringIssue[] = [];
  const author = resolveModuleAuthor(version.module, version.contentType);
  if (!author)
    issues.push({
      code: "authoring_not_available",
      message: `No author is registered for ${version.module}:${version.contentType}; it cannot be published here.`,
    });
  if (!version.targetId || !version.targetType)
    issues.push({ code: "no_target", message: "The revision is not attached to any content row." });

  // A formal IELTS Listening full test is a specific structure. Publishing a five-question
  // drill under `listening:full_test` is how a drill ends up looking like an exam in the
  // Academic catalogue, so the OWNER's structure is enforced here — and the refusal tells the
  // author what to do instead (file it as a Listening section). Only NEW publications are
  // judged: content that is already live keeps its state and is never rewritten.
  if (version.module === "listening" && version.contentType === "full_test" && (to === "published" || to === "scheduled")) {
    const structure = fullTestStructureProblem(version.contentSnapshot);
    if (structure) issues.push({ code: "incomplete_full_test", message: structure, field: "questions" });
  }

  // `setPublication` WRITES the content row, so it is deliberately not called from here:
  // a question about whether something may be published must never publish it. Whether the
  // row can hold a publish moment is answered by the real write in `publishContentVersion`,
  // which refuses BEFORE writing anything (`unsupported_schedule`) — so asking the question
  // and performing the write give the same answer, and only the write can change the row.
  return issues;
}

/** Move a revision through the shared publication states (§41). */
export async function publishContentVersion(
  tx: ImportTransaction & VersionWriter,
  request: PublicationRequest,
): Promise<PublicationResult> {
  // Idempotent: publishing needs the module authors to move the content row's own
  // visibility, and a caller that never authored a draft must not be told the
  // capability is missing just because registration had not happened yet.
  registerModuleAuthors();
  const [row] = await tx.select().from(contentVersions).where(eq(contentVersions.id, request.versionId)).limit(1);
  if (!row) return { ok: false, issues: [{ code: "version_not_found", message: "Unknown content version." }] };
  const version = row as unknown as VersionRecord;
  const current = version.publicationState;

  if (!isPublicationState(current) || !canTransition(current, request.to))
    return {
      ok: false,
      issues: [{ code: "publication_transition_refused", message: `A ${current} revision cannot become ${request.to}.`, field: "to" }],
    };

  const publishAt = request.to === "scheduled" ? request.publishAt ?? null : null;
  const scheduleIssue = publicationProblem(request.to, publishAt);
  if (scheduleIssue)
    return {
      ok: false,
      issues: [
        {
          code: scheduleIssue,
          message:
            scheduleIssue === "missing_publish_at"
              ? "A scheduled revision needs the moment it opens."
              : "Only a scheduled revision carries a publish moment.",
          field: "publishAt",
        },
      ],
    };

  if (request.to === "published" || request.to === "scheduled") {
    if (!request.actor.mayPublish)
      return { ok: false, issues: [{ code: "publish_forbidden", message: "Publishing content requires an owner or administrator role." }] };
    const issues = await publicationIssues(tx, version, request.to);
    if (issues.length) return { ok: false, issues };
  }

  // The content row moves FIRST: if the row cannot hold the state, the revision is
  // not marked published either.
  let synced: PublicationSync = "ok";
  const author = resolveModuleAuthor(version.module, version.contentType);
  if (author && version.targetId)
    // The revision identity travels with the call: a content type whose live content is
    // materialized FROM the revision (Listening) writes exactly this version's material, and
    // types that only flip a flag ignore the extra fields.
    synced = await author.setPublication(
      tx,
      {
        targetId: version.targetId,
        sourceRef: version.sourceRef,
        versionId: version.id,
        contentSnapshot: version.contentSnapshot,
        title: version.title,
      },
      { state: request.to, publishAt },
    );
  if (synced === "unsupported_schedule")
    return {
      ok: false,
      issues: [{ code: "scheduling_unsupported", message: "This content type cannot hold a publish moment.", field: "publishAt" }],
    };
  if (synced === "target_missing")
    return { ok: false, issues: [{ code: "no_target", message: "The revision is not attached to any content row." }] };

  // Publishing a revision takes over the publication slot from whichever revision
  // held it, so at most one revision of an item is published at a time. The older
  // one is `superseded`, never deleted: attempts bound to it stay readable.
  if (request.to === "published")
    await tx
      .update(contentVersions)
      .set({ status: "superseded", supersededAt: new Date() })
      .where(
        and(
          eq(contentVersions.module, version.module),
          eq(contentVersions.contentType, version.contentType),
          eq(contentVersions.sourceRef, version.sourceRef),
          eq(contentVersions.status, "published"),
          ne(contentVersions.id, version.id),
        ),
      );

  const [updated] = await tx
    .update(contentVersions)
    .set({
      publicationState: request.to,
      status: request.to === "published" ? "published" : request.to === "archived" ? "archived" : "draft",
      publishedAt: request.to === "published" ? new Date() : row.publishedAt,
    })
    .where(eq(contentVersions.id, version.id))
    .returning();

  // A content type whose row is SERVED WHILE IT IS LIVE (a lesson) deliberately leaves
  // that row alone while a revision is being edited. This is where the revision reaches
  // learners — the moment it is published, in the same transaction, so a failure here
  // rolls the whole publication back instead of leaving students on old content while
  // the revision claims to be live.
  if (request.to === "published" && author?.materialize)
    await author.materialize(tx as ImportTransaction, {
      version: updated as unknown as VersionRecord,
      content: await versionContent(version.id, tx as never),
    });

  return { ok: true, version: updated as unknown as VersionRecord, state: request.to };
}

/**
 * Scheduled revisions whose moment has arrived. The moment lives on the content
 * row (the shared CMS rule), so it is read through the module's own author rather
 * than guessed from a column this table does not have.
 */
export async function activateDueVersions(
  tx: ImportTransaction & VersionWriter,
  now: Date = new Date(),
): Promise<{ version: VersionRecord; state: PublicationState }[]> {
  registerModuleAuthors();
  const rows = (await tx
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.publicationState, "scheduled")))
    .orderBy(desc(contentVersions.versionNo))) as unknown as VersionRecord[];

  const opened: { version: VersionRecord; state: PublicationState }[] = [];
  for (const version of rows) {
    const author = resolveModuleAuthor(version.module, version.contentType);
    if (!author || !version.targetId) continue;
    const due = await author.readSchedule(tx as ImportTransaction, { targetId: version.targetId, sourceRef: version.sourceRef });
    if (!due || due.getTime() > now.getTime()) continue;
    const published = await publishContentVersion(tx, {
      actor: { id: "", role: "system", mayPublish: true },
      versionId: version.id,
      to: "published",
    });
    // A scheduled revision moves to published, which the transition table allows.
    if (published.ok) opened.push({ version: published.version, state: published.state });
  }
  return opened;
}

/** The publication state of a revision, in the shared vocabulary. */
export function stateOf(version: VersionRecord): PublicationState {
  return isPublicationState(version.publicationState) ? version.publicationState : "draft";
}

/** Every revision of one content item, newest first (staff view). */
export async function versionsOf(
  module: string,
  contentType: string,
  sourceRef: string,
  executor: { select: typeof db.select } = db,
): Promise<VersionRecord[]> {
  const rows = await executor
    .select()
    .from(contentVersions)
    .where(
      and(
        eq(contentVersions.module, module),
        eq(contentVersions.contentType, contentType),
        eq(contentVersions.sourceRef, sourceRef),
      ),
    )
    .orderBy(desc(contentVersions.versionNo));
  return rows as unknown as VersionRecord[];
}

/** One row per content ITEM (its newest revision), which is what a staff list shows. */
export async function listContentItems(
  filter: { module?: string; contentType?: string } = {},
  executor: { select: typeof db.select } = db,
): Promise<{ key: string; module: string; contentType: string; sourceRef: string; versions: number; state: PublicationState; title: string }[]> {
  const rows = (await executor.select().from(contentVersions).orderBy(desc(contentVersions.versionNo))) as unknown as VersionRecord[];
  const byKey = new Map<
    string,
    { key: string; module: string; contentType: string; sourceRef: string; versions: number; state: PublicationState; title: string }
  >();
  for (const row of rows) {
    if (filter.module && row.module !== filter.module) continue;
    if (filter.contentType && row.contentType !== filter.contentType) continue;
    const key = `${contentTypeKey(row.module, row.contentType)}|${row.sourceRef}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.versions += 1;
      continue;
    }
    byKey.set(key, {
      key,
      module: row.module,
      contentType: row.contentType,
      sourceRef: row.sourceRef,
      versions: 1,
      state: stateOf(row),
      title: row.title,
    });
  }
  return [...byKey.values()];
}

export const PUBLICATION_STATE_LIST = PUBLICATION_STATES;
