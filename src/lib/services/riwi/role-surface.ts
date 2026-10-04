import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { teacherStudentLinks, users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { authorizeCapability, type RiwiActor } from "./capabilities";
import { riwiRoleSurfaceSchema, type RiwiRoleSurface } from "./contracts";

export const RIWI_SCOPE_TARGET_LIMIT = 500;

export type RiwiScopeTarget = { id: string; name: string };
export type RiwiRoleSurfaceDependencies = {
  listAssignedStudents: (teacherId: string, limit: number) => Promise<RiwiScopeTarget[]>;
  listActiveStudents: (limit: number) => Promise<RiwiScopeTarget[]>;
};

const defaultDependencies: RiwiRoleSurfaceDependencies = {
  listAssignedStudents: async (teacherId, limit) => db.select({ id: users.id, name: users.name })
    .from(teacherStudentLinks)
    .innerJoin(users, eq(users.id, teacherStudentLinks.studentUserId))
    .where(and(
      eq(teacherStudentLinks.teacherUserId, teacherId),
      eq(users.role, "student"),
      eq(users.accountStatus, "active"),
    ))
    .orderBy(asc(users.name), asc(users.id))
    .limit(limit),
  listActiveStudents: async (limit) => db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.role, "student"), eq(users.accountStatus, "active")))
    .orderBy(asc(users.name), asc(users.id))
    .limit(limit),
};

const surfaceByRole = {
  student: { scope: "self", targetCapability: null },
  teacher: { scope: "assigned_roster", targetCapability: "riwi.report.read_assigned" },
  admin: { scope: "admin_cohort", targetCapability: "riwi.report.read_admin_scope" },
  owner: { scope: "owner_centre", targetCapability: "riwi.report.read_admin_scope" },
} as const;

/**
 * Supplies role-specific UI choices from database-backed rows. This is only a
 * presentation projection: every submitted target is re-checked by the
 * capability/scope policy in the authenticated RIWI gateway.
 */
export async function getRiwiRoleSurface(
  actor: RiwiActor,
  dependencies: RiwiRoleSurfaceDependencies = defaultDependencies,
): Promise<RiwiRoleSurface> {
  if (actor.accountStatus !== "active" || !authorizeCapability(actor, "riwi.chat.self").allowed) {
    throw new Error("riwi_role_surface_forbidden");
  }

  const policy = surfaceByRole[actor.role];
  if (!policy.targetCapability) {
    return riwiRoleSurfaceSchema.parse({
      status: "ready", role: actor.role, scope: policy.scope, targetOptions: [], targetOptionsCapped: false,
    });
  }
  if (!authorizeCapability(actor, policy.targetCapability).allowed) throw new Error("riwi_role_surface_forbidden");

  const queried = actor.role === "teacher"
    ? await dependencies.listAssignedStudents(actor.id, RIWI_SCOPE_TARGET_LIMIT + 1)
    : await dependencies.listActiveStudents(RIWI_SCOPE_TARGET_LIMIT + 1);
  const targetOptions = queried.slice(0, RIWI_SCOPE_TARGET_LIMIT).map(({ id, name }) => ({ id, name: name.trim().slice(0, 120) }));
  return riwiRoleSurfaceSchema.parse({
    status: "ready", role: actor.role, scope: policy.scope, targetOptions,
    targetOptionsCapped: queried.length > RIWI_SCOPE_TARGET_LIMIT,
  });
}

export function unavailableRiwiRoleSurface(role: Role): RiwiRoleSurface {
  return riwiRoleSurfaceSchema.parse({
    status: "unavailable", role, scope: surfaceByRole[role].scope, targetOptions: [], targetOptionsCapped: false,
  });
}
