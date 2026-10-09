#!/usr/bin/env node
/**
 * The admission decision is claimed, not read-then-written.
 *
 *   DATABASE_URL=... node scripts/verify-admission-race.mjs [baseUrl]
 *
 * Two administrators clicking "approve" at the same moment used to be able to
 * both pass the "is it still pending?" read and both write the decision, which
 * produced two notifications and two audit entries for one applicant. The
 * decision now claims the row with a conditional update, so exactly one caller
 * can win.
 *
 * This creates a throwaway applicant, fires two approvals in parallel, and
 * removes everything it created.
 */
import assert from "node:assert/strict";
import pg from "pg";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
// This probe writes fixtures. Refuse any database that is not disposable QA.
const { assertMutableDatabase: __assertMutableDb } = await import("./lib/fixture-safety.mjs");
__assertMutableDb(process.env.DATABASE_URL);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const EMAIL = "race.applicant@example.test";

let pass = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`ok   - ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`not ok - ${name}\n         ${String(error.message).slice(0, 300)}`);
  }
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `${email} kira olmadi: ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const adminCookie = await login("admin@learnersarea.uz", "Admin12345!");

// Throwaway applicant, request and a clean slate for the side effects we count.
await pool.query("delete from users where email = $1", [EMAIL]);
const { rows: user } = await pool.query(
  `insert into users (name, email, password_hash, role, account_status)
   values ('Race Applicant', $1, 'x', 'student', 'pending') returning id`,
  [EMAIL]
);
const applicantId = user[0].id;
const { rows: request } = await pool.query(
  `insert into access_requests (user_id, status, message) values ($1, 'pending', 'sinov') returning id`,
  [applicantId]
);
const requestId = request[0].id;

const decide = () =>
  fetch(`${BASE}/api/admin/admission/${requestId}/decide`, {
    method: "POST",
    headers: { cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });

try {
  const [first, second] = await Promise.all([decide(), decide()]);
  const codes = [first.status, second.status].sort();

  await check("ikki parallel qarordan faqat bittasi o'tadi", () => {
    assert.deepEqual(codes, [200, 409], `kodlar: ${codes.join(", ")}`);
  });

  await check("so'rovda bitta holat qoladi", async () => {
    const { rows } = await pool.query("select status, count(*)::int as c from access_requests where id = $1 group by status", [
      requestId,
    ]);
    assert.equal(rows.length, 1, "bir nechta holat yozuvi");
    assert.equal(rows[0].status, "approved");
    assert.equal(rows[0].c, 1);
  });

  await check("bitta audit yozuvi yoziladi", async () => {
    const { rows } = await pool.query(
      "select count(*)::int as c from audit_log where action = 'access.approved' and target_id = $1",
      [applicantId]
    );
    assert.equal(rows[0].c, 1, `audit yozuvlari: ${rows[0].c}`);
  });

  await check("bitta xabarnoma yuboriladi", async () => {
    const { rows } = await pool.query(
      "select count(*)::int as c from notifications where user_id = $1 and type = 'ACCESS_APPROVED'",
      [applicantId]
    );
    assert.equal(rows[0].c, 1, `xabarnomalar: ${rows[0].c}`);
  });

  await check("hisob ACTIVE bo'ladi", async () => {
    const { rows } = await pool.query("select account_status from users where id = $1", [applicantId]);
    assert.equal(rows[0].account_status, "active");
  });

  await check("qarordan keyin yana urinish 409 oladi", async () => {
    const third = await decide();
    assert.equal(third.status, 409, `kod: ${third.status}`);
  });
} finally {
  await pool.query("delete from access_requests where user_id = $1", [applicantId]);
  await pool.query("delete from notifications where user_id = $1", [applicantId]);
  await pool.query("delete from audit_log where target_id = $1", [applicantId]);
  await pool.query("delete from users where id = $1", [applicantId]);
  await pool.end();
}

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
