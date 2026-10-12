import { isAdministrator, type Role } from "@/lib/auth/roles";

/**
 * WHO MAY AUTHOR WHAT — one explicit capability decision, shared by the API, the UI
 * and the tests.
 *
 * Why this module exists: `/api/admin/content/drafts` used to accept any registered
 * `module:contentType` from anyone who passed `isStaff()`. A teacher IS staff, so a
 * teacher could POST a writing prompt, a reading passage or any other registered type
 * straight to the generic route — the Listening lesson desk displayed only lesson
 * controls, and a hidden control is not authorization.
 *
 * The rule is now stated once, here, as a fact about content types rather than a
 * repetition of "staff" in every route:
 *
 *   student            → nothing, ever.
 *   teacher            → the content types repository truth already proves teachers
 *                        author (see TEACHER_AUTHORABLE_CONTENT for the evidence), and
 *                        nothing else.
 *   admin / owner      → any content type that has a registered author.
 *
 * This module is PURE (no database, no React), so the server, the client and the test
 * suite ask the same question and cannot drift.
 */

/** `module:contentType` — the identity of an authorable content type. */
export function contentKey(module: string, contentType: string): string {
  return `${module}:${contentType}`;
}

export type ContentKey = string;

/**
 * The content types a TEACHER may author, with the repository evidence for each one.
 *
 * This list is an INVENTORY OF EXISTING RIGHTS, not a new grant. Each entry names the
 * door that already admitted a teacher before this correction existed; removing one
 * would revoke a capability the product already relies on, and adding one that has no
 * such door would invent authority nobody asked for.
 */
export const TEACHER_AUTHORABLE_CONTENT: readonly ContentKey[] = [
  // The lesson authoring desk's own contract: the Listening lesson desk is a teacher
  // surface (`/app/listening/lessons/author`), and it writes lessons.
  contentKey("lesson", "lesson"),
  // POST /api/speaking/materials — `isStaff`, i.e. teachers author speaking resources.
  contentKey("speaking", "material"),
  // POST /api/admin/video-lessons — `requireStaff` plus `canManageContent`, i.e. a
  // teacher authors and maintains the public video/audio lessons they created.
  contentKey("ted", "video_lesson"),
  contentKey("ted", "audio_lesson"),
];

/** The set, for O(1) lookups. */
const TEACHER_SET = new Set<ContentKey>(TEACHER_AUTHORABLE_CONTENT);

/** Content types a teacher may author, as a readable list (used by the UI). */
export function teacherAuthorableContent(): readonly ContentKey[] {
  return TEACHER_AUTHORABLE_CONTENT;
}

/**
 * May this role author this content type?
 *
 * `registered` answers "does this content type have an author at all?", which is a
 * fact of the author registry rather than a permission — a role that may author
 * anything still cannot author a type nobody has implemented.
 */
export function mayAuthorContentForRole(
  role: Role | null | undefined,
  module: string,
  contentType: string,
  registered: (module: string, contentType: string) => boolean,
): boolean {
  if (!role) return false;
  const key = contentKey(module, contentType);
  if (!registered(module, contentType)) return false;
  if (isAdministrator(role)) return true;
  if (role === "teacher") return TEACHER_SET.has(key);
  return false;
}
