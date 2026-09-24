/**
 * The application role model.
 *
 *   OWNER  >  ADMIN  >  TEACHER  >  STUDENT
 *
 * OWNER is a real role, not an "admin with a flag": it is the only role that may
 * transfer ownership or grant the admin role, and it is what the previous
 * `users.isOwner` boolean used to mean without being able to express it.
 *
 * Rank answers "who is above whom" (it decides, for example, that an admin may
 * not demote an owner). It deliberately does NOT mean "the higher role inherits
 * every lower permission" — each capability is checked explicitly in
 * `permissions.ts` and again on the server for every request.
 *
 * This module is pure so unit tests can import it without a database.
 */

export const ROLES = ["student", "teacher", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { student: 0, teacher: 1, admin: 2, owner: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function roleRank(role: Role): number {
  return RANK[role];
}

/** True when `role` is at least as privileged as `minimum`. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/** True when `actor` outranks `target` (an admin may act on a teacher, not on an owner). */
export function outranks(actor: Role, target: Role): boolean {
  return RANK[actor] > RANK[target];
}

/**
 * Which roles an actor may hand out.
 *
 * - OWNER may grant anything, including ADMIN and OWNER (ownership transfer).
 * - ADMIN may grant STUDENT and TEACHER only: an admin can never promote
 *   themselves or anybody else to OWNER.
 * - TEACHER and STUDENT grant nothing.
 */
export function grantableRoles(actor: Role): Role[] {
  if (actor === "owner") return [...ROLES];
  if (actor === "admin") return ["student", "teacher"];
  return [];
}

export function canGrantRole(actor: Role, target: Role): boolean {
  return grantableRoles(actor).includes(target);
}

/** Staff = anyone who may author or review content in the centre. */
export function isStaff(role: Role): boolean {
  return role === "teacher" || role === "admin" || role === "owner";
}

/** Administrator-level = may run centre-wide administration. */
export function isAdministrator(role: Role): boolean {
  return role === "admin" || role === "owner";
}

export const ROLE_LABELS: Record<Role, { en: string; uz: string }> = {
  student: { en: "Student", uz: "Talaba" },
  teacher: { en: "Teacher", uz: "O'qituvchi" },
  admin: { en: "Admin", uz: "Administrator" },
  owner: { en: "Owner", uz: "Egasi" },
};
