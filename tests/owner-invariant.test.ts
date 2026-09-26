import assert from "node:assert/strict";
import test from "node:test";
import { canRemoveOwnerRole, countActiveOwners } from "@/lib/auth/owner-invariant";
import { isRole, canGrantRole, outranks } from "@/lib/auth/roles";

/**
 * These checks need a database, so they skip (loudly) when DATABASE_URL is not
 * exported — `npm test` stays runnable without infrastructure, and the guard is
 * still exercised in the environment that has one (see also
 * scripts/verify-owner.mjs, which drives the same rules over HTTP).
 */
const withDb = { skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not set" };

test("the last active owner cannot lose the role", withDb, async () => {
  const before = await countActiveOwners();
  assert.ok(before >= 1, "a seeded database must have at least one active owner");

  const { db } = await import("@/db/client");
  const { users } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, "owner"));
  const ownerId = owners[0]!.id;

  if (before === 1) {
    const verdict = await canRemoveOwnerRole(ownerId);
    assert.equal(verdict.ok, false, "the only owner must be protected");
    assert.equal(verdict.reason, "last_owner");
  } else {
    // More than one live owner: any single removal is allowed, because the
    // centre still has authority afterwards.
    assert.equal((await canRemoveOwnerRole(ownerId)).ok, true);
  }
});

test("a student is not an owner, so removing the role is always allowed", withDb, async () => {
  const { db } = await import("@/db/client");
  const { users } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [student] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "student"))
    .limit(1);
  assert.ok(student, "the demo seed provides students");
  assert.equal((await canRemoveOwnerRole(student.id)).ok, true);
});

test("a non-existent user cannot break the invariant", withDb, async () => {
  assert.equal((await canRemoveOwnerRole("00000000-0000-0000-0000-000000000000")).ok, true);
});

test("only the owner may grant the owner role through the role rules", () => {
  assert.equal(isRole("owner"), true);
  // An administrator can never create another owner…
  assert.equal(canGrantRole("admin", "owner"), false);
  assert.equal(canGrantRole("teacher", "owner"), false);
  // …and only an owner outranks an owner.
  assert.equal(outranks("owner", "owner"), false, "an owner must not outrank another owner's row");
  assert.equal(outranks("owner", "admin"), true);
  assert.equal(outranks("admin", "owner"), false);
});

test("the transfer workflow is the only door to the owner role", async () => {
  const { readFileSync } = await import("node:fs");
  const roleRoute = readFileSync("src/app/api/admin/users/[id]/role/route.ts", "utf8");
  assert.match(
    roleRoute,
    /nextRole === "owner"[\s\S]{0,120}owner_requires_transfer/,
    "the generic role endpoint must refuse to mint an owner"
  );

  const transferRoute = readFileSync("src/app/api/owner/transfer/route.ts", "utf8");
  assert.match(transferRoute, /db\s*\.\s*transaction/, "the swap must be one transaction");
  assert.match(transferRoute, /countActiveOwnersIn/, "the swap must count the owners after the writes");
  assert.match(transferRoute, /verifyPassword/, "the owner must re-authenticate");
});
