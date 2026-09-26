import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  ROLES,
  canGrantRole,
  grantableRoles,
  isAdministrator,
  isStaff,
  outranks,
  roleAtLeast,
  roleRank,
  type Role,
} from "../src/lib/auth/roles";
import {
  ACCOUNT_STATUSES,
  canRequestAccess,
  hasPrivateAccess,
  needsAccessScreen,
} from "../src/lib/auth/account-status";
import { canManageContent } from "../src/lib/auth/ownership";

/**
 * Access-control tests.
 *
 * Two halves, on purpose:
 *
 *  1. The pure rules — rank, grants, admission state, content ownership. These
 *     are the rules every request handler calls, so they are tested directly.
 *  2. Source-level invariants across the API surface. A route that reads the
 *     role out of the cookie instead of the database, or that trusts a
 *     client-supplied id, still compiles; it is only visible in the source. The
 *     assertions below are what make "server-side authorization" a property of
 *     the codebase rather than a promise in a document.
 */

const ROOT = new URL("..", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const API_ROUTES = walk(join(ROOT, "src/app/api"))
  .map((f) => relative(ROOT, f))
  .filter((f) => f.endsWith("route.ts"));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// The role ladder
// ---------------------------------------------------------------------------

test("the role ladder is student < teacher < admin < owner", () => {
  assert.deepEqual([...ROLES], ["student", "teacher", "admin", "owner"]);
  assert.ok(roleRank("student") < roleRank("teacher"));
  assert.ok(roleRank("teacher") < roleRank("admin"));
  assert.ok(roleRank("admin") < roleRank("owner"));

  assert.equal(roleAtLeast("owner", "admin"), true);
  assert.equal(roleAtLeast("admin", "owner"), false);
  assert.equal(outranks("owner", "admin"), true);
  assert.equal(outranks("admin", "owner"), false);
  // An admin may not act on an equal, and never on itself.
  assert.equal(outranks("admin", "admin"), false);
});

test("staff and administrator levels include the owner", () => {
  assert.equal(isStaff("teacher"), true);
  assert.equal(isStaff("admin"), true);
  assert.equal(isStaff("owner"), true);
  assert.equal(isStaff("student"), false);

  assert.equal(isAdministrator("admin"), true);
  assert.equal(isAdministrator("owner"), true);
  assert.equal(isAdministrator("teacher"), false);
});

test("only an owner may grant the admin role, and nobody but an owner may grant owner", () => {
  assert.deepEqual(grantableRoles("owner"), ["student", "teacher", "admin", "owner"]);
  assert.deepEqual(grantableRoles("admin"), ["student", "teacher"]);
  assert.deepEqual(grantableRoles("teacher"), []);
  assert.deepEqual(grantableRoles("student"), []);

  assert.equal(canGrantRole("admin", "admin"), false);
  assert.equal(canGrantRole("admin", "owner"), false);
  assert.equal(canGrantRole("owner", "admin"), true);
  assert.equal(canGrantRole("owner", "owner"), true);
  assert.equal(canGrantRole("teacher", "student"), false);
});

// ---------------------------------------------------------------------------
// Admission state
// ---------------------------------------------------------------------------

test("only an ACTIVE account reaches private content", () => {
  assert.equal(hasPrivateAccess("active"), true);
  for (const status of ["pending", "rejected", "suspended"] as const) {
    assert.equal(hasPrivateAccess(status), false, `${status} must not reach private content`);
  }
});

test("a pending or rejected applicant may ask again; a suspended account may not", () => {
  assert.equal(canRequestAccess("pending"), true);
  assert.equal(canRequestAccess("rejected"), true);
  assert.equal(canRequestAccess("suspended"), false);
  assert.equal(canRequestAccess("active"), false);
});

test("every non-active status needs the waiting screen", () => {
  assert.equal(needsAccessScreen("active"), false);
  for (const status of ACCOUNT_STATUSES.filter((s) => s !== "active")) {
    assert.equal(needsAccessScreen(status), true);
  }
});

// ---------------------------------------------------------------------------
// Content ownership
// ---------------------------------------------------------------------------

test("a teacher keeps their own material, an administrator may edit anyone's", () => {
  const teacherA = { id: "aaaa", role: "teacher" as Role };
  const teacherB = { id: "bbbb", role: "teacher" as Role };
  const admin = { id: "cccc", role: "admin" as Role };
  const owner = { id: "dddd", role: "owner" as Role };

  assert.equal(canManageContent(teacherA, "aaaa"), true);
  assert.equal(canManageContent(teacherA, "bbbb"), false);
  assert.equal(canManageContent(admin, "bbbb"), true);
  assert.equal(canManageContent(owner, "bbbb"), true);
  // A student never manages material, not even their own row.
  assert.equal(canManageContent({ id: "eeee", role: "student" }, "eeee"), false);
  // An identity without an id cannot accidentally match an empty creator.
  assert.equal(canManageContent({ role: "admin" }, ""), false);
});

test("the ownership rule accepts both identity shapes", () => {
  assert.equal(canManageContent({ sub: "x", role: "teacher" }, "x"), true);
  assert.equal(canManageContent({ sub: "x", role: "teacher" }, "y"), false);
});

// ---------------------------------------------------------------------------
// Structural invariants across the API surface
// ---------------------------------------------------------------------------

test("no API route authorizes from the session cookie alone", () => {
  const offenders = API_ROUTES.filter((route) => /\bgetSession\s*\(/.test(stripComments(read(route))));
  assert.deepEqual(
    offenders,
    [],
    `these routes must use the database-backed guards (requireActiveUser/…): ${offenders.join(", ")}`
  );
});

test("every private API route rejects anonymous callers with 401", () => {
  const guard = /require(ActiveUser|Staff|Administrator|Owner|RoleAtLeast)\(/;
  const exceptions = [
    // Signed-out flows and the admission request itself (a pending applicant
    // must be able to apply; it authorizes with requireUser, not the active gate).
    "src/app/api/auth/",
    "src/app/api/admission/",
    "src/app/api/theme/",
    "src/app/api/locale/",
    "src/app/api/notifications/",
    "src/app/api/onboarding/",
    // Build identity of the running deployment (commit, region, environment).
    // It reads no database row, no session and no user input: it is the one
    // public answer to "which commit is this alias serving?", which has to be
    // checkable from outside without a session.
    "src/app/api/version/",
  ];
  for (const route of API_ROUTES) {
    if (exceptions.some((prefix) => route.startsWith(prefix))) continue;
    const source = stripComments(read(route));
    assert.match(source, guard, `${route} must gate on a database-backed guard`);
    // Administrator/owner routes answer 403 for an unidentified caller (they do
    // not confirm whether the caller is signed in), student-facing routes 401.
    const expected = /^src\/app\/api\/(admin|owner|teacher)\//.test(route)
      ? /status: (401|403)/
      : /status: 401/;
    assert.match(source, expected, `${route} must refuse an unauthorised caller`);
  }
});

test("every staff, administrator and owner page guards itself from the database", () => {
  const pages = walk(join(ROOT, "src/app/(app)"))
    .map((f) => relative(ROOT, f))
    .filter((f) => f.endsWith("page.tsx"));

  const rules: Array<[RegExp, RegExp, string]> = [
    [/\/teacher\//, /requireStaff\(\)/, "teacher pages require staff"],
    [/\/admin\//, /requireAdministrator\(\)/, "admin pages require an administrator"],
    [/\/owner\//, /requireOwner\(\)/, "owner pages require the owner"],
  ];

  for (const page of pages) {
    for (const [path, guard, label] of rules) {
      if (!path.test(page)) continue;
      const source = stripComments(read(page));
      assert.match(source, guard, `${page}: ${label}`);
      assert.match(source, /redirect\("/, `${page} must redirect an unauthorised visitor`);
    }
  }
});

test("page-level authorization reads the database, not the session cookie", () => {
  const pages = walk(join(ROOT, "src/app/(app)"))
    .map((f) => relative(ROOT, f))
    .filter((f) => f.endsWith("page.tsx"));
  const offenders = pages.filter((page) => /getSession\(\)/.test(stripComments(read(page))));
  assert.deepEqual(
    offenders,
    [],
    `these pages authorize from the stale cookie: ${offenders.join(", ")}`
  );
});

test("role checks in API routes are rank-aware, not equality against \"admin\"", () => {
  for (const route of API_ROUTES) {
    const source = stripComments(read(route));
    assert.ok(
      !/role\s*===\s*"admin"/.test(source),
      `${route} compares the role to "admin" directly, which locks the owner out`
    );
  }
});

test("authorization never reads the historical isOwner flag", () => {
  const files = walk(join(ROOT, "src"))
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.endsWith("src/db/schema.ts"));
  for (const file of files) {
    const source = stripComments(read(file));
    assert.ok(
      !/isOwner|\bis_owner\b/.test(source),
      `${file} reads the historical isOwner flag instead of the role ladder`
    );
  }
});

test("the admission decision endpoint requires an administrator and never self-approves", () => {
  const source = stripComments(read("src/app/api/admin/admission/[id]/decide/route.ts"));
  assert.match(source, /requireAdministrator\(\)/);

  const decide = stripComments(read("src/lib/data/admission.ts"));
  assert.match(
    decide,
    /decidedByUserId:\s*input\.actorUserId/,
    "the decision must record which administrator made it"
  );
  // The id that is switched to ACTIVE comes from the request row, never from the
  // body — that is what makes self-approval impossible to ask for.
  assert.match(decide, /eq\(users\.id,\s*request\.userId\)/, "the applicant id must come from the request row");
});

test("the admission request itself is open to a pending applicant, and only theirs", () => {
  const route = stripComments(read("src/app/api/admission/request/route.ts"));
  // `getCurrentUser` is the signed-in check that deliberately does NOT require an
  // active account: somebody waiting for admission must be able to apply.
  assert.match(route, /getCurrentUser\(\)/);
  assert.ok(
    !/requireActiveUser\(\)/.test(route),
    "the applicant is not active yet, so the active-account gate cannot be used here"
  );
  assert.match(route, /canRequestAccess\(/);
  assert.match(route, /userId:\s*user\.id/, "the request is created for the signed-in applicant");
  assert.ok(
    !/userId:\s*(body|parsed\.data|client)/.test(route),
    "an applicant must not be able to file a request on behalf of somebody else"
  );
  const data = stripComments(read("src/lib/data/admission.ts"));
  assert.match(data, /userId:\s*input\.userId/, "the insert uses the id the route passed in");
});

test("account status is written server-side with an audited reason", () => {
  const source = stripComments(read("src/lib/data/admission.ts"));
  assert.match(source, /setAccountStatus/);
  assert.match(source, /recordAudit/);
  assert.match(source, /statusUpdatedAt:\s*new Date\(\)|statusUpdatedAt:\s*now/);
});

test("retention windows are configuration, never magic numbers in the query", () => {
  const source = stripComments(read("src/lib/services/retention.ts"));
  for (const key of [
    "RETENTION_INACTIVE_STUDENT_MONTHS",
    "RETENTION_RAW_EVENT_MONTHS",
    "RETENTION_STRUCTURED_MONTHS",
    "RETENTION_AUDIT_MONTHS",
    "RETENTION_EXPORT_DAYS",
  ]) {
    assert.ok(source.includes(key), `retention must read ${key}`);
  }
  // The student rule must be scoped to students only.
  assert.match(source, /eq\(users\.role,\s*"student"\)/);
});

test("the integration report never returns a secret value", () => {
  const source = stripComments(read("src/lib/services/integrations.ts"));
  for (const secret of [
    "R2_SECRET_ACCESS_KEY",
    "R2_ACCESS_KEY_ID",
    "TELEGRAM_BOT_TOKEN",
    "RESEND_API_KEY",
    "SMTP_URL",
  ]) {
    // The name may only be used to test for presence, never returned.
    assert.ok(source.includes(secret), `the report should report whether ${secret} is set`);
    assert.ok(
      !new RegExp(`${secret}[^\\n]*detail:`).test(source),
      `${secret} must never be placed in a returned detail field`
    );
  }
  assert.match(source, /state:\s*"unverified"/, "configured-but-unproven boundaries say so");
});

test("ownership transfer requires the owner's password again", () => {
  const source = stripComments(read("src/app/api/owner/transfer/route.ts"));
  assert.match(source, /requireOwner\(\)/);
  assert.match(source, /verifyPassword\(/);
  assert.match(source, /ownershipTransfers/);
  assert.match(source, /recordAudit\(/);
});
