import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import { formsOf } from "../src/lib/services/lexical/forms";
import { exampleMatchesSentence, findUnitSpans, ingestListeningOccurrences, listeningOccurrenceSpans } from "../src/lib/services/lexical/listening-occurrences";
import { ensureLexicalUnit, unitIdentity, unitsForSurface } from "../src/lib/services/lexical/units";
import { sourceRevisitHref } from "../src/lib/services/lexical/context";
import { normalizeTerm } from "../src/lib/services/vocabulary/dedupe";
import { searchRows } from "../src/lib/services/vocabulary/search";
import { APOSTROPHE_VARIANTS, foldApostrophes, isFunctionWord, normalizeLexical } from "../src/lib/text/lexical-normalize";
import uz from "../src/lib/i18n/uz";

/**
 * Vocabulary architecture (migration 0029) — semantic tests that run on every
 * `npm test`: pure functions and an in-process PostgreSQL (PGlite) with the real
 * migration chain. Tests that need the application's global connection pool,
 * real row locks or a pre-0029 database live in vocabulary-architecture-qa2.test.ts.
 */

type Db = Awaited<ReturnType<typeof createTestDatabase>>;
type Vocab = Parameters<typeof ingestListeningOccurrences>[2]["vocabulary"][number];
const entry = (word: string, pos: string, def: string, ex: string, uzText = ""): Vocab => ({ word, pos, def, ex, uz: uzText, also: [], quiz: [] as unknown as Vocab["quiz"] });

async function listeningTest(d: Db) {
  const userId = randomUUID();
  await d.query("insert into users (id, name, role, account_status) values ($1, 'QA author', 'admin', 'active')", [userId]);
  const [row] = await d.query<{ id: string }>("insert into listening_tests (created_by_user_id, title, audio_type) values ($1, 'QA listening', 'audio') returning id", [userId]);
  return row!.id;
}

// 5, 6 ---------------------------------------------------------------------
test("5 run/runs/running/ran are forms of ONE verb unit; the surface form is preserved", async () => {
  assert.deepEqual(formsOf("run", "verb").map((f) => [f.form, f.formType]), [["run", "lemma"], ["runs", "regular"], ["running", "regular"], ["ran", "irregular"]]);
  const d = await createTestDatabase();
  try {
    const testId = await listeningTest(d);
    const text = "She runs every day. He ran yesterday. Running is fun. They run.";
    const result = await ingestListeningOccurrences(d.db, testId, { testId: "qa", sections: [{ number: 1, title: "s", transcript: text }] as never, vocabulary: [entry("run", "verb", "To move fast on foot", text)] });
    assert.equal(result.resolved, 4);
    const rows = await d.query<{ surface_form: string; lexeme_id: string; lexical_unit_id: string }>("select surface_form, lexeme_id, lexical_unit_id from lexical_occurrences order by start_char");
    assert.deepEqual(rows.map((r) => r.surface_form), ["runs", "ran", "Running", "run"], "the exact surface (case included) is kept on each occurrence");
    assert.equal(new Set(rows.map((r) => r.lexeme_id)).size, 1);
    assert.equal(new Set(rows.map((r) => r.lexical_unit_id)).size, 1);
    assert.deepEqual(await unitsForSurface(d.db, "ran"), [rows[0]!.lexical_unit_id]);
  } finally { await d.close(); }
});

test("6 irregular verb buy/bought and noun child/children map to their lemma", () => {
  const buy = formsOf("buy", "v");
  assert.ok(buy.some((f) => f.form === "bought" && f.formType === "irregular"));
  assert.equal(buy.some((f) => f.form === "buyed"), false, "no invented regular past");
  assert.ok(formsOf("child", "noun").some((f) => f.form === "children" && f.formType === "irregular"));
  const spans = findUnitSpans("We bought bread.", [{ key: "buy", forms: buy.map((f) => f.form) }]);
  assert.deepEqual(spans.map((s) => [s.surface, s.keys]), [["bought", ["buy"]]]);
});

