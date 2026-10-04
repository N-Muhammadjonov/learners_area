import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Role } from "../src/lib/auth/roles";
import { teacherStudentLinks, users } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import type { RiwiActor } from "../src/lib/services/riwi/capabilities";
import {
  createRiwiRoleSurfaceDependencies,
  getRiwiRoleSurface,
  getRiwiTargetPage,
  RIWI_SCOPE_MAX_PAGE_SIZE,
  RIWI_SCOPE_PAGE_SIZE,
  unavailableRiwiRoleSurface,
  type RiwiRoleSurfaceDependencies,
  type RiwiScopeTargetRow,
  type RiwiTargetPosition,
} from "../src/lib/services/riwi/role-surface";
import { riwiToolBroker } from "../src/lib/services/riwi/core-tools";

const STUDENT = "aaaaaaaa-0000-4000-8000-000000000001";
const LEARNER_A = "aaaaaaaa-0000-4000-8000-000000000002";
const LEARNER_B = "aaaaaaaa-0000-4000-8000-000000000003";
const TEACHER = "aaaaaaaa-0000-4000-8000-000000000004";
const ADMIN = "aaaaaaaa-0000-4000-8000-000000000005";
const OWNER = "aaaaaaaa-0000-4000-8000-000000000006";
const active = (id: string, role: Role): RiwiActor => ({ id, role, accountStatus: "active" });

function target(index: number, label = `Learner ${String(index).padStart(4, "0")}`): RiwiScopeTargetRow {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name: label, sortKey: label.trim().toLowerCase() };
}

function afterPosition(item: RiwiScopeTargetRow, after: RiwiTargetPosition | null) {
  return !after || item.sortKey > after.sortKey || (item.sortKey === after.sortKey && item.id > after.id);
}

function dependencies(overrides: Partial<RiwiRoleSurfaceDependencies> = {}) {
  const calls: Array<{ kind: "assigned" | "students"; actorId: string; after: RiwiTargetPosition | null; limit: number }> = [];
  const defaults: RiwiRoleSurfaceDependencies = {
    listAssignedStudents: async (teacherId, after, limit) => {
      calls.push({ kind: "assigned", actorId: teacherId, after, limit });
      return [{ id: LEARNER_A, name: "Assigned One", sortKey: "assigned one" }];
    },
    listActiveStudents: async (after, limit) => {
      calls.push({ kind: "students", actorId: "", after, limit });
      return [
        { id: LEARNER_A, name: "Active One", sortKey: "active one" },
        { id: LEARNER_B, name: "Active Two", sortKey: "active two" },
      ];
    },
  };
  return { values: { ...defaults, ...overrides }, calls };
}

test("student role surface is self-only and makes no target-list query", async () => {
  const fixture = dependencies();
  const surface = await getRiwiRoleSurface(active(STUDENT, "student"), fixture.values);
  assert.equal(surface.status, "ready");
  assert.equal(surface.scope, "self");
  assert.deepEqual(surface.targetOptions, []);
  assert.equal(surface.nextCursor, null);
  assert.deepEqual(fixture.calls, []);
});

test("teacher first-page options come only from its current active roster query", async () => {
  const fixture = dependencies();
  const surface = await getRiwiRoleSurface(active(TEACHER, "teacher"), fixture.values);
  assert.equal(surface.scope, "assigned_roster");
  assert.deepEqual(surface.targetOptions, [{ id: LEARNER_A, name: "Assigned One" }]);
  assert.equal(surface.nextCursor, null);
  assert.deepEqual(fixture.calls, [{ kind: "assigned", actorId: TEACHER, after: null, limit: RIWI_SCOPE_PAGE_SIZE + 1 }]);
});

