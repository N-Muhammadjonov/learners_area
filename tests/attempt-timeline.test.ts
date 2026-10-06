import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TIMELINE_KINDS,
  TIMELINE_MAX_LIMIT,
  getAttemptTimeline,
  getLearnerTimeline,
  type TimelineKind,
} from "../src/lib/data/attempt-timeline";
import { createTestDatabase } from "./support/pglite";

/**
 * THE CROSS-SKILL ATTEMPT TIMELINE (§AD).
 *
 * The claims under test:
 *   • all seven kinds — Reading, Listening, Writing, Speaking, Grammar, Mock,
 *     Assignment — appear in ONE learner history ordered by real attempt time;
 *   • every entry REFERENCES a real domain row and reports the row's own facts. There
 *     is no timeline table, nothing is copied, and changing the attempt changes what the
 *     timeline says (which is how a projection is supposed to behave);
 *   • the canonical revision an attempt was bound to is resolved by reference, so old
 *     work keeps naming the revision it was done against;
 *   • the read is bounded and filterable (kinds, limit, window), and one learner's
 *     timeline never contains another learner's rows.
 */

const read = (path: string) => readFileSync(path, "utf8");

type Db = Awaited<ReturnType<typeof createTestDatabase>>;

async function seedLearner(db: Db) {
  const [learner] = await db.query<{ id: string }>(`insert into users (name, role) values ('Timeline learner', 'student') returning id`);
  const [other] = await db.query<{ id: string }>(`insert into users (name, role) values ('Other learner', 'student') returning id`);
  const [owner] = await db.query<{ id: string }>(`insert into users (name, role) values ('Timeline owner', 'owner') returning id`);
  const [course] = await db.query<{ id: string }>(`insert into courses (slug, title) values ('timeline-course', 'Timeline course') returning id`);
  return { learnerId: learner!.id, otherId: other!.id, ownerId: owner!.id, courseId: course!.id };
}

async function seedVersion(db: Db, module: string, contentType: string, sourceRef: string, title: string) {
  const [row] = await db.query<{ id: string }>(
    `insert into content_versions (module, content_type, source_ref, version_no, status, title, track, content_hash, semantic_hash, answer_key_hash, publication_state)
     values ($1, $2, $3, 1, 'published', $4, 'academic', $5, $6, $7, 'published') returning id`,
    [module, contentType, sourceRef, title, `hash-${sourceRef}`, `semantic-${sourceRef}`, `key-${sourceRef}`],
  );
  return row!.id;
}