// 7, 8, 9 -------------------------------------------------------------------
test("7 'shed pounds' is one multi-word unit: the longest unit wins over the single word", () => {
  const spans = findUnitSpans("He wants to shed pounds before summer; trees shed leaves.", [
    { key: "shed pounds", forms: ["shed pounds"] }, { key: "shed", forms: ["shed"] },
  ]);
  assert.deepEqual(spans.map((s) => [s.surface, s.keys[0]]), [["shed pounds", "shed pounds"], ["shed", "shed"]]);
  assert.equal(unitIdentity("shed pounds", "phr").lexicalType, "phrase");
});

test("8 'take into account' matches inflected and across line breaks, never inside another word", () => {
  const forms = formsOf("take into account", "phrasal verb").map((f) => f.form);
  assert.ok(forms.includes("took into account") && forms.includes("taking into account"));
  const text = "The panel took into\naccount every view. Retaking into account is not a phrase.";
  const spans = findUnitSpans(text, [{ key: "tia", forms }]);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.surface, "took into\naccount");
  assert.equal(text.slice(spans[0]!.start, spans[0]!.end), spans[0]!.surface, "offsets point at the original characters");
  assert.equal(unitIdentity("take into account", "phrasal verb").lexicalType, "phrasal_verb");
  assert.ok(formsOf("come up with", "phrasal verb").some((f) => f.form === "came up with"));
});

test("9 function words are filtered as single words, but MWEs containing them are kept", async () => {
  assert.equal(isFunctionWord("on"), true);
  assert.equal(isFunctionWord("the"), true);
  assert.equal(isFunctionWord("on and off"), false);
  assert.equal(isFunctionWord("take into account"), false);
  const d = await createTestDatabase();
  try {
    const testId = await listeningTest(d);
    const text = "It rained on and off all day on the coast.";
    const result = await ingestListeningOccurrences(d.db, testId, { testId: "qa", sections: [{ number: 1, title: "s", transcript: text }] as never, vocabulary: [entry("on", "prep", "Touching a surface", text), entry("on and off", "adv", "From time to time", text)] });
    assert.equal(result.skippedFunctionWords, 1);
    const rows = await d.query<{ surface_form: string }>("select surface_form from lexical_occurrences");
    assert.deepEqual(rows.map((r) => r.surface_form), ["on and off"], "the bare 'on' in 'on the coast' is not a vocabulary occurrence");
  } finally { await d.close(); }
});

// 3, 4, 12, 13 ---------------------------------------------------------------
test("3 one-meaning trap: only the financial 'bank' is authored, 'They sat on the river bank.' stays UNRESOLVED", async () => {
  const d = await createTestDatabase();
  try {
    const testId = await listeningTest(d);
    const text = "I opened an account at the bank. Later they sat on the river bank.";
    const result = await ingestListeningOccurrences(d.db, testId, { testId: "qa", sections: [{ number: 1, title: "s", transcript: text }] as never, vocabulary: [entry("bank", "n", "An institution that keeps money", "I opened an account at the bank.")] });
    assert.deepEqual([result.resolved, result.unresolved], [1, 1]);
    const rows = await d.query<{ sentence_text: string; resolution_status: string; lexeme_id: string | null; lexical_unit_id: string | null }>("select sentence_text, resolution_status, lexeme_id, lexical_unit_id from lexical_occurrences order by start_char");
    assert.equal(rows[1]!.sentence_text, "Later they sat on the river bank.");
    assert.equal(rows[1]!.resolution_status, "unresolved");
    assert.equal(rows[1]!.lexeme_id, null, "the river bank never inherits the financial sense");
    assert.equal(rows[1]!.lexical_unit_id, rows[0]!.lexical_unit_id, "it is still known to be the noun 'bank'");
    assert.equal(rows[0]!.resolution_status, "resolved");
  } finally { await d.close(); }
});

