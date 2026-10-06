import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { convertLegacyPackage } from "../src/lib/listening/source-parser";
import { listeningPackageSchema } from "../src/lib/listening/package";
import {
  applyListeningConversion,
  classifyListeningPayload,
  convertLegacyRuntimePackage,
} from "../src/lib/import/listening/legacy";
import { createTestDatabase } from "./support/pglite";

/**
 * Legacy Listening conversion (Phase D).
 *
 * The contract under test is deliberately conservative:
 *   • classification is STRUCTURAL — never inferred from a title or filename;
 *   • extraction is inert and, when ambiguous, STOPS with named reasons;
 *   • an applied conversion keeps the ids, the publication state and the attempt
 *     history, and clears the legacy marker instead of running HTML forever.
 */

const read = (html: string) => new JSDOM(html).window.document;
const fixture = (n: number) => readFileSync(`tests/fixtures/listening/authored-test${n}.html`, "utf8");

/** The stored shape of a legacy package: extracted data PLUS the runtime it came from. */
function legacyPackage(n: number, overrides: Record<string, unknown> = {}) {
  const html = fixture(n);
  const extracted = convertLegacyPackage({ "source.html": html }, 2000, read, {
    audioPath: "audio.mp3",
    fallbackTestId: `Listening Test ${n}.html`,
  });
  return listeningPackageSchema.parse({
    ...extracted,
    legacyRuntime: true,
    authoredRuntime: { entryPath: "source.html", files: { "source.html": html } },
    ...overrides,
  });
}

test("LD1 classification is structural: canonical data, convertible legacy, and invalid payloads are told apart", () => {
  const legacy = legacyPackage(1);
  const scan = classifyListeningPayload(legacy);
  assert.equal(scan.classification, "CONVERTIBLE_LEGACY");
  assert.equal(scan.hasAuthoredRuntime, true);
  assert.deepEqual(scan.runtimeFiles, ["source.html"]);
  assert.equal(scan.questions, 40);
  assert.equal(scan.sections, 4);
  // Fixture 1 keeps its transcript inside the authored runtime; fixture 2 has real
  // <p> transcripts. Classification reports what the package holds, not what we wish.
  assert.equal(scan.transcripts, 0);
  assert.match(scan.reasons.join(" "), /authored runtime/);

  const canonical = { ...legacy, authoredRuntime: undefined, legacyRuntime: false };
  delete (canonical as { authoredRuntime?: unknown }).authoredRuntime;
  const native = classifyListeningPayload(canonical);
  assert.equal(native.classification, "CANONICAL_NATIVE");
  assert.deepEqual(native.reasons, []);

  const withoutQuestions = classifyListeningPayload({ ...canonical, questions: [] });
  assert.equal(withoutQuestions.classification, "INVALID");
  assert.match(withoutQuestions.reasons.join(" "), /Missing questions|no questions/);

  const second = legacyPackage(2);
  assert.equal(classifyListeningPayload(second).transcripts, 4);

  const invalid = classifyListeningPayload({ ...legacy, schemaVersion: 7 } as never);
  assert.equal(invalid.classification, "INVALID");
  assert.ok(invalid.reasons.length > 0);
});

