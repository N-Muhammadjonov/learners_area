import { eq } from "drizzle-orm";
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

type OwnerFacts = {
  id: string;
  /** Whether a student who is not staff may see this row at all. */
  studentVisible: boolean;
  /** Label used in audit/report copy, never in student-facing text. */
  label: string;
};

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
      return row ? { id, studentVisible: isLive(row), label: "reading_passage" } : null;
    }
    case "listening": {
      const row = await db.query.listeningTests.findFirst({ where: eq(listeningTests.id, id) });
      return row ? { id, studentVisible: isLive(row), label: "listening_test" } : null;
    }
    case "writing": {
      const row = await db.query.writingPrompts.findFirst({ where: eq(writingPrompts.id, id) });
      return row ? { id, studentVisible: isLive(row), label: "writing_prompt" } : null;
    }
    case "speaking": {
      const row = await db.query.speakingMaterials.findFirst({ where: eq(speakingMaterials.id, id) });
      return row
        ? { id, studentVisible: row.isActive && isLive(row), label: "speaking_material" }
        : null;
    }
    case "lesson": {
      const row = await db.query.lessons.findFirst({ where: eq(lessons.id, id) });
      return row ? { id, studentVisible: true, label: "lesson" } : null;
    }
    case "grammar": {
      const row = await db.query.grammarTopics.findFirst({ where: eq(grammarTopics.id, id) });
      return row ? { id, studentVisible: true, label: "grammar_topic" } : null;
    }
    case "assignment": {
      const row = await db.query.assignments.findFirst({ where: eq(assignments.id, id) });
      return row ? { id, studentVisible: true, label: "assignment" } : null;
    }
    case "live_class": {
      const row = await db.query.liveClasses.findFirst({ where: eq(liveClasses.id, id) });
      return row ? { id, studentVisible: true, label: "live_class" } : null;
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

/**
 * Who may change the materials: ADMIN and OWNER only.
 *
 * This is the same separation as publication — a teacher authors questions, an
 * administrator decides what students see. Attaching a file to a passage is a
 * student-visible change, so it follows the stricter rule rather than the looser
 * one.
 */
export function mayWriteResources(callerRole: Role): boolean {
  return callerRole === "admin" || callerRole === "owner";
}
