#!/usr/bin/env node
/**
 * End-to-end test of the private-centre access model, over real HTTP.
 *
 * What this proves, in order, against a running server and a real database:
 *
 *   1. an anonymous visitor reaches nothing private;
 *   2. registration creates a PENDING account, which can sign in but can only
 *      see the waiting room — and cannot call a single private API;
 *   3. the applicant can ask for access, but cannot approve themselves;
 *   4. an administrator (not a teacher, not the applicant) approves it, and the
 *      same cookie that was blocked a moment ago now works;
 *   5. suspending the account takes effect on the next request, with the old
 *      cookie still in hand;
 *   6. the role ladder is enforced: an admin cannot touch the owner, cannot
 *      change their own role and cannot mint another owner;
 *   7. the owner console answers, the retention job previews without deleting,
 *      and no secret value is ever rendered.
 *
 *   node scripts/verify-access.mjs [baseUrl]
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    const raw = String(err.message);
    const message = raw.length > 500 ? `${raw.slice(0, 500)}… [truncated]` : raw;
    failures.push({ name, err: new Error(message) });
    console.log(`  FAIL ${name}\n         ${message}`);
  }
}

/** Fire-and-forget cookie merge (later Set-Cookie values win). */
function mergeCookies(...jars) {
  const map = new Map();
  for (const jar of jars) {
    for (const pair of String(jar ?? "").split("; ").filter(Boolean)) {
      const [key, ...rest] = pair.split("=");
      map.set(key, rest.join("="));
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `login failed for ${email} (${res.status})`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function get(cookie, pathname) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
  return {
    status: res.status,
    html: await res.text(),
    location: res.headers.get("location"),
  };
}

async function api(cookie, pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML error page — keep the raw text for the failure message */
  }
  const setCookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, json, text, setCookie, location: res.headers.get("location") };
}

const ownerCookie = await login("owner@learnersarea.uz", "Owner12345!");
const adminCookie = await login("admin@learnersarea.uz", "Admin12345!");
const teacherCookie = await login("teacher@learnersarea.uz", "Teacher12345!");

const applicantEmail = `access.test.${randomUUID().slice(0, 8)}@learnersarea.uz`;
const applicantPassword = "Applicant12345!";
let applicantCookie = null;
let applicantId = null;

console.log(`\nLearners Area — access & admission end-to-end against ${BASE}\n`);

// ---------------------------------------------------------------------------
// 1. Anonymous
// ---------------------------------------------------------------------------

await check("an anonymous visitor is redirected from a private page to login", async () => {
  const res = await get(null, "/app/dashboard");
  assert.equal(res.status, 307);
  assert.match(res.location ?? "", /\/login/);
});

await check("a private API answers 401 when anonymous", async () => {
  const res = await api(null, "/api/assignments");
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// 2. Registration → PENDING
// ---------------------------------------------------------------------------

await check("registration creates a PENDING account and signs it in", async () => {
  const res = await api(null, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Access Test Applicant",
      email: applicantEmail,
      password: applicantPassword,
    }),
  });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  applicantCookie = res.setCookie;
  assert.ok(applicantCookie.includes("la_session"), "registration must set the session cookie");
});

await check("a PENDING account is sent to the waiting room, not to the dashboard", async () => {
  const res = await get(applicantCookie, "/app/dashboard");
  assert.equal(res.status, 307);
  assert.match(res.location ?? "", /\/pending/);
});

await check("a PENDING account is redirected away from staff pages to the waiting room", async () => {
  const res = await get(applicantCookie, "/app/teacher/students");
  assert.equal(res.status, 307);
  assert.match(res.location ?? "", /\/pending/);
});

await check("a PENDING account cannot call a private API with its valid cookie", async () => {
  const res = await api(applicantCookie, "/api/assignments");
  assert.equal(res.status, 401, `expected 401, got ${res.status}: ${res.text.slice(0, 200)}`);
});