/** One attempt of every kind, each a few minutes after the previous one. */
async function seedTimeline(db: Db) {
  const { learnerId, otherId, ownerId, courseId } = await seedLearner(db);
  const at = (minutes: number) => new Date(Date.UTC(2026, 0, 10, 9, minutes, 0));

  const readingVersion = await seedVersion(db, "reading", "general_set", "timeline-reading", "Harbour passage");
  const listeningVersion = await seedVersion(db, "listening", "full_test", "timeline-listening", "Listening set one");
  const writingVersion = await seedVersion(db, "writing", "task2", "timeline-writing", "Writing task two");
  const speakingVersion = await seedVersion(db, "speaking", "part_2", "timeline-speaking", "Speaking cue card");
  const grammarVersion = await seedVersion(db, "grammar", "topic", "timeline-grammar", "Articles");

  const [passage] = await db.query<{ id: string }>(
    `insert into reading_passages (title, body_text, passage_no, publication_state) values ('Harbour passage', 'Passage body.', 1, 'published') returning id`,
  );
  const [reading] = await db.query<{ id: string }>(
    `insert into reading_attempts (user_id, passage_id, content_version_id, status, score, total_questions, started_at, submitted_at)
     values ($1, $2, $3, 'completed', 11, 13, $4, $5) returning id`,
    [learnerId, passage!.id, readingVersion, at(1), at(2)],
  );
  // Another learner's attempt: it must never appear in the first learner's timeline.
  await db.query(
    `insert into reading_attempts (user_id, passage_id, content_version_id, status, score, total_questions, started_at, submitted_at)
     values ($1, $2, $3, 'completed', 3, 13, $4, $5)`,
    [otherId, passage!.id, readingVersion, at(3), at(4)],
  );

  const [test] = await db.query<{ id: string }>(
    `insert into listening_tests (created_by_user_id, title, audio_type, publication_state) values ($1, 'Listening set one', 'audio', 'published') returning id`,
    [ownerId],
  );
  const [listening] = await db.query<{ id: string }>(
    `insert into listening_attempts (user_id, test_id, content_version_id, status, score, total_questions, started_at, submitted_at)
     values ($1, $2, $3, 'completed', 30, 40, $4, $5) returning id`,
    [learnerId, test!.id, listeningVersion, at(5), at(6)],
  );

  const [prompt] = await db.query<{ id: string }>(
    `insert into writing_prompts (task_type, category, prompt, target_word_count, publication_state) values ('task2', 'education', 'Discuss both views about homework.', 250, 'published') returning id`,
  );
  const [writing] = await db.query<{ id: string }>(
    `insert into writing_submissions (user_id, prompt_id, content_version_id, content, word_count, status, submitted_at)
     values ($1, $2, $3, 'Homework is debated everywhere and the arguments run deep.', 12, 'submitted', $4) returning id`,
    [learnerId, prompt!.id, writingVersion, at(8)],
  );

  const [speakingPrompt] = await db.query<{ id: string }>(
    `insert into speaking_prompts (part, category, prompt_text, topic) values ('part2', 'part2', 'Describe a quiet place you like.', 'Quiet places') returning id`,
  );
  const [speaking] = await db.query<{ id: string }>(
    `insert into speaking_attempts (user_id, prompt_id, content_version_id, part, status, recording_object_key, recording_duration_ms, started_at, submitted_at)
     values ($1, $2, $3, 'part2', 'reviewed', 'speaking/attempts/x/one.m4a', 91000, $4, $5) returning id`,
    [learnerId, speakingPrompt!.id, speakingVersion, at(10), at(11)],
  );

  const [topic] = await db.query<{ id: string }>(
    `insert into grammar_topics (skill_area, title, explanation, source_ref, "order") values ('writing', 'Articles', 'A, an, the.', 'timeline-grammar-topic', 1) returning id`,
  );
  const [exercise] = await db.query<{ id: string }>(
    `insert into grammar_exercises (topic_id, prompt_text, options, correct_option, explanation, "order") values ($1, 'Choose the article: __ apple.', '["a","an"]', 'an', 'Use "an" before a vowel sound.', 1) returning id`,
    [topic!.id],
  );
  const [grammar] = await db.query<{ id: string }>(
    `insert into grammar_attempts (user_id, exercise_id, activity, selected_option, is_correct, content_version_id, attempted_at)
     values ($1, $2, 'correct_it', 'an', true, $3, $4) returning id`,
    [learnerId, exercise!.id, grammarVersion, at(13)],
  );

  const [mock] = await db.query<{ id: string }>(
    `insert into mock_tests (course_id, title, skill, publication_state) values ($1, 'Full mock 3', 'full', 'published') returning id`,
    [courseId],
  );
  const [mockAttempt] = await db.query<{ id: string }>(
    `insert into mock_attempts (user_id, mock_test_id, mock_snapshot, mock_version, status, started_at, finished_at, raw_score, estimated_band, content_version_bindings)
     values ($1, $2, $3::jsonb, 4, 'submitted', $4, $5, 71, 6.5, $6::jsonb) returning id`,
    [learnerId, mock!.id, JSON.stringify({ title: "Full mock 3 (as taken)", track: "academic", kind: "full" }), at(15), at(20), JSON.stringify({ "reading:0": readingVersion, "listening:0": listeningVersion })],
  );

  const [assignment] = await db.query<{ id: string }>(
    `insert into assignments (title, created_by_user_id, target_user_id, module, content_type, source_ref, content_version_id, status, due_at)
     values ('Write about homework', $1, $2, 'writing', 'task2', 'timeline-writing', $3, 'completed', $4) returning id`,
    [ownerId, learnerId, writingVersion, at(40)],
  );
  await db.query(
    `insert into assignment_targets (assignment_id, student_user_id, status, completed_at) values ($1, $2, 'completed', $3)`,
    [assignment!.id, learnerId, at(26)],
  );
  const [response] = await db.query<{ id: string }>(
    `insert into assignment_responses (assignment_id, user_id, content) values ($1, $2, 'My answer to the task.') returning id`,
    [assignment!.id, learnerId],
  );
  await db.query(`update assignment_responses set created_at = $2, updated_at = $2 where id = $1`, [response!.id, at(25)]);

  return {
    learnerId, otherId,
    ids: {
      reading: reading!.id, listening: listening!.id, writing: writing!.id, speaking: speaking!.id,
      grammar: grammar!.id, mock: mockAttempt!.id, assignment: response!.id,
    },
    versions: { readingVersion, listeningVersion, writingVersion, speakingVersion, grammarVersion },
    assignmentId: assignment!.id,
  };
}

