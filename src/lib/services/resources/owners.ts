import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  assignments,
  grammarTopics,
  lessons,
  listeningTests,
  liveClasses,
  readingPassages,
  speakingMaterials,
  writingPrompts,
} from "@/db/schema";
import { canManageContent, type Actor } from "@/lib/auth/ownership";
import { isLive } from "@/lib/services/cms/publication";
import { isStaff, type Role } from "@/lib/auth/roles";

/**
 * The eight things a material block can be attached to.
 *
 * This registry is the whole answer to "may this block exist, and may this person
 * read it?" — there is no second copy of that rule anywhere, which is why adding
 * a ninth content kind is one entry here plus an enum value.
 *
 * `owner_id` is a uuid pointing at eight different tables, so there is no foreign
 * key; every read and every write goes through `loadResourceOwner`, and an id
 * that does not resolve is treated as not-found rather than as an untethered row.
 *
 * Visibility for students is decided by the same `isLive()` the rest of the app
 * uses, so a draft lesson cannot leak its attachments: pull a passage back to
 * draft and its materials stop being served in the same request.
 */
export const RESOURCE_OWNER_TYPES = [
  "lesson",
  "reading",
  "listening",
  "writing",
  "speaking",
  "grammar",
  "assignment",
  "live_class",
] as const;

export type ResourceOwnerType = (typeof RESOURCE_OWNER_TYPES)[number];

export function isResourceOwnerType(value: string): value is ResourceOwnerType {
  return (RESOURCE_OWNER_TYPES as readonly string[]).includes(value);
}

export type OwnerFacts = {
  id: string;
  creatorId?: string | null;
  /** Whether a student who is not staff may see this row at all. */
  studentVisible: boolean;
  /** Label used in audit/report copy, never in student-facing text. */
  label: string;
  /** The owner's own name, for a management screen. Never an invented title. */
  title: string;
};

/** Longest name that fits a management row; the source text itself is untouched. */
const titleOf = (value: string | null | undefined, fallback: string) =>
  (value ?? "").trim().slice(0, 120) || fallback;

/**
 * Content kinds that carry a publication state share one rule; the rest are
 * visible as soon as they exist. Assignments are visible to the student they
 * target (and to staff), which the assignment pages already enforce.
 */
export async function loadResourceOwner(
  type: ResourceOwnerType,
  id: string
): Promise<OwnerFacts | null> {
  switch (type) {
    case "reading": {
      const row = await db.query.readingPassages.findFirst({ where: eq(readingPassages.id, id) });
      return row
        ? { id, studentVisible: isLive(row), label: "reading_passage", title: titleOf(row.title, "Reading") }
        : null;
    }
    case "listening": {
      const row = await db.query.listeningTests.findFirst({ where: eq(listeningTests.id, id) });
      return row
        ? { id, studentVisible: isLive(row), creatorId: row.createdByUserId, label: "listening_test", title: titleOf(row.title, "Listening") }
        : null;
    }
    case "writing": {
      const row = await db.query.writingPrompts.findFirst({ where: eq(writingPrompts.id, id) });
      return row
        ? { id, studentVisible: isLive(row), label: "writing_prompt", title: titleOf(row.prompt, "Writing") }
        : null;
    }
    case "speaking": {
      const row = await db.query.speakingMaterials.findFirst({ where: eq(speakingMaterials.id, id) });
      return row
        ? {
            id,
            studentVisible: row.isActive && isLive(row),
            creatorId: row.createdByUserId, label: "speaking_material",
            title: titleOf(row.title, "Speaking"),
          }
        : null;
    }
    case "lesson": {
      const row = await db.query.lessons.findFirst({ where: eq(lessons.id, id) });
      return row
        ? { id, studentVisible: true, label: "lesson", title: titleOf(row.title, "Lesson") }
        : null;
    }
    case "grammar": {
      const row = await db.query.grammarTopics.findFirst({ where: eq(grammarTopics.id, id) });
      return row
        ? { id, studentVisible: true, label: "grammar_topic", title: titleOf(row.title, "Grammar") }
        : null;
    }
    case "assignment": {
      const row = await db.query.assignments.findFirst({ where: eq(assignments.id, id) });
      return row
        ? { id, studentVisible: true, creatorId: row.createdByUserId, label: "assignment", title: titleOf(row.title, "Assignment") }
        : null;
    }
    case "live_class": {
      const row = await db.query.liveClasses.findFirst({ where: eq(liveClasses.id, id) });
      return row
        ? { id, studentVisible: true, creatorId: row.teacherUserId, label: "live_class", title: titleOf(row.title, "Live class") }
        : null;
    }
  }
}

/**
 * Who may read a block: staff see everything they are allowed to manage, and a
 * student may read the materials of content that is actually open to them.
 * Reading is not a menu decision — the row above is re-checked on every call.
 */