test("admin and owner receive bounded pages from the operational active-student scope", async () => {
  const adminFixture = dependencies();
  const adminSurface = await getRiwiRoleSurface(active(ADMIN, "admin"), adminFixture.values);
  assert.equal(adminSurface.scope, "admin_cohort");
  assert.deepEqual(adminSurface.targetOptions.map((item) => item.id), [LEARNER_A, LEARNER_B]);
  assert.deepEqual(adminFixture.calls, [{ kind: "students", actorId: "", after: null, limit: RIWI_SCOPE_PAGE_SIZE + 1 }]);

  const ownerFixture = dependencies();
  const ownerSurface = await getRiwiRoleSurface(active(OWNER, "owner"), ownerFixture.values);
  assert.equal(ownerSurface.scope, "owner_centre");
  assert.equal(ownerSurface.targetOptions.length, 2);
});

test("page size is bounded and the continuation cursor is bound to current actor and role", async () => {
  const rows = Array.from({ length: RIWI_SCOPE_PAGE_SIZE + 1 }, (_, index) => target(index + 1));
  const fixture = dependencies({ listActiveStudents: async (after, limit) => rows.filter((row) => afterPosition(row, after)).slice(0, limit) });
  await assert.rejects(getRiwiTargetPage(active(ADMIN, "admin"), { limit: RIWI_SCOPE_MAX_PAGE_SIZE + 1 }, fixture.values), /riwi_target_limit_invalid/);
  const first = await getRiwiTargetPage(active(ADMIN, "admin"), { limit: RIWI_SCOPE_PAGE_SIZE }, fixture.values);
  assert.equal(first.targetOptions.length, RIWI_SCOPE_PAGE_SIZE);
  assert.ok(first.nextCursor);

  await assert.rejects(
    getRiwiTargetPage(active(ADMIN, "teacher"), { cursor: first.nextCursor }, fixture.values),
    /riwi_target_cursor_invalid/,
    "changing the current actor role cannot reuse the prior role's cursor",
  );
  await assert.rejects(getRiwiTargetPage(active(ADMIN, "admin"), { cursor: "not-a-cursor" }, fixture.values), /riwi_target_cursor_invalid/);
});

test("encoded cursor stays bounded for maximum-length multibyte learner names", async () => {
  const longName = "文".repeat(200);
  const rows = [
    { ...target(1), name: longName, sortKey: longName.toLowerCase() },
    { ...target(2), name: longName, sortKey: longName.toLowerCase() },
  ];
  const fixture = dependencies({ listActiveStudents: async (after, limit) => rows.filter((row) => afterPosition(row, after)).slice(0, limit) });
  const first = await getRiwiTargetPage(active(ADMIN, "admin"), { limit: 1 }, fixture.values);
  assert.equal(first.targetOptions[0]?.name.length, 120, "only the bounded display name is returned");
  assert.ok(first.nextCursor);
  assert.ok(first.nextCursor.length <= 2_048);
  const second = await getRiwiTargetPage(active(ADMIN, "admin"), { cursor: first.nextCursor, limit: 1 }, fixture.values);
  assert.equal(second.targetOptions[0]?.id, rows[1]?.id, "the complete database sort key is retained in the safe cursor");
});

test("cursor continuation re-queries the live teacher roster after a revocation", async () => {
  const rows = [
    { id: LEARNER_A, name: "Alpha", sortKey: "alpha" },
    { id: LEARNER_B, name: "Beta", sortKey: "beta" },
    { id: "aaaaaaaa-0000-4000-8000-000000000007", name: "Charlie", sortKey: "charlie" },
  ];
  let currentlyAssigned = new Set(rows.map((row) => row.id));
  let calls = 0;
  const fixture = dependencies({ listAssignedStudents: async (_teacherId, after, limit) => {
    calls += 1;
    return rows.filter((row) => currentlyAssigned.has(row.id) && afterPosition(row, after)).slice(0, limit);
  } });
  const first = await getRiwiTargetPage(active(TEACHER, "teacher"), { limit: 1 }, fixture.values);
  assert.deepEqual(first.targetOptions.map((row) => row.name), ["Alpha"]);
  assert.ok(first.nextCursor);

  currentlyAssigned = new Set([LEARNER_A, rows[2]!.id]);
  const second = await getRiwiTargetPage(active(TEACHER, "teacher"), { cursor: first.nextCursor, limit: 1 }, fixture.values);
  assert.deepEqual(second.targetOptions.map((row) => row.name), ["Charlie"]);
  assert.notEqual(second.targetOptions[0]?.id, LEARNER_B);
  assert.equal(calls, 2, "authorization scope is queried again rather than trusted from the cursor");
});