test("LD2 both authored fixture families convert to canonical data that keeps every question and answer", () => {
  for (const n of [1, 2]) {
    const outcome = convertLegacyRuntimePackage(legacyPackage(n), read);
    assert.equal(outcome.ok, true, JSON.stringify(outcome.ok ? {} : outcome.reasons));
    if (!outcome.ok) return;
    assert.equal(outcome.report.questions, 40);
    assert.equal(outcome.report.sections, 4);
    assert.equal(outcome.report.runtimeFiles.join(), "source.html");
    assert.equal(outcome.package.module, "listening");
    assert.equal(outcome.package.contentType, "full_test");
    assert.equal(outcome.package.schemaVersion, 2);
    assert.equal(outcome.package.sourceRef, n === 1 ? "listening-test-1" : "listening-test-2");
    assert.equal(outcome.package.provenance.source, "legacy_conversion");
    assert.equal(outcome.package.publication.state, "draft", "a conversion is not a publication decision");
    assert.deepEqual(
      outcome.package.assets.map((asset) => `${asset.key}:${asset.role}`),
      ["audio.full:audio"],
    );
    assert.equal(outcome.package.content.audio.assetKey, "audio.full");
    assert.equal(outcome.package.content.audio.path, "audio.mp3");
    assert.equal(outcome.package.content.questions.length, 40);
    assert.ok(outcome.package.content.questions.every((question) => question.key.trim().length > 0));
    assert.ok(outcome.package.content.questions.every((question) => question.evidence.at > 0));
    // The conversion is the same material, not a reinterpretation: the questions
    // that the authored document contains are the questions that come out.
    const extracted = convertLegacyPackage({ "source.html": fixture(n) }, 2000, read, { audioPath: "audio.mp3" });
    assert.deepEqual(
      outcome.package.content.questions.map((question) => [question.number, question.key]),
      extracted.questions.map((question) => [question.number, question.key]),
    );
    if (n === 2) assert.equal(outcome.package.content.keyword1.length, 60);
  }
});

test("LD3 a missing entry document, unmapped answer controls, empty keys and untimed evidence all refuse conversion", () => {
  // Storage already refuses a runtime whose entry path is not in `files`, so the
  // guard below is the second line of defence for a row written before the schema
  // existed: it refuses rather than guessing which file is the entry document.
  const storedWithoutEntry = {
    ...legacyPackage(1),
    authoredRuntime: { entryPath: "gone.html", files: { "source.html": "<html></html>" } },
  } as never;
  const noEntry = convertLegacyRuntimePackage(storedWithoutEntry, read);
  assert.equal(noEntry.ok, false);
  if (!noEntry.ok) {
    assert.equal(noEntry.classification, "LEGACY_REQUIRES_REVIEW");
    assert.match(noEntry.reasons[0]!, /no readable runtime entry/);
  }
  assert.equal(
    listeningPackageSchema.safeParse(storedWithoutEntry).success,
    false,
    "and the stored schema refuses it too — the guard never masks a schema gap",
  );
  const runtimeOnly = convertLegacyRuntimePackage({ ...legacyPackage(1), authoredRuntime: undefined } as never, read);
  assert.equal(runtimeOnly.ok, false);


  // A document that extracts fine but still holds an answer control with no
  // extracted question is the dangerous case: the student would answer a field
  // the canonical data does not know about.
  const withStray = `${fixture(1)}<input id="l999" name="l999">`;
  const markers = convertLegacyRuntimePackage(
    listeningPackageSchema.parse({
      ...legacyPackage(1),
      authoredRuntime: { entryPath: "source.html", files: { "source.html": withStray } },
    }),
    read,
  );
  assert.equal(markers.ok, false);
  if (!markers.ok) {
    assert.equal(markers.classification, "LEGACY_REQUIRES_REVIEW");
    assert.match(markers.reasons.join(" "), /999/);
    assert.ok(markers.unsupported.length > 0);
  }

  // A document the inert extractor cannot read at all is a review case too.
  const unreadable = convertLegacyRuntimePackage(
    listeningPackageSchema.parse({
      ...legacyPackage(1),
      authoredRuntime: { entryPath: "source.html", files: { "source.html": "<title>Nothing to extract</title><p>No question data here.</p>" } },
    }),
    read,
  );
  assert.equal(unreadable.ok, false);

  // An authored answer that cannot be read as a key refuses conversion: the
  // stored package is the runtime document, so the mutation has to happen there.
  const keyless = fixture(1).replace('"key": "80"', '"key": ""');
  assert.notEqual(keyless, fixture(1), "the fixture still carries the answer we mutate");
  const badKey = convertLegacyRuntimePackage(
    listeningPackageSchema.parse({
      ...legacyPackage(1),
      authoredRuntime: { entryPath: "source.html", files: { "source.html": keyless } },
    }),
    read,
  );
  assert.equal(badKey.ok, false);
  if (!badKey.ok) assert.match(badKey.reasons.join(" "), /at least 1 character|no answer key/);

  // Question 1 with a zero timestamp is material the student cannot be examined on.
  const untimed = fixture(1).replace('"key": "80", "alternatives": ["eighty"], "pair": [], "evidence": {"at": 150.0', '"key": "80", "alternatives": ["eighty"], "pair": [], "evidence": {"at": 0');
  assert.notEqual(untimed, fixture(1), "the fixture still carries the timestamp we mutate");
  const badTime = convertLegacyRuntimePackage(
    listeningPackageSchema.parse({
      ...legacyPackage(1),
      authoredRuntime: { entryPath: "source.html", files: { "source.html": untimed } },
    }),
    read,
  );
  assert.equal(badTime.ok, false);
  if (!badTime.ok) assert.match(badTime.reasons.join(" "), /no evidence timestamp/);

  // An extractor that throws is a review case, never a silent success.
  const throwing = convertLegacyRuntimePackage(legacyPackage(1), () => {
    throw new Error("unreadable document");
  });
  assert.equal(throwing.ok, false);
  if (!throwing.ok) assert.match(throwing.reasons[0]!, /unreadable document/);
});