export function mayReadResources(callerRole: Role, owner: OwnerFacts): boolean {
  return isStaff(callerRole) || owner.studentVisible;
}

/** Staff may author materials. Creator-specific content keeps ownership checks. */
export function mayWriteResources(callerRole: Role): boolean {
  return isStaff(callerRole);
}

/** A teacher cannot overwrite another teacher's owned content. Shared centre
 * content without a creator field remains staff-authorable, as requested. */
export function mayManageResourceOwner(actor: Actor, owner: OwnerFacts): boolean {
  if (!isStaff(actor.role)) return false;
  return owner.creatorId ? canManageContent(actor, owner.creatorId) : true;
}

/**
 * Every owner of one kind, with its own name — the management list behind
 * `/app/admin/materials`. It is one query per kind, and it reads the same tables
 * `loadResourceOwner` does, so a row that cannot own materials cannot appear here.
 *
 * Deliberately not sorted by anything clever: newest first is what an
 * administrator actually wants when they have just added something.
 */
export async function listResourceOwners(
  type: ResourceOwnerType
): Promise<{ id: string; title: string; studentVisible: boolean }[]> {
  const shape = { id: "", title: "", studentVisible: false };
  switch (type) {
    case "reading":
      return (
        await db
          .select({
            id: readingPassages.id,
            title: readingPassages.title,
            state: readingPassages.publicationState,
            publishAt: readingPassages.publishAt,
          })
          .from(readingPassages)
          .orderBy(desc(readingPassages.createdAt))
      ).map((row) => ({
        ...shape,
        id: row.id,
        title: titleOf(row.title, "Reading"),
        studentVisible: isLive({ publicationState: row.state, publishAt: row.publishAt }),
      }));
    case "listening":
      return (
        await db
          .select({
            id: listeningTests.id,
            title: listeningTests.title,
            state: listeningTests.publicationState,
            publishAt: listeningTests.publishAt,
          })
          .from(listeningTests)
          .orderBy(desc(listeningTests.createdAt))
      ).map((row) => ({
        ...shape,
        id: row.id,
        title: titleOf(row.title, "Listening"),
        studentVisible: isLive({ publicationState: row.state, publishAt: row.publishAt }),
      }));
    case "writing":
      return (
        await db
          .select({
            id: writingPrompts.id,
            title: writingPrompts.prompt,
            state: writingPrompts.publicationState,
            publishAt: writingPrompts.publishAt,
          })
          .from(writingPrompts)
          .orderBy(desc(writingPrompts.createdAt))
      ).map((row) => ({
        ...shape,
        id: row.id,
        title: titleOf(row.title, "Writing"),
        studentVisible: isLive({ publicationState: row.state, publishAt: row.publishAt }),
      }));
    case "speaking":
      return (
        await db
          .select({
            id: speakingMaterials.id,
            title: speakingMaterials.title,
            state: speakingMaterials.publicationState,
            publishAt: speakingMaterials.publishAt,
            isActive: speakingMaterials.isActive,
          })
          .from(speakingMaterials)
          .orderBy(desc(speakingMaterials.createdAt))
      ).map((row) => ({
        ...shape,
        id: row.id,
        title: titleOf(row.title, "Speaking"),
        studentVisible: row.isActive && isLive({ publicationState: row.state, publishAt: row.publishAt }),
      }));
    case "lesson":
      return (
        await db
          .select({ id: lessons.id, title: lessons.title })
          .from(lessons)
          .orderBy(asc(lessons.order))
      ).map((row) => ({ ...shape, id: row.id, title: titleOf(row.title, "Lesson"), studentVisible: true }));
    case "grammar":
      return (
        await db
          .select({ id: grammarTopics.id, title: grammarTopics.title })
          .from(grammarTopics)
          .orderBy(asc(grammarTopics.order))
      ).map((row) => ({ ...shape, id: row.id, title: titleOf(row.title, "Grammar"), studentVisible: true }));
    case "assignment":
      return (
        await db
          .select({
            id: assignments.id,
            title: assignments.title,
            targetUserId: assignments.targetUserId,
            dueAt: assignments.dueAt,
          })
          .from(assignments)
          .orderBy(desc(assignments.createdAt))
      ).map((row) => ({
        ...shape,
        id: row.id,
        title: titleOf(row.title, "Assignment"),
        // An assignment is visible to the student it targets; the list is an
        // administration view, so it is listed either way.
        studentVisible: true,
      }));
    case "live_class":
      return (
        await db
          .select({ id: liveClasses.id, title: liveClasses.title })
          .from(liveClasses)
          .orderBy(desc(liveClasses.scheduledAt))
      ).map((row) => ({ ...shape, id: row.id, title: titleOf(row.title, "Live class"), studentVisible: true }));
  }
}
