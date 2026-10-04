import "server-only";
import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { teacherStudentLinks, users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { authorizeCapability, type RiwiActor } from "./capabilities";
import { RIWI_TARGET_CURSOR_MAX_LENGTH, riwiRoleSurfaceSchema, type RiwiRoleSurface } from "./contracts";

export const RIWI_SCOPE_PAGE_SIZE = 50;
export const RIWI_SCOPE_MAX_PAGE_SIZE = 100;

export type RiwiScopeTarget = { id: string; name: string };
export type RiwiScopeTargetRow = RiwiScopeTarget & { sortKey: string };
export type RiwiTargetPosition = { sortKey: string; id: string };
export type RiwiRoleSurfaceDependencies = {
  listAssignedStudents: (teacherId: string, after: RiwiTargetPosition | null, limit: number) => Promise<RiwiScopeTargetRow[]>;
  listActiveStudents: (after: RiwiTargetPosition | null, limit: number) => Promise<RiwiScopeTargetRow[]>;
};

type ScopePolicy = { scope: RiwiRoleSurface["scope"]; targetCapability: "riwi.report.read_assigned" | "riwi.report.read_admin_scope" | null };
const surfaceByRole: Readonly<Record<Role, ScopePolicy>> = {
  student: { scope: "self", targetCapability: null },
  teacher: { scope: "assigned_roster", targetCapability: "riwi.report.read_assigned" },
  admin: { scope: "admin_cohort", targetCapability: "riwi.report.read_admin_scope" },
  owner: { scope: "owner_centre", targetCapability: "riwi.report.read_admin_scope" },
};

const cursorSchema = z.object({
  version: z.literal(1),
  actorId: z.string().uuid(),
  role: z.enum(["student", "teacher", "admin", "owner"]),
  scope: z.enum(["self", "assigned_roster", "admin_cohort", "owner_centre"]),
  after: z.object({ sortKey: z.string().max(200), id: z.string().uuid() }).strict(),
}).strict();

const userSortKey = sql<string>`lower(trim(${users.name}))`;

export function createRiwiRoleSurfaceDependencies(database: typeof db = db): RiwiRoleSurfaceDependencies {
  return {
    listAssignedStudents: async (teacherId, after, limit) => {
      const afterPosition = after
        ? or(
            gt(userSortKey, after.sortKey),
            and(eq(userSortKey, after.sortKey), gt(users.id, after.id)),
          )
        : undefined;
      return database.select({ id: users.id, name: users.name, sortKey: userSortKey })
        .from(teacherStudentLinks)
        .innerJoin(users, eq(users.id, teacherStudentLinks.studentUserId))
        .where(and(
          eq(teacherStudentLinks.teacherUserId, teacherId),
          eq(users.role, "student"),
          eq(users.accountStatus, "active"),
          afterPosition,
        ))
        .orderBy(asc(userSortKey), asc(users.id))
        .limit(limit);
    },
    listActiveStudents: async (after, limit) => {
      const afterPosition = after
        ? or(
            gt(userSortKey, after.sortKey),
            and(eq(userSortKey, after.sortKey), gt(users.id, after.id)),
          )
        : undefined;
      return database.select({ id: users.id, name: users.name, sortKey: userSortKey })
        .from(users)
        .where(and(eq(users.role, "student"), eq(users.accountStatus, "active"), afterPosition))
        .orderBy(asc(userSortKey), asc(users.id))
        .limit(limit);
    },
  };
}

const defaultDependencies = createRiwiRoleSurfaceDependencies();

export type RiwiTargetPage = {
  targetOptions: RiwiScopeTarget[];
  nextCursor: string | null;
};

function pageLimit(value: number | undefined): number {
  const requested = value ?? RIWI_SCOPE_PAGE_SIZE;
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > RIWI_SCOPE_MAX_PAGE_SIZE) {
    throw new Error("riwi_target_limit_invalid");
  }
  return requested;
}

function cursorContext(actor: RiwiActor): { actorId: string; role: Role; scope: RiwiRoleSurface["scope"] } {
  return { actorId: actor.id, role: actor.role, scope: surfaceByRole[actor.role].scope };
}

function decodeCursor(cursor: string | null | undefined, actor: RiwiActor): RiwiTargetPosition | null {
  if (cursor === undefined || cursor === null || cursor === "") return null;
  if (cursor.length > RIWI_TARGET_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("riwi_target_cursor_invalid");
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const parsed = cursorSchema.safeParse(decoded);
    const context = cursorContext(actor);
    if (!parsed.success || parsed.data.actorId !== context.actorId || parsed.data.role !== context.role || parsed.data.scope !== context.scope) {
      throw new Error("riwi_target_cursor_invalid");
    }
    return parsed.data.after;
  } catch {
    throw new Error("riwi_target_cursor_invalid");
  }
}

function encodeCursor(actor: RiwiActor, after: RiwiTargetPosition): string {
  const encoded = Buffer.from(JSON.stringify({ version: 1, ...cursorContext(actor), after })).toString("base64url");
  if (encoded.length > RIWI_TARGET_CURSOR_MAX_LENGTH) throw new Error("riwi_target_cursor_invalid");
  return encoded;
}

/**
 * Reads exactly one bounded keyset page. A cursor only carries position; each
 * invocation rebuilds the query from the current active actor, role and roster.
 */
export async function getRiwiTargetPage(
  actor: RiwiActor,
  options: { cursor?: string | null; limit?: number } = {},
  dependencies: RiwiRoleSurfaceDependencies = defaultDependencies,
): Promise<RiwiTargetPage> {
  const limit = pageLimit(options.limit);
  if (actor.accountStatus !== "active" || !authorizeCapability(actor, "riwi.chat.self").allowed) {
    throw new Error("riwi_role_surface_forbidden");
  }

  const policy = surfaceByRole[actor.role];
  if (!policy.targetCapability) return { targetOptions: [], nextCursor: null };
  if (!authorizeCapability(actor, policy.targetCapability).allowed) throw new Error("riwi_role_surface_forbidden");

  const after = decodeCursor(options.cursor, actor);
  const queried = actor.role === "teacher"
    ? await dependencies.listAssignedStudents(actor.id, after, limit + 1)
    : await dependencies.listActiveStudents(after, limit + 1);
  const hasMore = queried.length > limit;
  const rows = queried.slice(0, limit);
  const last = rows.at(-1);
  const nextCursor = hasMore && last ? encodeCursor(actor, { sortKey: last.sortKey, id: last.id }) : null;
  const targetOptions = rows.map(({ id, name }) => ({ id, name: name.trim().slice(0, 120) || "Learner" }));
  return { targetOptions, nextCursor };
}

/**
 * Supplies the first presentation page only. Every continuation and selected
 * target is re-authorized server-side; this projection is never authority.
 */
export async function getRiwiRoleSurface(
  actor: RiwiActor,
  dependencies: RiwiRoleSurfaceDependencies = defaultDependencies,
): Promise<RiwiRoleSurface> {
  const policy = surfaceByRole[actor.role];
  const firstPage = await getRiwiTargetPage(actor, { limit: RIWI_SCOPE_PAGE_SIZE }, dependencies);
  return riwiRoleSurfaceSchema.parse({
    status: "ready", role: actor.role, scope: policy.scope,
    targetOptions: firstPage.targetOptions, nextCursor: firstPage.nextCursor,
  });
}

export function unavailableRiwiRoleSurface(role: Role): RiwiRoleSurface {
  return riwiRoleSurfaceSchema.parse({
    status: "unavailable", role, scope: surfaceByRole[role].scope, targetOptions: [], nextCursor: null,
  });
}
