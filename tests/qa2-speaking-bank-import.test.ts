import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
// @ts-expect-error plain .mjs script without types
import { assertWriteTarget, importReceipt, importRows, publicationCounts, rowsFromBank, verify } from "../scripts/import-speaking-bank.mjs";

import { after, before } from "node:test";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";

/*
 * Fixtures this file creates are removed when it finishes, exception-safely, and only rows that did
 * not exist when it started can be removed — so seeded records are unreachable by construction.
 * The QA2 database is shared by every gated file, so one file’s leftovers change what the next one
 * observes; this is what makes two consecutive runs against the same database meaningful.
 */
const QA2_RESIDUE_GUARD = process.env.QA2_DATABASE_TESTS === "1";
let qa2ResidueGuard: ResidueGuard | null = null;
before(async () => {
  if (!QA2_RESIDUE_GUARD) return;
  qa2ResidueGuard = await createResidueGuard("qa2-speaking-bank-import");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("qa2-speaking-bank-import", qa2ResidueGuard);
  qa2ResidueGuard = null;
});

test("write-target guard: only localhost/learners_qa2 unless the exact database is confirmed", () => {
  assert.equal(assertWriteTarget("postgres://p@localhost:5432/learners_qa2", {}), "learners_qa2");
  assert.throws(() => assertWriteTarget("postgres://p@prod.example.com/learners", {}), /refusing/);
  assert.throws(() => assertWriteTarget("postgres://p@localhost/learners", {}), /refusing/);
  assert.throws(() => assertWriteTarget("postgres://p@prod.example.com/learners", { SPEAKING_IMPORT_CONFIRM_DATABASE: "other" }), /refusing/);
});

const source = process.env.SPEAKING_BANK_SOURCE;
test("QA2 real PostgreSQL: re-import is a no-op and never disturbs an attempt's prompt", {
  skip: (process.env.QA2_DATABASE_TESTS !== "1" || !source) && "set QA2_DATABASE_TESTS=1 and SPEAKING_BANK_SOURCE=<bank.jsonl>",
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const rows = rowsFromBank(readFileSync(source!, "utf8"));
    await importRows(pool, rows);
    const { rows: [prompt] } = await pool.query("select id, prompt_text from speaking_prompts where external_id = 'P2-001'");
    const userId = randomUUID();
    await pool.query("insert into users (id, name, role, account_status, email) values ($1, 'QA2 speaker', 'student', 'active', $2)", [userId, `qa2.${userId}@example.test`]);
    const { rows: [attempt] } = await pool.query("insert into speaking_attempts (user_id, prompt_id, part) values ($1, $2, 'part2') returning id", [userId, prompt.id]);
    const again = await importRows(pool, rows);
    assert.deepEqual(again, { inserted: 0, skippedExisting: 880 });
    const counts = await verify(pool);
    assert.deepEqual(counts, { part1: { rows: 285, uniqueIds: 285 }, part2: { rows: 85, uniqueIds: 85 }, part3: { rows: 510, uniqueIds: 510 } });
    const { rows: [after] } = await pool.query("select a.prompt_id, p.prompt_text from speaking_attempts a join speaking_prompts p on p.id = a.prompt_id where a.id = $1", [attempt.id]);
    assert.equal(after.prompt_id, prompt.id);
    assert.equal(after.prompt_text, prompt.prompt_text);
    const { rows: [state] } = await pool.query("select count(*)::int as n from speaking_prompts where external_id is not null and publication_state <> 'draft'");
    assert.equal(state.n, 0, "imported rows stay draft until the owner publishes");
    await pool.query("delete from users where id = $1", [userId]);
  } finally { await pool.end(); }
});

test("N11 receipt: source hash and database name only — never a URL or password", () => {
  const r = importReceipt({ text: '{"id":"P1-001"}\n{"id":"P1-002"}\n', database: "learners_qa2", result: { inserted: 2, skippedExisting: 0 }, byPart: {}, publication: { draft: 2, notDraft: 0 }, at: "2026-10-01T00:00:00.000Z" });
  assert.equal(r.source.rows, 2);
  assert.match(r.source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.database, "learners_qa2");
  assert.ok(!JSON.stringify(r).includes("postgres://"));
});

test("QA2 real PostgreSQL: imported drafts are invisible to Practice and Live Partner until published", {
  skip: (process.env.QA2_DATABASE_TESTS !== "1" || !source) && "set QA2_DATABASE_TESTS=1 and SPEAKING_BANK_SOURCE=<bank.jsonl>",
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const { listActivePrompts, listLivePartnerQuestions } = await import("../src/lib/data/speaking-practice");
  try {
    await importRows(pool, rowsFromBank(readFileSync(source!, "utf8")));
    assert.deepEqual(await publicationCounts(pool), { draft: 880, notDraft: 0 });
    const imported = new Set((await pool.query("select id from speaking_prompts where external_id is not null")).rows.map((r) => r.id));
    assert.equal((await listActivePrompts()).filter((p) => imported.has(p.id)).length, 0, "no imported draft reaches Practice");
    assert.equal((await listLivePartnerQuestions()).questions.filter((p) => imported.has(p.id)).length, 0, "no imported draft reaches Live Partner");
    // Publishing is an explicit owner action; simulate it for ONE row on the isolated QA DB, then restore.
    const { rows: [one] } = await pool.query("select id from speaking_prompts where external_id = 'P1-001'");
    await pool.query("update speaking_prompts set publication_state = 'published' where id = $1", [one.id]);
    try {
      assert.ok((await listActivePrompts()).some((p) => p.id === one.id), "a published row becomes visible");
      const again = await importRows(pool, rowsFromBank(readFileSync(source!, "utf8")));
      assert.equal(again.inserted, 0);
      const { rows: [still] } = await pool.query("select publication_state from speaking_prompts where id = $1", [one.id]);
      assert.equal(still.publication_state, "published", "re-import never reverts or overwrites an owner decision");
    } finally {
      await pool.query("update speaking_prompts set publication_state = 'draft' where id = $1", [one.id]);
    }
  } finally { await pool.end(); }
});