test("4/12 two senses of 'bank' authored for two places stay separate senses of one unit", async () => {
  const d = await createTestDatabase();
  try {
    const testId = await listeningTest(d);
    const money = "She paid the cheque into the bank.";
    const river = "Ducks rested on the bank of the river.";
    await ingestListeningOccurrences(d.db, testId, { testId: "qa", sections: [{ number: 2, title: "s", transcript: `${money} ${river}` }] as never, vocabulary: [entry("bank", "n", "An institution that keeps money", money), entry("bank", "n", "The land beside a river", river)] });
    const rows = await d.query<{ definition_en: string; sentence_text: string; lexical_unit_id: string; lexeme_id: string }>("select l.definition_en, o.sentence_text, o.lexical_unit_id, o.lexeme_id from lexical_occurrences o join lexemes l on l.id = o.lexeme_id order by o.start_char");
    assert.deepEqual(rows.map((r) => r.definition_en), ["An institution that keeps money", "The land beside a river"]);
    assert.notEqual(rows[0]!.lexeme_id, rows[1]!.lexeme_id);
    assert.equal(rows[0]!.lexical_unit_id, rows[1]!.lexical_unit_id);
    assert.equal(exampleMatchesSentence(money, river), false);
  } finally { await d.close(); }
});

test("13 same spelling, different part of speech → different lexical units", async () => {
  const d = await createTestDatabase();
  try {
    const noun = await ensureLexicalUnit(d.db, { term: "record", partOfSpeech: "noun", provenance: "test" });
    const verb = await ensureLexicalUnit(d.db, { term: "record", partOfSpeech: "v", provenance: "test" });
    assert.notEqual(noun, verb);
    assert.equal(await ensureLexicalUnit(d.db, { term: " Record ", partOfSpeech: "(n.)", provenance: "test" }), noun, "normalised identity is idempotent");
  } finally { await d.close(); }
});

test("ingestion is idempotent and spans are served per section without meanings", async () => {
  const d = await createTestDatabase();
  try {
    const testId = await listeningTest(d);
    const pkg = { testId: "qa", sections: [{ number: 1, title: "a", transcript: "Prices rose sharply." }, { number: 3, title: "b", transcript: "Sales rose too." }] as never, vocabulary: [entry("rise", "verb", "To go up", "Prices rose sharply.")] };
    const first = await ingestListeningOccurrences(d.db, testId, pkg);
    const second = await ingestListeningOccurrences(d.db, testId, pkg);
    assert.deepEqual([first.resolved, first.unresolved], [1, 1]);
    assert.deepEqual([second.resolved, second.unresolved], [0, 0], "a re-import adds nothing");
    const spans = await listeningOccurrenceSpans(d.db, testId);
    assert.deepEqual(Object.keys(spans).sort(), ["1", "3"]);
    assert.deepEqual(Object.keys(spans[1]![0]!).sort(), ["endChar", "id", "startChar", "surfaceForm"], "no definition travels with the spans");
    const [timed] = await d.query<{ n: number }>("select count(*)::int n from lexical_occurrences where start_ms is not null or end_ms is not null");
    assert.equal(timed!.n, 0, "no audio timing is invented for transcripts without word timing");
  } finally { await d.close(); }
});

// 16 revisit -----------------------------------------------------------------
test("15/16 revisit targets: Reading → the learner's attempt; Listening → test + section; timing only if stored", () => {
  assert.equal(sourceRevisitHref({ sourceType: "reading", attemptId: "a1", passageId: "p1" }), "/reading/attempts/a1");
  assert.equal(sourceRevisitHref({ sourceType: "reading", attemptId: null, passageId: "p1" }), null, "no learner-reachable passage page: no fake link");
  assert.equal(sourceRevisitHref({ sourceType: "listening", listeningTestId: "t1", sectionNumber: 3 }), "/listening/tests/t1/study?section=3");
  assert.equal(sourceRevisitHref({ sourceType: "listening", listeningTestId: "t1", sectionNumber: 9 }), "/listening/tests/t1/study");
  assert.equal(sourceRevisitHref(null), null);
});

