import type { Role } from "./roles";
import { roleAtLeast } from "./roles";

/**
 * The identity shape content rules need.
 *
 * `sub` is the signed-session claim and `id` is the database row's key; both
 * shapes appear in the codebase, so the rule accepts either instead of forcing
 * every caller to convert. Authority (`role`) always comes from an authoritative
 * source — the database row for request handlers.
 */
export type Actor = { role: Role; id?: string; sub?: string };

/**
 * Content-ownership rule for teacher/admin/owner-authored material.
 *
 * - Any staff member may CREATE content; it is tagged with their user id.
 * - The creator may always edit their own content.
 * - An administrator (admin or owner) may edit anyone's content; a teacher may
 *   not touch another teacher's material, so two teachers working in the same
 *   centre stay independent.
 *
 * The senior-admin check uses the *authoritative* role from the database row
 * when it is available, falling back to the session for render-only call sites.
 */
export function canManageContent(actor: Actor, creatorId: string): boolean {
  const { role } = actor;
  if (role !== "teacher" && role !== "admin" && role !== "owner") return false;
  const actorId = actor.id ?? actor.sub;
  if (!actorId) return false;
  if (actorId === creatorId) return true;
  return roleAtLeast(role, "admin");
}
