import assert from "node:assert/strict";
import test from "node:test";
import { RIWI_CAPABILITIES, ROLE_CAPABILITIES, authorizeCapability, resolveUserScope, type RiwiActor, type ScopeDependencies } from "../src/lib/services/riwi/capabilities";
import type { Role } from "../src/lib/auth/roles";

const STUDENT = "aaaaaaaa-0000-4000-8000-000000000001";
const ASSIGNED = "aaaaaaaa-0000-4000-8000-000000000002";
const TEACHER = "aaaaaaaa-0000-4000-8000-000000000003";
const OWNER = "aaaaaaaa-0000-4000-8000-000000000004";
const actor = (id: string, role: Role, accountStatus: RiwiActor["accountStatus"] = "active"): RiwiActor => ({ id, role, accountStatus });

const deps: ScopeDependencies = {
  subjectRole: async (id) => id === ASSIGNED ? "student" : id === TEACHER ? "teacher" : null,
  isAssigned: async (teacherId, studentId) => teacherId === TEACHER && studentId === ASSIGNED,
};

test("role capabilities are explicit; admin and owner do not inherit by rank", () => {
  assert.ok(ROLE_CAPABILITIES.student.includes("riwi.report.read_self"));
  assert.ok(ROLE_CAPABILITIES.teacher.includes("riwi.report.read_assigned"));
  assert.ok(!ROLE_CAPABILITIES.admin.includes("riwi.report.read_assigned"));
  assert.ok(ROLE_CAPABILITIES.admin.includes("riwi.report.read_admin_scope"));
  assert.ok(ROLE_CAPABILITIES.admin.includes("riwi.users.read_scoped"));
  assert.ok(!ROLE_CAPABILITIES.admin.includes("riwi.provider.read_status"));
  assert.ok(!ROLE_CAPABILITIES.admin.includes("riwi.audit.read_owner"));
  assert.ok(ROLE_CAPABILITIES.owner.includes("riwi.provider.read_status"));
  assert.ok(ROLE_CAPABILITIES.owner.includes("riwi.analytics.read_global"));
  assert.deepEqual([...ROLE_CAPABILITIES.owner].sort(), [...RIWI_CAPABILITIES].sort(), "owner powers remain broad but explicitly enumerated as capabilities evolve");
});

test("capability decisions fail closed for inactive identities and unknown capabilities", () => {
  assert.deepEqual(authorizeCapability(actor(STUDENT, "student"), "riwi.dictionary.lookup"), { allowed: true });
  assert.deepEqual(authorizeCapability(actor(STUDENT, "student", "suspended"), "riwi.dictionary.lookup"), { allowed: false, reason: "inactive" });
  assert.deepEqual(authorizeCapability(actor(STUDENT, "student"), "riwi.arbitrary.sql"), { allowed: false, reason: "capability_denied" });
  assert.deepEqual(authorizeCapability(actor(TEACHER, "teacher"), "riwi.report.read_global"), { allowed: false, reason: "capability_denied" });
});

test("students can resolve self only; caller-supplied ids are not authority", async () => {
  assert.deepEqual(await resolveUserScope(actor(STUDENT, "student"), "riwi.progress.read_self", undefined, deps), {
    allowed: true, kind: "self", userIds: [STUDENT],
  });
  assert.deepEqual(await resolveUserScope(actor(STUDENT, "student"), "riwi.progress.read_self", ASSIGNED, deps), { allowed: false, reason: "not_found" });
  assert.deepEqual(await resolveUserScope(actor(STUDENT, "student"), "riwi.users.read_scoped", ASSIGNED, deps), { allowed: false, reason: "scope_denied" });
});