// 17 apostrophe + SQL/TS parity ---------------------------------------------
test("17 one Uzbek apostrophe fold for search, dedup and grading; unrelated punctuation untouched", () => {
  const variants = ["o'qish", "o\u2018qish", "o\u2019qish", "o\u02bbqish", "o\u02bcqish", "o`qish"];
  assert.equal(new Set(variants.map(normalizeLexical)).size, 1);
  assert.equal(new Set(variants.map(normalizeTerm)).size, 1);
  assert.equal(foldApostrophes("g\u02bbisht"), "g'isht");
  assert.equal(normalizeLexical("\u201cSo\u2019z\u201d \u2014 a-b"), "\u201cso'z\u201d \u2014 a-b");
  const hits = searchRows([{ id: "1", term: "reading", definitionEn: "the act of reading", translationUz: "o'qish" }], "o\u02bbqish");
  assert.equal(hits.length, 1, "search finds the ASCII-stored Uzbek meaning from a modifier-letter query");
  assert.equal(APOSTROPHE_VARIANTS.length, 7);
});

test("17b the 0029 SQL backfill and the TypeScript identity agree (parity)", async () => {
  const client = new PGlite();
  const root = join(import.meta.dirname, "..", "drizzle");
  const files = readdirSync(root).filter((n) => n.endsWith(".sql")).sort();
  const apply = async (name: string) => { for (const s of readFileSync(join(root, name), "utf8").split("--> statement-breakpoint").map((p) => p.trim()).filter(Boolean)) await client.exec(s); };
  try {
    for (const f of files.filter((n) => n < "0029")) await apply(f);
    const samples: [string, string | null][] = [["Take  Into Account", "phrasal verb"], ["O\u2019zbek", "(n.)"], ["the", null], ["on and off", "adv."], ["Bank", "N"], ["shed pounds", "phr"], ["get on", "v.phrase"]];
    for (const [i, [term, pos]] of samples.entries()) {
      await client.query("insert into lexemes (term, part_of_speech, definition_en, sense_key) values ($1, $2, 'd', $3)", [term, pos, `parity-${i}`]);
    }
    for (const f of files.filter((n) => n.startsWith("0029"))) await apply(f);
    const db = drizzle(client, { schema });
    const rows = (await client.query<{ term: string; part_of_speech: string | null; lemma_norm: string; pos: string; lexical_type: string; is_function_word: boolean }>(
      "select l.term, l.part_of_speech, u.lemma_norm, u.part_of_speech pos, u.lexical_type, u.is_function_word from lexemes l join lexical_units u on u.id = l.lexical_unit_id")).rows;
    assert.equal(rows.length, samples.length, "every existing sense is linked to a unit");
    for (const row of rows) {
      const ts = unitIdentity(row.term, row.part_of_speech);
      assert.deepEqual([row.lemma_norm, row.pos, row.lexical_type, row.is_function_word], [ts.lemmaNorm, ts.partOfSpeech, ts.lexicalType, isFunctionWord(row.term)], row.term);
    }
    // The application path finds the SAME unit the backfill created (no duplicate unit).
    const before = (await client.query<{ n: number }>("select count(*)::int n from lexical_units")).rows[0]!.n;
    await ensureLexicalUnit(db as never, { term: "take into account", partOfSpeech: "Phrasal Verb", provenance: "test" });
    assert.equal((await client.query<{ n: number }>("select count(*)::int n from lexical_units")).rows[0]!.n, before);
  } finally { await client.close(); }
});

