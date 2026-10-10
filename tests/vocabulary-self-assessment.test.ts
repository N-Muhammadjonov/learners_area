import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadSelfAssessments } from "../src/lib/services/vocabulary/engine";
import { isVerifiableKind, shouldAwardGamePoint, submissionMatchesGame } from "../src/lib/services/vocabulary/grading";
import { createTestDatabase, type TestDatabase } from "./support/pglite";

/**
 * Flashcard self-assessment durability.
 *
 * The owner requirement is that a learner's Learned / Not yet judgement is
 * durable practice state, that it never earns a leaderboard point, and that the
 * marks are still there after a reload. Nothing new is stored for this: a
 * self-assessment is written as a `VOCAB_GAME_PRACTICED` activity and the deck
 * reads the newest judgement per word back from those rows. The first half of
 * this file proves that read-back against a real PostgreSQL (PGlite, the shipped
 * migrations); the second half pins the wiring in the route and the component.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");

let database: TestDatabase;
let learnerId: string;
let otherId: string;

const ENTRY_LATEST = "11111111-1111-4111-8111-111111111111";
const ENTRY_KNOWN = "22222222-2222-4222-8222-222222222222";
const ENTRY_FOREIGN = "33333333-3333-4333-8333-333333333333";
const ENTRY_ABSENT = "44444444-4444-4444-8444-444444444444";

let clock = new Date("2026-05-01T08:00:00.000Z").getTime();

/** Write one practice row exactly as `recordGameAnswer` writes it. */
async function record(userId: string, kind: string, entryId: string, correct: boolean) {
  clock += 1_000;
  await database.query(
    `insert into activity_events (user_id, type, payload, created_at)
     values ($1, 'VOCAB_GAME_PRACTICED', $2::jsonb, $3)`,
    [userId, JSON.stringify({ entryId, kind, correct, verified: false }), new Date(clock).toISOString()],
  );
}

before(async () => {
  database = await createTestDatabase();
  const rows = await database.query<{ id: string }>(
    `insert into users (name, role, account_status, email) values
       ('QA Self Learner', 'student', 'active', 'qa.self.learner@example.test'),
       ('QA Self Other', 'student', 'active', 'qa.self.other@example.test')
     returning id`,
  );
  learnerId = rows[0]!.id;
  otherId = rows[1]!.id;

  // The learner judges the same word twice: the newest judgement must win.
  await record(learnerId, "self", ENTRY_LATEST, true);
  await record(learnerId, "self", ENTRY_LATEST, false);
  // A different word, judged Learned, and then answered in a point-bearing game:
  // that other kind of practice must not rewrite the flashcard judgement.
  await record(learnerId, "self", ENTRY_KNOWN, true);
  await record(learnerId, "spelling", ENTRY_KNOWN, false);
  // Another learner's judgement is never read for this learner.
  await record(otherId, "self", ENTRY_FOREIGN, true);
});

after(async () => {
  await database.close();
});

test("a reloaded deck reads the newest self-assessment per word, for its own learner only", async () => {
  const marks = await loadSelfAssessments(learnerId, [ENTRY_LATEST, ENTRY_KNOWN, ENTRY_FOREIGN, ENTRY_ABSENT], database.db);

  assert.equal(marks[ENTRY_LATEST], "notYet", "the newest judgement wins");
  assert.equal(marks[ENTRY_KNOWN], "known", "a point-bearing answer never rewrites the flashcard judgement");
  assert.equal(ENTRY_FOREIGN in marks, false, "another learner's judgement is not this learner's state");
  assert.equal(ENTRY_ABSENT in marks, false, "an unjudged word carries no invented mark");
  assert.deepEqual(Object.keys(marks).sort(), [ENTRY_LATEST, ENTRY_KNOWN].sort());
});

test("scoped reads stay scoped: an empty deck asks nothing, another learner gets nothing", async () => {
  assert.deepEqual(await loadSelfAssessments(learnerId, [], database.db), {});
  assert.deepEqual(await loadSelfAssessments(otherId, [ENTRY_LATEST, ENTRY_KNOWN], database.db), {});
});

test("self-assessment can never award a leaderboard point", () => {
  // The point gate is `verified && correct && the game's own kind`. A
  // self-assessment is not a verifiable kind, and the engine leaves `verified`
  // false on that branch — so the only way the gate could ever be true for a
  // flashcard is if the server itself started calling it verified.
  assert.equal(isVerifiableKind("self"), false);
  assert.equal(isVerifiableKind("spelling"), true);
  assert.equal(submissionMatchesGame("cards", "self"), true);
  assert.equal(submissionMatchesGame("cards", "spelling"), false);
  assert.equal(shouldAwardGamePoint({ gameId: "cards", kind: "self", verified: false, correct: true }), false);
  assert.equal(shouldAwardGamePoint({ gameId: "choice", kind: "spelling", verified: true, correct: true }), true);

  const engine = stripComments(read("src/lib/services/vocabulary/engine.ts"));
  const verifiedAssignments = engine.match(/verified = true/g) ?? [];
  assert.equal(
    verifiedAssignments.length,
    3,
    "only the three server-checkable submissions may ever be marked verified",
  );
  const selfBranch = engine.match(/else if \(compatibleMode && value\.submission\.kind === "self"\) \{([^}]*)\}/)?.[1] ?? "";
  assert.match(selfBranch, /correct = value\.submission\.known/);
  assert.doesNotMatch(selfBranch, /verified\s*=\s*true/);
});

test("the durable marks are wired into the flashcard deck and no other game", () => {
  const route = stripComments(read("src/app/api/vocabulary/games/route.ts"));
  assert.match(
    route,
    /gameId === "cards"\s*\?\s*await loadSelfAssessments\(user\.id, words\.map\(\(word\) => word\.id\)\)\s*:\s*null/,
    "only the flashcard route asks for self-assessments",
  );
  assert.match(route, /\.\.\.\(selfAssessments \? \{ selfAssessments \} : \{\}\)/);

  const panel = stripComments(read("src/components/vocabulary/VocabGamesPanel.tsx"));
  assert.match(panel, /<Flashcards[^>]*selfAssessments=\{currentSet\.selfAssessments\}/);
  assert.match(
    panel,
    /useState<Record<string, "known" \| "notYet">>\(\(\) => \(\{ \.\.\.\(selfAssessments \?\? \{\}\) \}\)\)/,
    "the marks start from the server read-back, not from an empty object",
  );

  const types = stripComments(read("src/components/vocabulary/types.ts"));
  assert.match(types, /selfAssessments\?: Record<string, "known" \| "notYet">/);

  const engine = stripComments(read("src/lib/services/vocabulary/engine.ts"));
  assert.match(engine, /export async function loadSelfAssessments/);
  assert.match(engine, /eq\(activityEvents\.type, "VOCAB_GAME_PRACTICED"\)/);
  assert.match(engine, /->> 'kind' = 'self'/);
  assert.match(engine, /eq\(activityEvents\.userId, userId\)/, "only the caller's own rows are read");
});
