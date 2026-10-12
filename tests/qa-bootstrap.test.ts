// QA reproducibility: fixture guard refuses non-isolated targets; seeding is idempotent.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs script without types
import { assertIsolatedTarget, QA_FIXTURES, seedFixtures } from "../scripts/qa2-seed-fixtures.mjs";

test("QB1 guard accepts only localhost/learners_qa2", () => {
  assert.equal(assertIsolatedTarget("postgres://postgres@localhost:5432/learners_qa2"), true);
  assert.equal(assertIsolatedTarget("postgres://postgres@127.0.0.1:5432/learners_qa2"), true);
  for (const bad of ["postgres://u@db.prod.example.com/learners_qa2", "postgres://u@localhost/learners", "postgres://u@localhost/postgres", "", undefined, "not a url"]) {
    assert.throws(() => assertIsolatedTarget(bad), /refusing/, String(bad));
  }
});

test("QB2 fixtures are reserved .invalid identities with exactly one owner", () => {
  assert.ok(QA_FIXTURES.every((f: { email: string }) => f.email.endsWith(".invalid")));
  assert.equal(QA_FIXTURES.filter((f: { role: string }) => f.role === "owner").length, 1);
});

test("QB3 seeding upserts (idempotent) and enforces the active-owner invariant", async () => {
  const sql: string[] = [];
  const fake = { query: async (q: string) => { sql.push(q); return { rows: q.includes("count(*)") ? [{ n: 1 }] : [{ id: "x", role: "owner" }] }; } };
  await seedFixtures(fake);
  await seedFixtures(fake);
  assert.ok(sql.filter((q) => q.includes("insert into users")).every((q) => /on conflict \(email\) do update/.test(q)));
  const empty = { query: async (q: string) => ({ rows: q.includes("count(*)") ? [{ n: 0 }] : [{}] }) };
  await assert.rejects(seedFixtures(empty), /no active owner/);
});

test("QB4 one canonical UI command carries the UI tsconfig; gate pins the speaking bank checksum", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts["test:ui"], /TSX_TSCONFIG_PATH=tests\/ui\/tsconfig\.json/);
  assert.ok(pkg.scripts["qa:gate"] && pkg.scripts["qa:pg"]);
  const gate = readFileSync("scripts/qa-forensic-gate.sh", "utf8");
  assert.match(gate, /c12456756c73fe8ba7ee9e414e43c83ecc1c5e3a21b206e769c64f01e560b4b9/);
  assert.doesNotMatch(readFileSync("scripts/qa2-local-postgres.sh", "utf8"), /insert one active owner/);
});
