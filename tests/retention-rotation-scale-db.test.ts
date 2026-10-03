// Retention rotation pool past 1 000 texts (§25 follow-up, 2026-10-03).
// listActiveCandidates used `.limit(1000)` ordered by sequence: in a level with more
// than 1 000 active texts the highest-sequence ones were never assignable, and the
// cycle "completed" without them. The pool must be complete; it is level-scoped,
// index-backed and two uuids per row.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { listActiveCandidates } from "../src/lib/data/retention-bank";
import { selectNextText } from "../src/lib/retention/rotation";
import { createTestDatabase, simpleStructure, type TestDatabase } from "./support/pglite";

let database: TestDatabase;
const N = 1005;

before(async () => {
  database = await createTestDatabase();
  const structure = JSON.stringify(simpleStructure("scale"));
  await database.query(`insert into retention_texts (level, internal_label, sequence, active)
     select 'C2', 'C2-' || lpad(g::text, 4, '0'), g, true from generate_series(1, ${N}) g`);
  await database.query(
    `insert into retention_text_versions (retention_text_id, version_number, body_text, word_count, scoring_structure)
     select id, 1, 'body', 1, $1::jsonb from retention_texts where level = 'C2'`,
    [structure]
  );
  await database.query(`update retention_texts r set current_version_id = v.id from retention_text_versions v where v.retention_text_id = r.id`);
  // An archived text and one without a current version must stay out of the pool.
  await database.query(`insert into retention_texts (level, internal_label, sequence, active) values ('C2', 'C2-9001', 9001, false), ('C2', 'C2-9002', 9002, true)`);
});

after(async () => {
  await database.close();
});

test("RS1 every active, versioned text of a level is a candidate past 1 000 (no silent cap)", async () => {
  const pool = await listActiveCandidates("C2", database.db);
  assert.equal(pool.length, N);
  assert.equal(new Set(pool.map((c) => c.textId)).size, N, "no duplicates");
  const [last] = await database.query<{ id: string }>(`select id from retention_texts where sequence = ${N}`);
  assert.ok(pool.some((c) => c.textId === last!.id), "the highest-sequence text is reachable");
});

test("RS2 after 1 000 completions the cycle continues with the remaining texts, not a reset", async () => {
  const pool = await listActiveCandidates("C2", database.db);
  const done = pool.slice(0, 1000).map((c) => c.textId);
  const remaining = new Set(pool.slice(1000).map((c) => c.textId));
  for (let i = 0; i < 20; i += 1) {
    const d = selectNextText({ candidates: pool, completedTextIds: done, cycleNumber: 1, lastCompletedTextId: done.at(-1)!, random: Math.random });
    assert.ok(d && remaining.has(d.textId), "picks one of the 5 unseen texts");
    assert.equal(d!.cycleNumber, 1, "same cycle");
  }
});
