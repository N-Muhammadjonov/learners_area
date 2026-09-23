import type { SessionPayload } from "./session";

/**
 * Content-ownership rule used across teacher/admin-authored material
 * (currently Speaking materials — see README for extending this to other
 * content types).
 *
 * - Any teacher or admin may CREATE content; it's tagged with their user id.
 * - Only the creator, or an account with isOwner=true, may EDIT/deactivate
 *   someone else's content. isOwner is a platform-owner flag, not tied to a
 *   specific role — set directly in the database (no UI to grant it yet,
 *   see REMAINING in the README).
 */
export function canManageContent(session: SessionPayload, creatorId: string): boolean {
  if (session.role !== "teacher" && session.role !== "admin") return false;
  if (session.sub === creatorId) return true;
  return session.role === "admin" && session.isOwner === true;
}