test("teachers require an active student row and an explicit roster link", async () => {
  assert.deepEqual(await resolveUserScope(actor(TEACHER, "teacher"), "riwi.progress.read_assigned", ASSIGNED, deps), {
    allowed: true, kind: "assigned", userIds: [ASSIGNED],
  });
  assert.deepEqual(await resolveUserScope(actor(TEACHER, "teacher"), "riwi.progress.read_assigned", STUDENT, deps), { allowed: false, reason: "not_found" });
  assert.deepEqual(await resolveUserScope(actor(TEACHER, "teacher"), "riwi.progress.read_assigned", TEACHER, deps), { allowed: false, reason: "not_found" });
  assert.deepEqual(await resolveUserScope(actor(TEACHER, "teacher"), "riwi.feedback.teacher", ASSIGNED, deps), { allowed: false, reason: "scope_denied" }, "unmapped row scopes fail closed");
  const rosterFailure: ScopeDependencies = { ...deps, isAssigned: async () => { throw new Error("unavailable"); } };
  assert.deepEqual(await resolveUserScope(actor(TEACHER, "teacher"), "riwi.report.read_assigned", ASSIGNED, rosterFailure), { allowed: false, reason: "not_found" });
});

test("selected learner authorization is re-evaluated after roster revocation or target role change", async () => {
  let targetRole: Role | null = "student";
  let assigned = true;
  let roleReads = 0;
  let rosterReads = 0;
  const liveDependencies: ScopeDependencies = {
    subjectRole: async () => { roleReads += 1; return targetRole; },
    isAssigned: async () => { rosterReads += 1; return assigned; },
  };
  assert.deepEqual(await resolveUserScope(actor(TEACHER, "teacher"), "riwi.report.read_assigned", ASSIGNED, liveDependencies), {
    allowed: true, kind: "assigned", userIds: [ASSIGNED],
  });
  assigned = false;
  assert.deepEqual(await resolveUserScope(actor(TEACHER, "teacher"), "riwi.report.read_assigned", ASSIGNED, liveDependencies), {
    allowed: false, reason: "not_found",
  }, "a previously selected learner is not authorized by a stale client page");
  assigned = true;
  targetRole = "teacher";
  assert.deepEqual(await resolveUserScope(actor(TEACHER, "teacher"), "riwi.report.read_assigned", ASSIGNED, liveDependencies), {
    allowed: false, reason: "not_found",
  }, "a demoted/changed target role is rechecked too");
  assert.equal(roleReads, 3);
  assert.equal(rosterReads, 2, "revoked or non-student targets never reach roster-backed data access");
});

test("admin report scope is operational only; owner global scope rejects a row id", async () => {
  assert.deepEqual(await resolveUserScope(actor("aaaaaaaa-0000-4000-8000-000000000005", "admin"), "riwi.report.read_admin_scope", undefined, deps), {
    allowed: true, kind: "admin", userIds: null,
  });
  assert.deepEqual(await resolveUserScope(actor("aaaaaaaa-0000-4000-8000-000000000005", "admin"), "riwi.report.read_admin_scope", ASSIGNED, deps), {
    allowed: true, kind: "admin-subject", userIds: [ASSIGNED],
  });
  assert.deepEqual(await resolveUserScope(actor("aaaaaaaa-0000-4000-8000-000000000005", "admin"), "riwi.report.read_admin_scope", TEACHER, deps), { allowed: false, reason: "not_found" });
  assert.deepEqual(await resolveUserScope(actor(OWNER, "owner"), "riwi.report.read_global", undefined, deps), { allowed: true, kind: "global", userIds: null });
  assert.deepEqual(await resolveUserScope(actor(OWNER, "owner"), "riwi.report.read_global", ASSIGNED, deps), { allowed: false, reason: "not_found" });
});

test("admin user scope cannot inspect owner or arbitrary accounts; owner target still must exist", async () => {
  const admin = actor("aaaaaaaa-0000-4000-8000-000000000005", "admin");
  assert.deepEqual(await resolveUserScope(admin, "riwi.users.read_scoped", ASSIGNED, deps), { allowed: true, kind: "staff", userIds: [ASSIGNED] });
  assert.deepEqual(await resolveUserScope(admin, "riwi.users.read_scoped", TEACHER, deps), { allowed: true, kind: "staff", userIds: [TEACHER] });
  assert.deepEqual(await resolveUserScope(admin, "riwi.users.read_scoped", OWNER, deps), { allowed: false, reason: "not_found" });
  assert.deepEqual(await resolveUserScope(actor(OWNER, "owner"), "riwi.users.read_scoped", STUDENT, deps), { allowed: false, reason: "not_found" });
});
