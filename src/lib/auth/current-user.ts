import "server-only";
import { cache } from "react";
import { getSession } from "./session";
import { timed } from "@/lib/observability/timing";
import { validateSessionAuthority } from "./session-authority";
export { validateSessionAuthority } from "./session-authority";
export type { SessionAuthorityInput } from "./session-authority";
import { hasPrivateAccess, type AccountStatus } from "./account-status";
import { isAdministrator, isStaff, roleAtLeast, type Role } from "./roles";
import type { Actor } from "./ownership";

/**
 * The authoritative identity for a request.
 *
 * The signed session cookie only carries *who you are* (a user id) plus enough
 * presentation data to avoid flicker. It deliberately does NOT carry authority:
 * role and account status are read from the database on every request, wrapped
 * in React's `cache()` so a single request never queries twice.
 *
 * That is what makes "suspend this account" and "demote this teacher" take
 * effect on the next request, even while the offender still has an old page
 * open — the cookie cannot keep a revoked permission alive.
 */

export type CurrentUser = {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  accountStatus: AccountStatus;
  locale: string;
  onboarded: boolean;
  statusReason: string | null;
};

export type CurrentSessionAuthority = {
  user: CurrentUser;
  authVersion: number;
  sessionKey: string;
  expiresAt: number;
};

/** Server-only session binding shared by the page and media authorization. */
export const getCurrentSessionAuthority = cache(async (): Promise<CurrentSessionAuthority | null> => {
  const session = await timed("auth.session", getSession);
  if (!session) return null;
  const user = await validateSessionAuthority({ userId: session.sub, authVersion: session.authVersion,
    sessionKey: session.sessionKey, expiresAt: session.expiresAt });
  return user ? { user, authVersion: session.authVersion, sessionKey: session.sessionKey, expiresAt: session.expiresAt } : null;
});

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => (await getCurrentSessionAuthority())?.user ?? null);

/** A signed-in account, whatever its admission state. */
export async function requireUser(): Promise<CurrentUser | null> {
  return getCurrentUser();
}

/** A signed-in AND approved account: the gate for every private capability. */
export async function requireActiveUser(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return hasPrivateAccess(user.accountStatus) ? user : null;
}

export async function requireStaff(): Promise<CurrentUser | null> {
  const user = await requireActiveUser();
  if (!user) return null;
  return isStaff(user.role) ? user : null;
}

export async function requireAdministrator(): Promise<CurrentUser | null> {
  const user = await requireActiveUser();
  if (!user) return null;
  return isAdministrator(user.role) ? user : null;
}

export async function requireOwner(): Promise<CurrentUser | null> {
  const user = await requireActiveUser();
  if (!user) return null;
  return user.role === "owner" ? user : null;
}

/** Any role at or above the given minimum (rank-based checks, used sparingly). */
export async function requireRoleAtLeast(minimum: Role): Promise<CurrentUser | null> {
  const user = await requireActiveUser();
  if (!user) return null;
  return roleAtLeast(user.role, minimum) ? user : null;
}

/**
 * The database-identity projection content rules take: id + role, nothing else.
 * Passing this (instead of the session cookie's claims) is what makes an
 * ownership check follow a role change immediately.
 */
export function actorOf(user: CurrentUser): Actor {
  return { id: user.id, role: user.role };
}

export const SELF_SERVICE_ROLES: Role[] = ["owner", "admin"];
export { isAdministrator, isStaff };