test("TL1 all seven skills appear in ONE history, newest first, each referencing its real row", async () => {
  const database = await createTestDatabase();
  try {
    const seed = await seedTimeline(database);
    const entries = await getLearnerTimeline(seed.learnerId, {}, database.db as never);

    assert.deepEqual([...new Set(entries.map((entry) => entry.kind))].sort(), [...TIMELINE_KINDS].sort(), "every kind is represented — no module is missing");
    assert.equal(entries.length, 7, "one entry per attempt, and no other learner's rows");

    const times = entries.map((entry) => entry.occurredAt.getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");

    const expected: Record<TimelineKind, { table: string; id: string }> = {
      reading: { table: "reading_attempts", id: seed.ids.reading },
      listening: { table: "listening_attempts", id: seed.ids.listening },
      writing: { table: "writing_submissions", id: seed.ids.writing },
      speaking: { table: "speaking_attempts", id: seed.ids.speaking },
      grammar: { table: "grammar_attempts", id: seed.ids.grammar },
      mock: { table: "mock_attempts", id: seed.ids.mock },
      assignment: { table: "assignment_responses", id: seed.ids.assignment },
    };
    for (const entry of entries)
      assert.deepEqual(entry.reference, expected[entry.kind], `${entry.kind} points at its own row`);

    const byKind = new Map(entries.map((entry) => [entry.kind, entry]));
    // Facts come from the attempt rows themselves, not from a copy.
    assert.equal(byKind.get("reading")!.facts.scoreEarned, 11);
    assert.equal(byKind.get("reading")!.facts.scoreTotal, 13);
    assert.equal(byKind.get("listening")!.facts.scoreEarned, 30);
    assert.equal(byKind.get("writing")!.facts.wordCount, 12);
    assert.equal(byKind.get("speaking")!.facts.hasRecording, true);
    assert.equal(byKind.get("speaking")!.facts.durationMs, 91_000);
    assert.equal(byKind.get("grammar")!.facts.isCorrect, true);
    assert.equal(byKind.get("mock")!.facts.band, 6.5);
    // The status word is the ASSIGNMENT's own vocabulary, read from `assignment_targets`.
    assert.equal(byKind.get("assignment")!.facts.status, "completed");
    assert.equal(byKind.get("assignment")!.assignmentId, seed.assignmentId);

    // Identity is resolved by reference, not copied: the pinned revision is named.
    const reading = byKind.get("reading")!.content!;
    assert.deepEqual(
      { versionId: reading.versionId, versionNo: reading.versionNo, module: reading.module, contentType: reading.contentType, sourceRef: reading.sourceRef },
      { versionId: seed.versions.readingVersion, versionNo: 1, module: "reading", contentType: "general_set", sourceRef: "timeline-reading" },
    );
    assert.equal(byKind.get("listening")!.content!.sourceRef, "timeline-listening");
    assert.equal(byKind.get("grammar")!.content!.contentType, "topic");
    assert.equal(byKind.get("mock")!.content!.versionId, seed.versions.readingVersion, "a mock binds the composition it started with");

    // Each entry names a place the learner can open, and the title is the domain's own.
    assert.equal(byKind.get("reading")!.href, `/reading/attempts/${seed.ids.reading}`);
    assert.equal(byKind.get("writing")!.title, "Discuss both views about homework.");
    assert.equal(byKind.get("speaking")!.title, "Quiet places");
  } finally {
    await database.close();
  }
});

test("TL2 the read is bounded, filterable by kind and by window", async () => {
  const database = await createTestDatabase();
  try {
    const seed = await seedTimeline(database);
    const db = database.db;

    assert.equal((await getAttemptTimeline(seed.learnerId, { limit: 2 }, db as never)).length, 2, "a page is a page");
    assert.equal((await getAttemptTimeline(seed.learnerId, { limit: 5_000 }, db as never)).length, 7, "a huge limit cannot exceed what exists");
    assert.equal((await getAttemptTimeline(seed.learnerId, { limit: 0 }, db as never)).length, 1, "limit is clamped, never zero queries returned");

    const readingOnly = await getAttemptTimeline(seed.learnerId, { kinds: ["reading"] }, db as never);
    assert.deepEqual(readingOnly.map((entry) => entry.kind), ["reading"], "a kind filter is a kind filter");

    const tasksOnly = await getAttemptTimeline(seed.learnerId, { kinds: ["writing", "assignment"] }, db as never);
    assert.deepEqual(tasksOnly.map((entry) => entry.kind).sort(), ["assignment", "writing"]);

    const window = await getAttemptTimeline(seed.learnerId, { from: new Date(Date.UTC(2026, 0, 10, 9, 9)), to: new Date(Date.UTC(2026, 0, 10, 9, 14)) }, db as never);
    assert.deepEqual(window.map((entry) => entry.kind).sort(), ["grammar", "speaking"], "the window keeps only what happened inside it");

    assert.equal(TIMELINE_MAX_LIMIT, 200);
  } finally {
    await database.close();
  }
});

test("TL3 it is a projection, not a second store: no timeline table, and the attempt stays the truth", async () => {
  const database = await createTestDatabase();
  try {
    const seed = await seedTimeline(database);

    // No timeline table exists anywhere in the schema.
    assert.doesNotMatch(read("src/db/schema.ts"), /timeline/i, "the timeline owns no table");
    const source = read("src/lib/data/attempt-timeline.ts");
    assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/, "the projection never writes");

    // Regrading the real attempt changes what the timeline reports — because the
    // timeline has no opinion of its own.
    await database.query(`update reading_attempts set score = 12, status = 'completed' where id = $1`, [seed.ids.reading]);
    const after = await getAttemptTimeline(seed.learnerId, { kinds: ["reading"] }, database.db as never);
    assert.equal(after[0]!.facts.scoreEarned, 12, "the projection follows the row");

    // Deleting learner work is the domain's decision, not the projection's: when the
    // row is gone the entry is gone, and nothing is resurrected from a copy.
    await database.query(`delete from reading_attempts where id = $1`, [seed.ids.reading]);
    const gone = await getAttemptTimeline(seed.learnerId, { kinds: ["reading"] }, database.db as never);
    assert.equal(gone.length, 0, "no shadow copy of a deleted attempt");
  } finally {
    await database.close();
  }
});