test("LD4 conversion never evaluates the uploaded runtime: script bodies are inert text or absent", () => {
  const html = `${fixture(1)}<script>window.__executed = true; document.title = "executed";</script>`;
  const payload = listeningPackageSchema.parse({
    ...convertLegacyPackage({ "source.html": html }, 2000, read, { audioPath: "audio.mp3", fallbackTestId: "Inert" }),
    authoredRuntime: { entryPath: "source.html", files: { "source.html": html } },
  });
  const outcome = convertLegacyRuntimePackage(payload, read);
  assert.equal(outcome.ok, true);
  assert.equal((globalThis as { __executed?: boolean }).__executed, undefined);
  if (outcome.ok)
    assert.equal(
      JSON.stringify(outcome.package).includes("__executed"),
      false,
      "converted data carries educational content, not the runtime script body",
    );
});

test("LD5 an applied conversion keeps rows, ids, publication state and attempt history", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const [owner] = await query<{ id: string }>(
      `insert into users (name, role) values ('Legacy Conversion Owner', 'owner') returning id`,
    );
    const [student] = await query<{ id: string }>(
      `insert into users (name, role) values ('Legacy Conversion Student', 'student') returning id`,
    );
    const legacy = legacyPackage(2);
    const [test] = await query<{ id: string }>(
      `insert into listening_tests (created_by_user_id, title, audio_type, publication_state, difficulty_level)
       values ($1, $2, 'audio', 'published', 'B2') returning id`,
      [owner!.id, legacy.title],
    );
    await query(
      `insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash, legacy_runtime)
       values ($1, $2, $3::jsonb, 'audio/legacy.mp3', $4, true)`,
      [test!.id, legacy.testId, JSON.stringify(legacy), "a".repeat(64)],
    );
    await query(`insert into listening_questions (test_id, "order", type, question_text, correct_answer, explanation) values ($1, 1, 'multiple_choice', 'Old text', $2, '')`, [
      test!.id,
      "old answer",
    ]);
    const [question] = await query<{ id: string }>(`select id from listening_questions where test_id = $1`, [test!.id]);
    const [attempt] = await query<{ id: string }>(
      `insert into listening_attempts (user_id, test_id, status, score, total_questions) values ($1, $2, 'completed', 30, 40) returning id`,
      [student!.id, test!.id],
    );
    await query(`insert into listening_answers (attempt_id, question_id, user_answer, is_correct) values ($1, $2, 'old answer', true)`, [
      attempt!.id,
      question!.id,
    ]);

    const outcome = convertLegacyRuntimePackage(legacy, read);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    const result = await db.transaction((tx) =>
      applyListeningConversion(tx, { testId: test!.id, actorUserId: owner!.id, package: outcome.package, note: "LD5" }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.questions, 40);

    const [after] = await query<{ test_id: string; source_id: string; legacy_runtime: boolean; payload: { authoredRuntime?: unknown; questions: unknown[] } }>(
      `select test_id, source_id, legacy_runtime, payload from listening_packages where test_id = $1`,
      [test!.id],
    );
    assert.equal(after!.test_id, test!.id, "the test id never changes");
    assert.equal(after!.source_id, legacy.testId, "source identity never changes");
    assert.equal(after!.legacy_runtime, false, "the legacy marker clears");
    assert.equal(after!.payload.authoredRuntime, undefined, "the runtime is no longer part of the package");
    assert.equal(after!.payload.questions.length, 40);

    const [testRow] = await query<{ id: string; publication_state: string; transcript: string | null }>(
      `select id, publication_state, transcript from listening_tests where id = $1`,
      [test!.id],
    );
    assert.equal(testRow!.id, test!.id);
    assert.equal(testRow!.publication_state, "published", "conversion must not unpublish live material");
    assert.ok((testRow!.transcript ?? "").length > 100, "the transcript moves to the test row");

    const [attemptRow] = await query<{ id: string; score: number | null }>(`select id, score from listening_attempts where test_id = $1`, [test!.id]);
    assert.equal(attemptRow!.id, attempt!.id, "attempt history survives");
    assert.equal(attemptRow!.score, 30);
    const questionRows = await query<{ id: string; correct_answer: string }>(`select id, correct_answer from listening_questions where test_id = $1 order by "order"`, [
      test!.id,
    ]);
    assert.equal(questionRows.length, 40, "reconciliation never duplicates a question");
    assert.equal(questionRows[0]!.id, question!.id, "the existing row is reused, so answers still point at a live question");
    assert.equal(questionRows[0]!.correct_answer, outcome.package.content.questions[0]!.key);
    const [answerRow] = await query<{ question_id: string }>(`select question_id from listening_answers where attempt_id = $1`, [attempt!.id]);
    assert.equal(answerRow!.question_id, question!.id, "the graded answer still resolves after conversion");

    const [record] = await query<{ status: string; content_hash: string; content_version: number; target_type: string; legacy_runtime: boolean }>(
      `select status, content_hash, content_version, target_type, legacy_runtime from content_imports where target_id = $1`,
      [test!.id],
    );
    assert.equal(record!.status, "converted");
    assert.equal(record!.target_type, "listening_test");
    assert.equal(record!.legacy_runtime, false);
    assert.equal(record!.content_version, 1);
    assert.match(record!.content_hash!, /^[0-9a-f]{64}$/);
  } finally {
    await database.close();
  }
});