test("PostgreSQL teacher pages re-read active roster membership after the cursor was issued", async () => {
  const database = await createTestDatabase();
  const thirdLearnerId = "aaaaaaaa-0000-4000-8000-000000000008";
  try {
    await database.db.insert(users).values([
      { id: TEACHER, name: "Roster Teacher", role: "teacher", accountStatus: "active" },
      { id: LEARNER_A, name: "Alpha", role: "student", accountStatus: "active" },
      { id: LEARNER_B, name: "Beta", role: "student", accountStatus: "active" },
      { id: thirdLearnerId, name: "Charlie", role: "student", accountStatus: "active" },
    ]);
    await database.db.insert(teacherStudentLinks).values([
      { teacherUserId: TEACHER, studentUserId: LEARNER_A },
      { teacherUserId: TEACHER, studentUserId: LEARNER_B },
      { teacherUserId: TEACHER, studentUserId: thirdLearnerId },
    ]);

    const dependencies = createRiwiRoleSurfaceDependencies(database.db);
    const actor = active(TEACHER, "teacher");
    const first = await getRiwiTargetPage(actor, { limit: 1 }, dependencies);
    assert.deepEqual(first.targetOptions.map((item) => item.name), ["Alpha"]);
    assert.ok(first.nextCursor);

    await database.db.update(users).set({ accountStatus: "suspended" }).where(eq(users.id, LEARNER_B));
    const next = await getRiwiTargetPage(actor, { cursor: first.nextCursor, limit: 1 }, dependencies);
    assert.deepEqual(next.targetOptions.map((item) => item.name), ["Charlie"]);
    assert.notEqual(next.targetOptions[0]?.id, LEARNER_B);
  } finally {
    await database.close();
  }
});

test("all 1,205 authorized targets are returned exactly once across bounded pages", async () => {
  const authorized = Array.from({ length: 1_205 }, (_, index) => target(index + 1));
  const fixture = dependencies({ listActiveStudents: async (after, limit) => authorized
    .filter((row) => afterPosition(row, after))
    .slice(0, limit) });
  const actual: Array<{ id: string; name: string }> = [];
  let cursor: string | null = null;
  let pageCount = 0;

  do {
    const page = await getRiwiTargetPage(active(ADMIN, "admin"), { cursor, limit: RIWI_SCOPE_PAGE_SIZE }, fixture.values);
    actual.push(...page.targetOptions);
    cursor = page.nextCursor;
    pageCount += 1;
    assert.ok(pageCount <= Math.ceil(authorized.length / RIWI_SCOPE_PAGE_SIZE), "the keyset cursor must advance and terminate");
  } while (cursor);

  assert.equal(pageCount, Math.ceil(1_205 / RIWI_SCOPE_PAGE_SIZE));
  assert.equal(actual.length, 1_205);
  assert.equal(new Set(actual.map((row) => row.id)).size, 1_205, "there are no duplicate target ids");
  assert.deepEqual(actual.map((row) => row.id), authorized.map((row) => row.id), "stable name/id order has no omissions");
  assert.ok(fixture.calls.every((call) => call.kind === "students" && call.limit === RIWI_SCOPE_PAGE_SIZE + 1));
});

