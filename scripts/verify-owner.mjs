#!/usr/bin/env node
/**
 * Ownership safety, end to end, against a running app and the real database.
 *
 *   DATABASE_URL=... node scripts/verify-owner.mjs [baseUrl]
 *
 * What it proves:
 *   - the bootstrap command refuses to add a second owner to a centre that has one;
 *   - the generic role endpoint can never mint an owner;
 *   - the owner must re-authenticate to transfer, and the target must be active;
 *   - a transfer swaps both rows and is audited;
 *   - after the transfer the previous owner no longer holds ownership powers, and
 *     the new owner can hand it back;
 *   - the last live owner cannot be demoted or suspended, by anyone.
 *
 * It creates one throwaway account and removes it again.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";

const BASE = process.argv[2] ?? "http://127.0.0.1:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

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

class Client {
  constructor() {
    this.cookie = "";
  }
  async login(email, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 200, `login failed for ${email}: ${res.status}`);
    this.cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return this;
  }
  async request(pathname, { method = "GET", body } = {}) {
    const res = await fetch(`${BASE}${pathname}`, {
      method,
      redirect: "manual",
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, data };
  }
}

async function roleOf(email) {
  const { rows } = await pool.query("select id, role, account_status from users where email = $1", [email]);
  return rows[0];
}

console.log(`\nLearners Area — ownership safety against ${BASE}\n`);

const tempEmail = `owner.test.${Math.random().toString(16).slice(2, 10)}@learnersarea.uz`;
const ownerHash = (await roleOf("owner@learnersarea.uz")) && (await pool.query("select password_hash from users where email = $1", ["owner@learnersarea.uz"])).rows[0].password_hash;
const { rows: created } = await pool.query(
  `insert into users (email, name, role, account_status, password_hash, onboarding_completed_at)
   values ($1, 'Transfer Target', 'admin', 'active', $2, now()) returning id`,
  [tempEmail, ownerHash]
);
const tempId = created[0].id;

try {
  await check("the bootstrap command refuses a second owner", async () => {
    let failed = false;
    try {
      execFileSync("node", ["scripts/bootstrap-owner.mjs", "--email", tempEmail], {
        env: { ...process.env, OWNER_PASSWORD: "BootstrapTest123!" },
        stdio: "pipe",
      });
    } catch {
      failed = true;
    }
    assert.equal(failed, true, "bootstrap-owner must exit non-zero when an owner exists");
    assert.equal((await roleOf(tempEmail)).role, "admin", "the account must not have been promoted");
  });

  const owner = await new Client().login("owner@learnersarea.uz", "Owner12345!");

  await check("the generic role endpoint cannot mint an owner", async () => {
    const res = await owner.request(`/api/admin/users/${tempId}/role`, { method: "PATCH", body: { role: "owner" } });
    assert.equal(res.status, 409, `expected 409, got ${res.status}`);
    assert.equal(res.data.error, "owner_requires_transfer");
  });

  await check("an owner cannot change their own role", async () => {
    const me = await roleOf("owner@learnersarea.uz");
    const res = await owner.request(`/api/admin/users/${me.id}/role`, { method: "PATCH", body: { role: "admin" } });
    assert.equal(res.status, 409);
  });

  await check("an owner cannot be suspended through the status endpoint", async () => {
    const me = await roleOf("owner@learnersarea.uz");
    const res = await owner.request(`/api/admin/users/${me.id}/status`, {
      method: "POST",
      body: { status: "suspended", reason: "test" },
    });
    assert.ok(res.status === 403 || res.status === 409, `expected a refusal, got ${res.status}`);
    assert.equal((await roleOf("owner@learnersarea.uz")).account_status, "active");
  });

  await check("a transfer without the owner's password is refused", async () => {
    const res = await owner.request("/api/owner/transfer", {
      method: "POST",
      body: { email: tempEmail, password: "not-the-password", keepRole: "admin" },
    });
    assert.equal(res.status, 401);
  });

  await check("a transfer to a non-active account is refused", async () => {
    await pool.query("update users set account_status = 'suspended' where id = $1", [tempId]);
    const res = await owner.request("/api/owner/transfer", {
      method: "POST",
      body: { email: tempEmail, password: "Owner12345!", keepRole: "admin" },
    });
    assert.equal(res.status, 409, `expected 409, got ${res.status}`);
    await pool.query("update users set account_status = 'active' where id = $1", [tempId]);
  });

  await check("a real transfer swaps both rows, is recorded and is audited", async () => {
    const res = await owner.request("/api/owner/transfer", {
      method: "POST",
      body: { email: tempEmail, password: "Owner12345!", keepRole: "admin" },
    });
    assert.equal(res.status, 200, `transfer failed: ${res.status}`);

    assert.equal((await roleOf(tempEmail)).role, "owner");
    assert.equal((await roleOf("owner@learnersarea.uz")).role, "admin");

    const { rows: transfers } = await pool.query(
      "select from_user_id, to_user_id, previous_owner_role from ownership_transfers where to_user_id = $1",
      [tempId]
    );
    assert.equal(transfers.length, 1, "the transfer must be recorded");
    assert.equal(transfers[0].previous_owner_role, "admin");

    const { rows: audit } = await pool.query(
      "select action from audit_log where action = 'ownership.transferred' and target_id = $1",
      [tempId]
    );
    assert.ok(audit.length >= 1, "the transfer must be audited");
  });

  await check("the previous owner has no ownership powers afterwards", async () => {
    const res = await owner.request("/api/owner/transfer", {
      method: "POST",
      body: { email: "owner@learnersarea.uz", password: "Owner12345!", keepRole: "admin" },
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });

  await check("the new owner can hand ownership back", async () => {
    const next = await new Client().login(tempEmail, "Owner12345!");
    const res = await next.request("/api/owner/transfer", {
      method: "POST",
      body: { email: "owner@learnersarea.uz", password: "Owner12345!", keepRole: "admin" },
    });
    assert.equal(res.status, 200, `hand-back failed: ${res.status}`);
    assert.equal((await roleOf("owner@learnersarea.uz")).role, "owner");
    assert.equal((await roleOf(tempEmail)).role, "admin");
  });

  await check("the centre still has exactly the owners it should", async () => {
    const { rows } = await pool.query(
      "select count(*)::int as n from users where role = 'owner' and account_status = 'active'"
    );
    assert.equal(rows[0].n, 1, "one live owner after the round trip");
  });
} finally {
  await pool.query("delete from ownership_transfers where to_user_id = $1 or from_user_id = $1", [tempId]);
  await pool.query("delete from audit_log where target_id = $1 and action like 'owner.%'", [tempId]);
  await pool.query("delete from users where id = $1", [tempId]);
  await pool.end();
}

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