// 25 migration compatibility (in-process PostgreSQL) -------------------------
test("25 migration 0029 on pre-existing data: ids kept, Reading links intact, contexts backfilled, nothing lost", async () => {
  const client = new PGlite();
  const root = join(import.meta.dirname, "..", "drizzle");
  const files = readdirSync(root).filter((n) => n.endsWith(".sql")).sort();
  const apply = async (name: string) => { for (const s of readFileSync(join(root, name), "utf8").split("--> statement-breakpoint").map((p) => p.trim()).filter(Boolean)) await client.exec(s); };
  const q = async <T,>(sql: string, args: unknown[] = []) => (await client.query<T>(sql, args)).rows;
  try {
    for (const f of files.filter((n) => n < "0029")) await apply(f);
    const user = randomUUID();
    await q("insert into users (id, name, role, account_status) values ($1, 'legacy', 'student', 'active')", [user]);
    const [passage] = await q<{ id: string }>("insert into reading_passages (title, body_text) values ('Legacy', 'The bank lends money.') returning id");
    const [money] = await q<{ id: string }>("insert into lexemes (term, part_of_speech, definition_en, sense_key) values ('bank', 'n', 'A financial institution', 'legacy-bank-money') returning id");
    const [river] = await q<{ id: string }>("insert into lexemes (term, part_of_speech, definition_en, sense_key) values ('bank', 'n', 'Land beside a river', 'legacy-bank-river') returning id");
    const [occ] = await q<{ id: string }>("insert into lexical_occurrences (lexeme_id, passage_id, surface_form, start_char, end_char, sentence_text) values ($1, $2, 'bank', 4, 8, 'The bank lends money.') returning id", [money!.id, passage!.id]);
    const snapshot = { occurrenceId: occ!.id, lexemeId: money!.id, sourceTitle: "Legacy", surfaceForm: "bank", sentenceText: "The bank lends money." };
    const [uv] = await q<{ id: string }>("insert into user_vocabulary (user_id, lexeme_id, sense_key, source_type, source_snapshot, srs_stage, mastery) values ($1, $2, 'legacy-bank-money', 'reading', $3, 2, 'learning') returning id", [user, money!.id, JSON.stringify(snapshot)]);
    const beforeIds = (await q<{ id: string }>("select id from lexemes order by id")).map((r) => r.id);
    const beforeUv = await q<Record<string, unknown>>("select id, lexeme_id, srs_stage, mastery, next_review_at from user_vocabulary");

    for (const f of files.filter((n) => n.startsWith("0029"))) await apply(f);

    assert.deepEqual((await q<{ id: string }>("select id from lexemes order by id")).map((r) => r.id), beforeIds, "EXISTING_LEXEME_IDS_CHANGED=0");
    assert.deepEqual(await q("select id, lexeme_id, srs_stage, mastery, next_review_at from user_vocabulary"), beforeUv, "SRS and the sense link are untouched");
    const [o] = await q<{ source_type: string; resolution_status: string; lexeme_id: string; passage_id: string; lexical_unit_id: string | null }>("select source_type, resolution_status, lexeme_id, passage_id, lexical_unit_id from lexical_occurrences");
    assert.deepEqual([o!.source_type, o!.resolution_status, o!.lexeme_id, o!.passage_id], ["reading", "resolved", money!.id, passage!.id], "Reading link intact");
    const units = await q<{ lexical_unit_id: string }>("select distinct lexical_unit_id from lexemes");
    assert.equal(units.length, 1, "two senses of 'bank' share one unit");
    assert.notEqual(units[0]!.lexical_unit_id, null);
    const contexts = await q<{ user_vocabulary_id: string; occurrence_id: string; source_type: string; user_id: string }>("select user_vocabulary_id, occurrence_id, source_type, user_id from user_vocabulary_contexts");
    assert.deepEqual(contexts, [{ user_vocabulary_id: uv!.id, occurrence_id: occ!.id, source_type: "reading", user_id: user }], "the single legacy snapshot became the first context");
    const [seen] = await q<{ seen_count: number }>("select seen_count from user_vocabulary");
    assert.equal(seen!.seen_count, 1);
    assert.equal((await q("select 1 from pg_indexes where indexname = 'user_vocabulary_user_sense_idx'")).length, 1);
    assert.equal(river!.id && (await q("select 1 from lexemes where id = $1", [river!.id])).length, 1, "DESTRUCTIVE_DATA_LOSS=0");
  } finally { await client.close(); }
});

test("user-visible Uzbek vocabulary copy is Latin script only", () => {
  const copy = JSON.stringify([uz.vocabulary.meaningUnchecked, uz.vocabulary.meaningUncheckedHint, uz.vocabulary.lexicalTypeLabel]);
  assert.equal(/[\u0400-\u04FF]/.test(copy), false);
  assert.match(uz.vocabulary.meaningUnchecked, /tekshirilmagan/);
});