await check("the waiting room renders the pending state, not private content", async () => {
  const res = await get(applicantCookie, "/pending");
  assert.equal(res.status, 200);
  assert.match(res.html, /data-account-status="pending"/);
  assert.ok(!res.html.includes("data-person-id"), "the waiting room must not render admin data");
});

// ---------------------------------------------------------------------------
// 3. Access request
// ---------------------------------------------------------------------------

let requestId = null;

await check("the applicant can file an access request", async () => {
  const res = await api(applicantCookie, "/api/admission/request", {
    method: "POST",
    body: JSON.stringify({ message: "I would like to join the centre." }),
  });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.equal(res.json?.ok, true);
  assert.ok(res.json?.requestId, "the request id must be returned");
  requestId = res.json.requestId;
});

await check("filing the same request twice is idempotent", async () => {
  const res = await api(applicantCookie, "/api/admission/request", { method: "POST", body: "{}" });
  assert.equal(res.status, 200);
  assert.equal(res.json?.alreadyOpen, true);
  assert.equal(res.json?.requestId, requestId);
});

await check("the owners and admins see the request in the queue", async () => {
  for (const cookie of [adminCookie, ownerCookie]) {
    const res = await get(cookie, "/app/admin/admissions");
    assert.equal(res.status, 200);
    assert.ok(
      res.html.includes(applicantEmail),
      "the queue must show the applicant"
    );
  }
});

await check("a teacher cannot open the admission queue", async () => {
  const res = await get(teacherCookie, "/app/admin/admissions");
  assert.ok([307, 404].includes(res.status), `expected a redirect/404, got ${res.status}`);
});

await check("a teacher cannot open administrator pages", async () => {
  for (const path of ["/app/admin/reading", "/app/admin/grammar", "/app/admin/writing-prompts"]) {
    const res = await get(teacherCookie, path);
    assert.equal(res.status, 307, `${path} must redirect a teacher (got ${res.status})`);
    assert.match(res.location ?? "", /\/dashboard/);
  }
});

await check("the applicant cannot approve their own request", async () => {
  const res = await api(applicantCookie, `/api/admin/admission/${requestId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve" }),
  });
  assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);

  // …and the account really is still pending.
  const stillPending = await api(applicantCookie, "/api/assignments");
  assert.equal(stillPending.status, 401);
});

await check("a teacher cannot decide an admission", async () => {
  const res = await api(teacherCookie, `/api/admin/admission/${requestId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve" }),
  });
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// 4. Approval opens the door
// ---------------------------------------------------------------------------

await check("an administrator approves the request and the account becomes ACTIVE", async () => {
  const res = await api(adminCookie, `/api/admin/admission/${requestId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve", note: "Verified in the access test." }),
  });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.equal(res.json?.status, "active");
  // The decision names the applicant it affected, so the test never has to guess
  // an id out of rendered HTML — and no other account can be touched by mistake.
  applicantId = res.json?.userId;
  assert.ok(applicantId, "the decision must report the applicant it affected");
});

await check("the same cookie that was blocked now reaches the dashboard and the APIs", async () => {
  const page = await get(applicantCookie, "/app/dashboard");
  assert.equal(page.status, 200, `expected 200, got ${page.status}`);

  const priv = await api(applicantCookie, "/api/assignments");
  assert.equal(priv.status, 200, `expected 200, got ${priv.status}`);
});

await check("the applicant was notified in-app", async () => {
  const res = await api(applicantCookie, "/api/notifications");
  assert.equal(res.status, 200);
  const rows = res.json?.notifications ?? [];
  assert.ok(rows.length > 0, "an approval must notify the applicant");
  assert.ok(rows.some((n) => n.type === "ACCESS_APPROVED"), "notification type mismatch");
});

// ---------------------------------------------------------------------------
// 5. Suspension is immediate
// ---------------------------------------------------------------------------

await check("the approved applicant is listed as an active student", async () => {
  const people = await get(adminCookie, "/app/admin/people");
  assert.equal(people.status, 200);
  const row = people.html.match(
    new RegExp(`data-person-id="${applicantId}"[^>]*data-person-role="student"[^>]*data-person-status="active"`)
  );
  assert.ok(row, "the people page must show the applicant as an active student");
});

await check("suspension revokes access on the very next request, old cookie and all", async () => {
  const suspend = await api(adminCookie, `/api/admin/users/${applicantId}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "suspended", reason: "access test" }),
  });
  assert.equal(suspend.status, 200, suspend.text.slice(0, 200));

  const page = await get(applicantCookie, "/app/dashboard");
  assert.equal(page.status, 307);
  assert.match(page.location ?? "", /\/pending/);

  const priv = await api(applicantCookie, "/api/assignments");
  assert.equal(priv.status, 401, "a suspended account must lose its APIs immediately");
});