test("PostgreSQL keyset queries paginate 1,205 active students without gaps, duplicates, or cross-role rows", async () => {
  const database = await createTestDatabase();
  try {
    const activeStudents = Array.from({ length: 1_205 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: index < 5 ? "Same Name" : `Learner ${String(index + 1).padStart(4, "0")}`,
      role: "student" as const,
      accountStatus: "active" as const,
    }));
    await database.db.insert(users).values(activeStudents);
    await database.db.insert(users).values([
      { id: "20000000-0000-4000-8000-000000000001", name: "Excluded Suspended Student", role: "student", accountStatus: "suspended" },
      { id: "20000000-0000-4000-8000-000000000002", name: "Excluded Active Teacher", role: "teacher", accountStatus: "active" },
    ]);

    const dependencies = createRiwiRoleSurfaceDependencies(database.db);
    const actor = active("30000000-0000-4000-8000-000000000001", "admin");
    const actual: Array<{ id: string; name: string }> = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await getRiwiTargetPage(actor, { cursor, limit: RIWI_SCOPE_PAGE_SIZE }, dependencies);
      actual.push(...page.targetOptions);
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages <= 25, "a PostgreSQL cursor must advance within the known page bound");
    } while (cursor);

    const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
    const expected = [...activeStudents].sort((left, right) =>
      compare(left.name.trim().toLowerCase(), right.name.trim().toLowerCase()) || compare(left.id, right.id));
    assert.equal(actual.length, 1_205);
    assert.equal(new Set(actual.map((item) => item.id)).size, 1_205);
    assert.deepEqual(actual.map((item) => item.id), expected.map((item) => item.id));
    assert.equal(actual.some((item) => item.name.includes("Excluded")), false, "inactive students and active non-students are not exposed");

    const index = await database.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'users_riwi_active_student_target_idx'",
    );
    assert.equal(index.length, 1);
    assert.match(index[0]!.indexdef, /lower\s*\(\s*trim\s*\(\s*both from\s+name\s*\)\s*\)/i);
  } finally {
    await database.close();
  }
});

test("assigned progress tool explicitly permits teachers and owners but not admins or students", () => {
  const contract = riwiToolBroker.contract("riwi.learning.progress.readAssigned");
  assert.ok(contract);
  assert.deepEqual(contract.allowedRoles, ["teacher", "owner"]);
});

test("inactive actors fail closed before any role-specific target query", async () => {
  const fixture = dependencies();
  await assert.rejects(getRiwiRoleSurface({ ...active(TEACHER, "teacher"), accountStatus: "suspended" }, fixture.values), /riwi_role_surface_forbidden/);
  assert.deepEqual(fixture.calls, []);
  assert.equal(unavailableRiwiRoleSurface("teacher").status, "unavailable");
});

test("RIWI page rechecks active identity and capability; target route authenticates every page", () => {
  const page = readFileSync("src/app/(app)/riwi/page.tsx", "utf8");
  const route = readFileSync("src/app/api/riwi/targets/route.ts", "utf8");
  const targetHandler = readFileSync("src/lib/services/riwi/targets-http.ts", "utf8");
  assert.match(page, /requireActiveUser\(\)/);
  assert.match(page, /authorizeCapability\(actor, "riwi\.chat\.self"\)/);
  assert.match(page, /getRiwiRoleSurface\(actor\)/);
  assert.match(page, /key=\{`\$\{user\.id\}:\$\{user\.role\}`\}/);
  assert.match(route, /handleRiwiTargetsGet\(request\)/, "the Next route exports only the HTTP GET and delegates to the shared handler");
  assert.match(targetHandler, /authenticate: requireActiveUser/);
  assert.match(targetHandler, /getTargetPage: getRiwiTargetPage/);
  assert.match(targetHandler, /private, no-store/);
  assert.match(targetHandler, /if \(!user\) return NextResponse\.json\([\s\S]*status: 401/);
  assert.doesNotMatch(page, /getCurrentUser\(\)/);
});
