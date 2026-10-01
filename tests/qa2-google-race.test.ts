import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test("QA2 real PostgreSQL: parallel Google callbacks for one new identity create exactly one pending account", {
  skip: process.env.QA2_DATABASE_TESTS !== "1" && "set QA2_DATABASE_TESTS=1 with an isolated QA database",
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2", "isolated QA database only");
  const { db } = await import("../src/db/client");
  const { resolveGoogleAccount } = await import("../src/lib/auth/google-account");
  const sub = `g-race-${randomUUID()}`;
  const email = `Race.${randomUUID()}@Example.test`;
  const results = await Promise.all(Array.from({ length: 8 }, () => resolveGoogleAccount({ sub, email, emailVerified: true, name: "Race" }, { locale: "en" }, db)));
  assert.ok(results.every((r) => r.kind === "signed_in"), JSON.stringify(results.map((r) => r.kind)));
  assert.equal(results.filter((r) => r.kind === "signed_in" && r.created).length, 1);
  const rows = await db.execute<{ n: number; status: string }>(`select count(*)::int n, max(account_status) status from users where google_sub = '${sub}'` as never);
  const row = (rows as unknown as { rows: Array<{ n: number; status: string }> }).rows[0]!;
  assert.equal(row.n, 1); assert.equal(row.status, "pending");
  await db.execute(`delete from users where google_sub = '${sub}'` as never);
});