await check("a suspended account cannot ask for access again", async () => {
  const res = await api(applicantCookie, "/api/admission/request", { method: "POST", body: "{}" });
  assert.equal(res.status, 409);
  assert.equal(res.json?.error, "not_eligible");
});

await check("reactivating the account restores access", async () => {
  const res = await api(adminCookie, `/api/admin/users/${applicantId}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(res.status, 200);
  const priv = await api(applicantCookie, "/api/assignments");
  assert.equal(priv.status, 200);
});

await check("a student cannot open staff or administrator pages", async () => {
  for (const path of ["/app/teacher/students", "/app/teacher/live-classes", "/app/admin/reading", "/app/admin/people"]) {
    const res = await get(applicantCookie, path);
    assert.equal(res.status, 307, `${path} must redirect a student (got ${res.status})`);
    assert.match(res.location ?? "", /\/dashboard/);
  }
});

// ---------------------------------------------------------------------------
// 6. Role ladder
// ---------------------------------------------------------------------------

await check("an admin cannot suspend the owner", async () => {
  const people = await get(adminCookie, "/app/admin/people");
  const ownerId = people.html.match(/data-person-id="([0-9a-f-]{36})"[^>]*data-person-role="owner"/)?.[1];
  assert.ok(ownerId, "the owner must be listed");
  const res = await api(adminCookie, `/api/admin/users/${ownerId}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "suspended", reason: "should not work" }),
  });
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  const stillOwner = await api(ownerCookie, "/api/assignments");
  assert.equal(stillOwner.status, 200, "the owner must still be active");
});

await check("an admin cannot change their own role", async () => {
  const people = await get(adminCookie, "/app/admin/people");
  const adminId = people.html.match(/data-person-id="([0-9a-f-]{36})"[^>]*data-person-role="admin"/)?.[1];
  assert.ok(adminId, "the admin must be listed");
  const res = await api(adminCookie, `/api/admin/users/${adminId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role: "student" }),
  });
  assert.equal(res.status, 409);
  assert.equal(res.json?.error, "cannot_change_own_role");
});

await check("an admin cannot mint another owner", async () => {
  const res = await api(adminCookie, `/api/admin/users/${applicantId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role: "owner" }),
  });
  assert.equal(res.status, 409, `expected 409, got ${res.status}`);
  assert.equal(res.json?.error, "owner_requires_transfer");
});

await check("the owner can grant a role, and the change follows the account immediately", async () => {
  const up = await api(ownerCookie, `/api/admin/users/${applicantId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role: "teacher" }),
  });
  assert.equal(up.status, 200, up.text.slice(0, 200));

  // The old cookie now reaches teacher-only pages, because the role is read from
  // the database on every request.
  const teacherPage = await get(applicantCookie, "/app/teacher/students");
  assert.equal(teacherPage.status, 200, `expected 200, got ${teacherPage.status}`);

  const down = await api(ownerCookie, `/api/admin/users/${applicantId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role: "student" }),
  });
  assert.equal(down.status, 200);
  const after = await get(applicantCookie, "/app/teacher/students");
  assert.ok([307, 404].includes(after.status), "a demoted account must lose the teacher shell");
});

// ---------------------------------------------------------------------------
// 7. Owner console, retention, secrets
// ---------------------------------------------------------------------------