test("TL3b a region that cannot be read is skipped and REPORTED, never silently swallowed", async () => {
  const database = await createTestDatabase();
  try {
    const seed = await seedTimeline(database);
    // A REAL failure, not a mock: the Reading attempt table is unavailable. This is the
    // shape of a partial outage, and the other six skills must still be readable.
    await database.query("drop table reading_attempts cascade");

    const unavailable: string[] = [];
    const entries = await getAttemptTimeline(seed.learnerId, { onUnavailable: (kind) => unavailable.push(kind) }, database.db as never);
    assert.deepEqual(unavailable, ["reading"], "the failure is reported by name");
    assert.equal(entries.some((entry) => entry.kind === "reading"), false);
    assert.equal(entries.length, 6, "the other six regions are still shown");

    // Without a reporter the failure is not swallowed: a caller that asked for the whole
    // history is told it could not be produced rather than quietly handed a shorter one.
    await assert.rejects(() => getAttemptTimeline(seed.learnerId, {}, database.db as never));

    const route = read("src/app/api/history/route.ts");
    assert.match(route, /onUnavailable: \(kind\) => unavailable\.push\(kind\)/);
    assert.match(route, /unavailable/, "the response says which regions are missing");
  } finally {
    await database.close();
  }
});

test("TL4 one learner's timeline never contains another learner's rows, and the route refuses a forged id", async () => {
  const database = await createTestDatabase();
  try {
    const seed = await seedTimeline(database);
    const otherEntries = await getAttemptTimeline(seed.otherId, {}, database.db as never);
    assert.equal(otherEntries.length, 1, "the other learner has exactly their own attempt");
    assert.equal(otherEntries[0]!.kind, "reading");
    assert.equal(otherEntries[0]!.reference.id !== seed.ids.reading, true, "and it is not the first learner's row");

    const route = read("src/app/api/history/route.ts");
    assert.match(route, /if \(requested && requested !== user\.id\)/);
    assert.match(route, /status: 403/, "a forged userId is refused, not silently replaced");
    assert.match(route, /getLearnerTimeline\(user\.id/, "the route reads the actor's own id");
    assert.doesNotMatch(route, /isStaff\(/, "there is no second staff read path hidden in a query parameter");
  } finally {
    await database.close();
  }
});
