#!/usr/bin/env node
// Idempotent fixtures for the isolated real-PostgreSQL QA database.
// Creates exactly one active owner and one active student with reserved
// `.invalid` addresses (RFC 2606: can never be a real mailbox). Refuses any
// target that is not localhost/learners_qa2 — never Preview, never Production.
import pg from "pg";

export const QA_FIXTURES = [
  { email: "qa2-owner@learners-qa.invalid", name: "QA2 Owner", role: "owner", isOwner: true },
  { email: "qa2-student@learners-qa.invalid", name: "QA2 Student", role: "student", isOwner: false },
];

export function assertIsolatedTarget(url) {
  let parsed;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new Error("refusing: DATABASE_URL is missing or invalid");
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  if (!local || parsed.pathname !== "/learners_qa2") {
    throw new Error(`refusing: QA fixtures only target localhost/learners_qa2 (got ${parsed.hostname}${parsed.pathname})`);
  }
  return true;
}

export async function seedFixtures(client) {
  const out = [];
  for (const f of QA_FIXTURES) {
    const { rows } = await client.query(
      `insert into users (name, email, role, is_owner, account_status)
       values ($1, $2, $3, $4, 'active')
       on conflict (email) do update set role = excluded.role, is_owner = excluded.is_owner, account_status = 'active'
       returning id, role`,
      [f.name, f.email, f.role, f.isOwner],
    );
    out.push(rows[0]);
  }
  const { rows } = await client.query(
    "select count(*)::int as n from users where role = 'owner' and account_status = 'active'",
  );
  if (rows[0].n < 1) throw new Error("fixture invariant failed: no active owner");
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertIsolatedTarget(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const rows = await seedFixtures(client);
    console.log(`fixtures ok: ${rows.map((r) => r.role).join(", ")}`);
  } finally {
    await client.end();
  }
}
