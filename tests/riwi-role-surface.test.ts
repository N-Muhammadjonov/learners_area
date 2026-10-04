import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Role } from "../src/lib/auth/roles";
import type { RiwiActor } from "../src/lib/services/riwi/capabilities";
import { getRiwiRoleSurface, RIWI_SCOPE_TARGET_LIMIT, unavailableRiwiRoleSurface, type RiwiRoleSurfaceDependencies, type RiwiScopeTarget } from "../src/lib/services/riwi/role-surface";
import { riwiToolBroker } from "../src/lib/services/riwi/core-tools";

const STUDENT = "aaaaaaaa-0000-4000-8000-000000000001";
const LEARNER_A = "aaaaaaaa-0000-4000-8000-000000000002";
const LEARNER_B = "aaaaaaaa-0000-4000-8000-000000000003";
const TEACHER = "aaaaaaaa-0000-4000-8000-000000000004";
const ADMIN = "aaaaaaaa-0000-4000-8000-000000000005";
const OWNER = "aaaaaaaa-0000-4000-8000-000000000006";
const active = (id: string, role: Role): RiwiActor => ({ id, role, accountStatus: "active" });

function target(index: number): RiwiScopeTarget {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name: `Learner ${index}` };
}

function dependencies(overrides: Partial<RiwiRoleSurfaceDependencies> = {}) {
  const calls: Array<{ kind: "assigned" | "students"; actorId: string; limit: number }> = [];
  const defaults: RiwiRoleSurfaceDependencies = {
    listAssignedStudents: async (teacherId, limit) => {
      calls.push({ kind: "assigned", actorId: teacherId, limit });
      return [{ id: LEARNER_A, name: "Assigned One" }];
    },
    listActiveStudents: async (limit) => {
      calls.push({ kind: "students", actorId: "", limit });
      return [{ id: LEARNER_A, name: "Active One" }, { id: LEARNER_B, name: "Active Two" }];
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
  assert.equal(surface.targetOptionsCapped, false);
  assert.deepEqual(fixture.calls, []);
});

test("teacher scope options come only from the authenticated teacher's active roster query", async () => {
  const fixture = dependencies();
  const surface = await getRiwiRoleSurface(active(TEACHER, "teacher"), fixture.values);
  assert.equal(surface.scope, "assigned_roster");
  assert.deepEqual(surface.targetOptions, [{ id: LEARNER_A, name: "Assigned One" }]);
  assert.deepEqual(fixture.calls, [{ kind: "assigned", actorId: TEACHER, limit: RIWI_SCOPE_TARGET_LIMIT + 1 }]);
});

test("admin sees only the explicitly operational active-student scope, not owner controls", async () => {
  const fixture = dependencies();
  const surface = await getRiwiRoleSurface(active(ADMIN, "admin"), fixture.values);
  assert.equal(surface.scope, "admin_cohort");
  assert.deepEqual(surface.targetOptions.map((item) => item.id), [LEARNER_A, LEARNER_B]);
  assert.deepEqual(fixture.calls, [{ kind: "students", actorId: "", limit: RIWI_SCOPE_TARGET_LIMIT + 1 }]);
});

test("owner gets a centre scope plus optional active-student targets", async () => {
  const fixture = dependencies();
  const surface = await getRiwiRoleSurface(active(OWNER, "owner"), fixture.values);
  assert.equal(surface.scope, "owner_centre");
  assert.equal(surface.targetOptions.length, 2);
});

test("assigned progress tool explicitly permits teachers and owners but not admins or students", () => {
  const contract = riwiToolBroker.contract("riwi.learning.progress.readAssigned");
  assert.ok(contract);
  assert.deepEqual(contract.allowedRoles, ["teacher", "owner"]);
});

test("target list cap is explicit and deterministic", async () => {
  const fixture = dependencies({ listActiveStudents: async (limit) => {
    assert.equal(limit, RIWI_SCOPE_TARGET_LIMIT + 1);
    return Array.from({ length: limit }, (_, index) => target(index + 1));
  } });
  const surface = await getRiwiRoleSurface(active(ADMIN, "admin"), fixture.values);
  assert.equal(surface.targetOptions.length, RIWI_SCOPE_TARGET_LIMIT);
  assert.equal(surface.targetOptionsCapped, true);
  assert.equal(surface.targetOptions.at(-1)?.name, `Learner ${RIWI_SCOPE_TARGET_LIMIT}`);
});

test("inactive actors fail closed before any role-specific target query", async () => {
  const fixture = dependencies();
  await assert.rejects(getRiwiRoleSurface({ ...active(TEACHER, "teacher"), accountStatus: "suspended" }, fixture.values), /riwi_role_surface_forbidden/);
  assert.deepEqual(fixture.calls, []);
  assert.equal(unavailableRiwiRoleSurface("teacher").status, "unavailable");
});

test("RIWI page rechecks the active database user and chat capability before rendering", () => {
  const page = readFileSync("src/app/(app)/riwi/page.tsx", "utf8");
  assert.match(page, /requireActiveUser\(\)/);
  assert.match(page, /authorizeCapability\(actor, "riwi\.chat\.self"\)/);
  assert.match(page, /getRiwiRoleSurface\(actor\)/);
  assert.doesNotMatch(page, /getCurrentUser\(\)/);
});
