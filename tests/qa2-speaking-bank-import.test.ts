import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
// @ts-expect-error plain .mjs script without types
import { assertWriteTarget, importRows, rowsFromBank, verify } from "../scripts/import-speaking-bank.mjs";

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
