import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

/**
 * The one rule the centre must never break: **at least one OWNER always exists.**
 *
 * A private centre whose last owner was demoted, suspended or deleted has no
 * authority left: nobody can approve an applicant, restore a role, or hand the
 * business on. Every path that could remove the last owner asks this module
 * first, inside the same transaction that performs the change.
 *
 * Two kinds of authority:
 *   - `canOwn`: the row could *be* an owner. Active and not suspended.
 *   - `countOwners`: how many such rows exist.
 *
 * A suspended owner is not authority — the account-status check runs before the
 * role check everywhere else in the app, so counting them would let the centre
 * lock itself out.
 */

export type OwnerGuardResult =
  | { ok: true }
  | { ok: false; reason: "last_owner" };

/** Owners who could actually sign in right now. */
export async function countActiveOwners(): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.accountStatus, "active")));
  return row?.value ?? 0;
}

/**
 * Would removing the owner role from `userId` leave the centre without one?
 *
 * `client = db` by default; pass a transaction to evaluate the check with the
 * same snapshot as the write that follows it.
 */
export async function canRemoveOwnerRole(
  userId: string,
  client: Pick<typeof db, "select"> = db
): Promise<OwnerGuardResult> {
  const [target] = await client
    .select({ role: users.role, accountStatus: users.accountStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target || target.role !== "owner" || target.accountStatus !== "active") {
    // Not currently a live owner, so removing the role changes nothing.
    return { ok: true };
  }

  const [others] = await client
    .select({ value: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.accountStatus, "active"), ne(users.id, userId)));

  return (others?.value ?? 0) > 0 ? { ok: true } : { ok: false, reason: "last_owner" };
}

/**
 * Would suspending (or rejecting) `userId` leave the centre without a live owner?
 *
 * Same question as above from the other direction: an owner who cannot sign in
 * is not an owner the centre can rely on.
 */
export async function canRemoveOwnerAccess(userId: string): Promise<OwnerGuardResult> {
  return canRemoveOwnerRole(userId);
}

/**
 * Live owners as seen by an open transaction.
 *
 * Used after a role swap, inside the transaction that performed it: the count has
 * to include the writes that were just made, which a pre-check cannot see.
 */
export async function countActiveOwnersIn(
  tx: Pick<typeof db, "select">
): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.accountStatus, "active")));
  return row?.value ?? 0;
}

/** Would deleting this account remove the last live owner? */
export async function canDeleteUser(userId: string): Promise<OwnerGuardResult> {
  return canRemoveOwnerRole(userId);
}
