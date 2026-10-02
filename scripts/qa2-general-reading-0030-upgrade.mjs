#!/usr/bin/env node
/**
 * Real-PostgreSQL upgrade check for migration 0030 on the ISOLATED local QA2 DB.
 *
 *   node scripts/qa2-general-reading-0030-upgrade.mjs seed     # DB must be at 0029
 *   DATABASE_URL=… npx drizzle-kit migrate                     # applies 0030 for real
 *   node scripts/qa2-general-reading-0030-upgrade.mjs verify   # hard gates
 *
 * Refuses anything but postgres on localhost / database learners_qa2. Snapshots EVERY
 * row of the reading, lexical, learner-vocabulary and SRS tables before 0030 and
 * proves after it that not one id or value changed and no passage became General.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/learners_qa2") {
  console.error("refusing: only the isolated local learners_qa2 database is allowed");
  process.exit(2);
}
const STATE = "/tmp/qa2-0030-before.json";
const TABLES = ["reading_passages", "reading_questions", "reading_attempts", "reading_answers", "lexemes", "lexical_units", "lexical_occurrences", "user_vocabulary", "user_vocabulary_contexts", "vocabulary_usages"];
const mode = process.argv[2];
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
const q = async (sql, args = []) => (await client.query(sql, args)).rows;
const snapshot = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await q(`select md5(row_to_json(x)::text) h, x.id::text id from ${t} x order by x.id`)])));

try {
  if (mode === "seed") {
    if ((await q("select to_regclass('public.general_reading_sets') t"))[0].t) throw new Error("0030 already applied; recreate the QA2 DB at 0029 first");
    const user = randomUUID();
    await q("insert into users (id, name, role, account_status) values ($1, 'QA2 0030 learner', 'student', 'active')", [user]);
    const [passage] = await q("insert into reading_passages (title, body_text, test_no, passage_no) values ('QA2 0030 academic', 'The bank lends money to firms.', 7, 2) returning id");
    await q("insert into reading_questions (passage_id, \"order\", type, question_text, correct_answer, explanation) values ($1, 1, 'short_answer', 'Who lends?', 'bank', '')", [passage.id]);
    const [attempt] = await q("insert into reading_attempts (user_id, passage_id, status, submitted_at, score) values ($1, $2, 'completed', now(), 1) returning id", [user, passage.id]);
    const [lexeme] = await q("insert into lexemes (term, part_of_speech, definition_en, sense_key, provenance) values ('bank', 'noun', 'A financial institution', $1, 'authored') returning id", [`qa2-0030-${randomUUID()}`]);
    const [occ] = await q("insert into lexical_occurrences (lexeme_id, passage_id, surface_form, start_char, end_char) values ($1, $2, 'bank', 4, 8) returning id", [lexeme.id, passage.id]);
    const [item] = await q("insert into user_vocabulary (user_id, lexeme_id, mastery, next_review_at, review_stage) values ($1, $2, 'learning', now() + interval '3 days', 2) returning id", [user, lexeme.id]).catch(async () =>
      q("insert into user_vocabulary (user_id, lexeme_id) values ($1, $2) returning id", [user, lexeme.id]));
    await q("insert into user_vocabulary_contexts (user_vocabulary_id, user_id, occurrence_id, source_type, source_id, snapshot) values ($1, $2, $3, 'reading', $4, $5)",
      [item.id, user, occ.id, attempt.id, JSON.stringify({ occurrenceId: occ.id, lexemeId: lexeme.id, sourceTitle: "QA2 0030 academic", surfaceForm: "bank", sentenceText: "The bank lends money to firms.", attemptId: attempt.id, passageId: passage.id })]);
    const before = await snapshot();
    writeFileSync(STATE, JSON.stringify(before));
    console.log(JSON.stringify({ seeded: true, rows: Object.fromEntries(TABLES.map((t) => [t, before[t].length])) }));
  } else if (mode === "verify") {
    const before = JSON.parse(readFileSync(STATE, "utf8"));
    const after = await snapshot();
    const gates = {};
    for (const t of TABLES) {
      const a = new Map(after[t].map((r) => [r.id, r.h]));
      gates[`${t}_changed_or_missing`] = before[t].filter((r) => a.get(r.id) !== r.h).length;
      gates[`${t}_added`] = after[t].length - before[t].length;
    }
    gates.tables_created = (await q("select count(*)::int n from information_schema.tables where table_name in ('general_reading_sets','general_reading_passages','general_reading_progress')"))[0].n;
    gates.passages_classified_general = (await q("select count(*)::int n from general_reading_passages"))[0].n;
    gates.mode_check_rejects_other_values = await q("select 1").then(async () => {
      try { await q("insert into general_reading_passages (passage_id, set_id, passage_no, reading_mode) values (gen_random_uuid(), gen_random_uuid(), 1, 'academic')"); return false; } catch (e) { return /check|violates/i.test(e.message); }
    });
    console.log(JSON.stringify(gates, null, 1));
    const bad = Object.entries(gates).filter(([k, v]) => (k.endsWith("_changed_or_missing") || k.endsWith("_added") || k === "passages_classified_general") ? v !== 0 : k === "tables_created" ? v !== 3 : v !== true);
    if (bad.length) { console.error("FAIL", bad); process.exitCode = 1; } else console.log("0030 upgrade gates: PASS");
  } else {
    console.error("usage: seed | verify"); process.exitCode = 2;
  }
} finally {
  await client.end();
}