await check("the owner console is reachable by the owner and by nobody else", async () => {
  const owner = await get(ownerCookie, "/app/owner");
  assert.equal(owner.status, 200);

  const admin = await get(adminCookie, "/app/owner");
  assert.ok([307, 404].includes(admin.status), `admin must not open /owner (got ${admin.status})`);

  const student = await get(applicantCookie, "/app/owner");
  assert.ok([307, 404].includes(student.status), `student must not open /owner (got ${student.status})`);
});

await check("the retention job previews without deleting, twice in a row", async () => {
  const first = await api(ownerCookie, "/api/owner/retention", {
    method: "POST",
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(first.status, 200, first.text.slice(0, 200));
  assert.equal(first.json?.dryRun, true);
  const rules = first.json?.results ?? [];
  assert.ok(rules.some((r) => r.rule === "inactive_student_accounts"), "the student rule must be reported");
  assert.ok(
    rules.every((r) => r.applied === false),
    "a dry run must not apply anything"
  );

  const second = await api(ownerCookie, "/api/owner/retention", {
    method: "POST",
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(second.status, 200);
  assert.deepEqual(
    second.json?.results?.map((r) => r.affected),
    rules.map((r) => r.affected),
    "a dry run must be repeatable"
  );
});

await check("a student cannot run the retention job", async () => {
  const res = await api(applicantCookie, "/api/owner/retention", {
    method: "POST",
    body: JSON.stringify({ dryRun: false }),
  });
  assert.equal(res.status, 403);
});

await check("the integration page states limits truthfully", async () => {
  const res = await get(ownerCookie, "/app/owner/integrations");
  assert.equal(res.status, 200);
  assert.match(res.html, /data-integration="database"[^>]*data-state="connected"/);
  assert.match(res.html, /data-integration="storage"[^>]*data-state="(connected|unverified)"/);
  assert.match(res.html, /data-integration="external_ai"[^>]*data-state="(not_configured|unverified)"/);
  assert.match(res.html, /data-integration="speech_to_text"[^>]*data-state="not_configured"/);
});

await check("no secret value is rendered anywhere in the owner area", async () => {
  const secrets = [
    process.env.AUTH_SECRET,
    process.env.DATABASE_URL,
    process.env.R2_SECRET_ACCESS_KEY,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.AI_PROVIDER_API_KEY,
  ].filter((value) => typeof value === "string" && value.length > 8);

  const pages = ["/app/owner", "/app/owner/integrations", "/app/owner/retention", "/app/owner/audit", "/app/owner/transfer"];
  for (const path of pages) {
    const res = await get(ownerCookie, path);
    assert.equal(res.status, 200, `${path} must render`);
    for (const secret of secrets) {
      assert.ok(!res.html.includes(secret), `${path} leaked a configured secret value`);
    }
    assert.ok(!/postgres:\/\/[^\s"<]+/.test(res.html), `${path} leaked a database URL`);
  }
});

await check("the audit trail records the decisions that were made", async () => {
  const res = await get(ownerCookie, "/app/owner/audit");
  assert.equal(res.status, 200);
  for (const action of ["access.approved", "account.suspended", "role.changed"]) {
    assert.ok(res.html.includes(`data-audit-action="${action}"`), `audit is missing ${action}`);
  }
});

// ---------------------------------------------------------------------------
// 8. Theme and brand
// ---------------------------------------------------------------------------

await check("night mode is server-rendered, so the theme never flashes", async () => {
  const res = await fetch(`${BASE}/api/theme`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ theme: "night" }),
  });
  assert.equal(res.status, 200);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const merged = mergeCookies(ownerCookie, cookie);

  const page = await get(merged, "/app/dashboard");
  assert.equal(page.status, 200);
  assert.match(page.html, /data-theme="night"/);

  const back = await fetch(`${BASE}/api/theme`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: merged },
    body: JSON.stringify({ theme: "day" }),
  });
  assert.equal(back.status, 200);
  const dayJar = mergeCookies(
    merged,
    (back.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ")
  );
  const day = await get(dayJar, "/app/dashboard");
  assert.match(day.html, /data-theme="day"/, "the theme must persist back to Day Mode too");
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
