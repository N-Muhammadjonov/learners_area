#!/usr/bin/env node
/**
 * Real-PostgreSQL upgrade check for migration 0029 on the ISOLATED local QA2 DB.
 *
 *   node scripts/qa2-vocabulary-0029-upgrade.mjs seed     # DB must be at 0028
 *   DATABASE_URL=… npx drizzle-kit migrate                # applies 0029 for real
 *   node scripts/qa2-vocabulary-0029-upgrade.mjs verify   # hard gates
 *
 * Refuses anything but postgres on localhost / database learners_qa2. Seeds legacy
 * rows shaped like pre-0029 production data, snapshots EVERY lexeme, occurrence and
 * learner row, then after the migration prints the gate counters. Never prints secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/learners_qa2") {
  console.error("refusing: only the isolated local learners_qa2 database is allowed");
  process.exit(2);
}
const STATE = "/tmp/qa2-0029-before.json";
const mode = process.argv[2];
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
const q = async (sql, args = []) => (await client.query(sql, args)).rows;

try {
  if (mode === "seed") {
    const applied = await q("select count(*)::int n from drizzle.__drizzle_migrations");
    const hasUnits = await q("select 1 from information_schema.tables where table_name = 'lexical_units'");
    if (hasUnits.length) throw new Error("0029 already applied; recreate the QA2 DB at 0028 first");
    const users = [randomUUID(), randomUUID()];
    for (const [i, id] of users.entries()) await q("insert into users (id, name, role, account_status) values ($1, $2, 'student', 'active')", [id, `QA2 0029 legacy ${i}`]);
    const [passage] = await q("insert into reading_passages (title, body_text) values ('QA2 0029 legacy passage', 'The bank lends money. We sat on the bank of the river.') returning id");
    const tag = randomUUID().slice(0, 8);
    const lex = async (term, pos, def) => (await q("insert into lexemes (term, part_of_speech, definition_en, sense_key, provenance) values ($1, $2, $3, $4, 'derived') returning id", [term, pos, def, `qa2-0029-${tag}-${term}-${def.length}`]))[0].id;
    const money = await lex("bank", "n", "A financial institution");
    const river = await lex("bank", "n", "Land beside a river");
    const ozbek = await lex("o\u2019zbek", "(n.)", "Uzbek");
    const tia = await lex("take into account", "phrasal verb", "To consider");
    const occ = async (lexeme, start, end, sentence) => (await q("insert into lexical_occurrences (lexeme_id, passage_id, surface_form, start_char, end_char, sentence_text, occurrence_type, is_target_vocabulary) values ($1, $2, 'bank', $3, $4, $5, 'vocabulary', true) returning id", [lexeme, passage.id, start, end, sentence]))[0].id;
    const o1 = await occ(money, 4, 8, "The bank lends money.");
    const o2 = await occ(river, 37, 41, "We sat on the bank of the river.");
    const snap = (o, l, s) => JSON.stringify({ occurrenceId: o, lexemeId: l, sourceTitle: "QA2 0029 legacy passage", surfaceForm: "bank", sentenceText: s });
    await q("insert into user_vocabulary (user_id, lexeme_id, sense_key, source_type, source_snapshot, srs_stage, mastery) values ($1, $2, 'k1', 'reading', $3, 3, 'learning')", [users[0], money, snap(o1, money, "The bank lends money.")]);
    await q("insert into user_vocabulary (user_id, lexeme_id, sense_key, source_type, source_snapshot, srs_stage, mastery) values ($1, $2, 'k2', 'reading', $3, 1, 'new')", [users[1], river, snap(o2, river, "We sat on the bank of the river.")]);
    await q("insert into user_vocabulary (user_id, lexeme_id, sense_key, source_type, srs_stage, mastery) values ($1, $2, 'k3', 'manual', 0, 'new')", [users[1], ozbek]);
    await q("insert into user_vocabulary (user_id, lexeme_id, sense_key, source_type, srs_stage, mastery) values ($1, $2, 'k4', 'manual', 0, 'new')", [users[0], tia]);
    const before = {
      migrations: applied[0].n,
      lexemes: await q("select id, term, part_of_speech, definition_en, sense_key from lexemes order by id"),
      occurrences: await q("select id, lexeme_id, passage_id, start_char, end_char, surface_form from lexical_occurrences order by id"),
      userVocabulary: await q("select id, user_id, lexeme_id, sense_key, srs_stage, mastery, next_review_at, source_snapshot from user_vocabulary order by id"),
      usages: await q("select id from vocabulary_usages order by id"),
      withSnapshot: (await q("select count(*)::int n from user_vocabulary where source_snapshot ? 'occurrenceId'"))[0].n,
    };
    writeFileSync(STATE, JSON.stringify(before));
    console.log(JSON.stringify({ seeded: true, migrations: before.migrations, lexemes: before.lexemes.length, occurrences: before.occurrences.length, userVocabulary: before.userVocabulary.length }));
  } else if (mode === "verify") {
    const before = JSON.parse(readFileSync(STATE, "utf8"));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const lexemesNow = await q("select id, term, part_of_speech, definition_en, sense_key from lexemes order by id");
    const nowById = new Map(lexemesNow.map((r) => [r.id, r]));
    const changedIds = before.lexemes.filter((r) => !nowById.has(r.id) || !same(nowById.get(r.id), r)).length;
    const occNow = await q("select id, lexeme_id, passage_id, start_char, end_char, surface_form from lexical_occurrences where source_type = 'reading' order by id");
    const occById = new Map(occNow.map((r) => [r.id, r]));
    const brokenReading = before.occurrences.filter((r) => !occById.has(r.id) || !same(occById.get(r.id), r)).length
      + (await q("select count(*)::int n from lexical_occurrences where source_type = 'reading' and (resolution_status <> 'resolved' or lexeme_id is null or passage_id is null)"))[0].n;
    const uvNow = await q("select id, user_id, lexeme_id, sense_key, srs_stage, mastery, next_review_at, source_snapshot from user_vocabulary order by id");
    const uvById = new Map(uvNow.map((r) => [r.id, r]));
    const brokenUv = before.userVocabulary.filter((r) => !uvById.has(r.id) || !same(uvById.get(r.id), r)).length;
    const usagesNow = await q("select id from vocabulary_usages order by id");
    const lost = before.lexemes.length - before.lexemes.filter((r) => nowById.has(r.id)).length
      + before.userVocabulary.length - before.userVocabulary.filter((r) => uvById.has(r.id)).length
      + before.occurrences.length - before.occurrences.filter((r) => occById.has(r.id)).length
      + (same(usagesNow.map((r) => r.id).filter((id) => before.usages.some((u) => u.id === id)), before.usages.map((u) => u.id)) ? 0 : 1);
    const unlinked = (await q("select count(*)::int n from lexemes where lexical_unit_id is null"))[0].n;
    const contexts = (await q("select count(*)::int n from user_vocabulary_contexts"))[0].n;
    const bankUnits = (await q("select count(distinct lexical_unit_id)::int n from lexemes where term = 'bank'"))[0].n;
    const uniqueIndex = (await q("select count(*)::int n from pg_indexes where indexname = 'user_vocabulary_user_sense_idx'"))[0].n;
    const journal = (await q("select count(*)::int n from drizzle.__drizzle_migrations"))[0].n;
    const result = {
      MIGRATIONS_BEFORE: before.migrations, MIGRATIONS_AFTER: journal,
      EXISTING_LEXEME_IDS_CHANGED: changedIds, READING_OCCURRENCES_BROKEN: brokenReading,
      USER_VOCABULARY_OR_SRS_CHANGED: brokenUv, DESTRUCTIVE_DATA_LOSS: lost,
      LEXEMES_WITHOUT_UNIT: unlinked, CONTEXTS_BACKFILLED: contexts, CONTEXTS_EXPECTED: before.withSnapshot,
      BANK_SENSES_SHARE_ONE_UNIT: bankUnits === 1, USER_SENSE_UNIQUE_INDEX: uniqueIndex === 1,
    };
    console.log(JSON.stringify(result, null, 2));
    const ok = journal === before.migrations + 1 && changedIds === 0 && brokenReading === 0 && brokenUv === 0 && lost === 0 && unlinked === 0 && contexts === before.withSnapshot && bankUnits === 1 && uniqueIndex === 1;
    process.exitCode = ok ? 0 : 1;
  } else {
    console.error("usage: seed | verify");
    process.exitCode = 2;
  }
} finally {
  await client.end();
}
