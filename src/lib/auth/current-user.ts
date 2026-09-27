import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getSession } from "./session";
import { timed } from "@/lib/observability/timing";
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

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  if (!session) return null;

  /*
   * The first query of every private page, and therefore the first thing a
   * database problem breaks. It is timed so a slow or failing identity lookup is
   * visible in the log *before* it shows up as an error boundary.
   */
  const row = await timed("auth.currentUser", () =>
    db.query.users.findFirst({
      where: eq(users.id, session.sub),
      columns: {
        id: true,
        name: true,
        email: true,
        role: true,
        accountStatus: true,
        locale: true,
        onboardingCompletedAt: true,
        statusReason: true,
      },
    })
  );
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    accountStatus: row.accountStatus,
    locale: row.locale,
    onboarded: Boolean(row.onboardingCompletedAt),
    statusReason: row.statusReason,
  };
});

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