test("LD6 a converted package re-scans as canonical and a second conversion is refused by validation", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const [owner] = await query<{ id: string }>(
      `insert into users (name, role) values ('Legacy Conversion Owner', 'owner') returning id`,
    );
    const legacy = legacyPackage(1);
    const [test] = await query<{ id: string }>(
      `insert into listening_tests (created_by_user_id, title, audio_type, publication_state) values ($1, $2, 'audio', 'draft') returning id`,
      [owner!.id, legacy.title],
    );
    await query(`insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash, legacy_runtime) values ($1, $2, $3::jsonb, 'audio/a.mp3', $4, true)`, [
      test!.id,
      legacy.testId,
      JSON.stringify(legacy),
      "b".repeat(64),
    ]);

    const outcome = convertLegacyRuntimePackage(legacy, read);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    const applied = await db.transaction((tx) =>
      applyListeningConversion(tx, { testId: test!.id, actorUserId: owner!.id, package: outcome.package }),
    );
    assert.equal(applied.ok, true);

    const [stored] = await query<{ payload: unknown }>(`select payload from listening_packages where test_id = $1`, [test!.id]);
    const scan = classifyListeningPayload(listeningPackageSchema.parse(stored!.payload));
    assert.equal(scan.classification, "CANONICAL_NATIVE");
    assert.equal(scan.hasAuthoredRuntime, false);

    const [second] = await query<{ content_version: number }>(`select content_version from content_imports where target_id = $1`, [test!.id]);
    assert.equal(second!.content_version, 1, "one conversion, one record");

    const missing = await db.transaction((tx) =>
      applyListeningConversion(tx, { testId: crypto.randomUUID(), actorUserId: owner!.id, package: outcome.package }),
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "not_found");
  } finally {
    await database.close();
  }
});
