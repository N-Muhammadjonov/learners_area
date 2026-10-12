import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { listeningPracticeProgress } from "../src/lib/data/full-listening";

/**
 * C-OPEN-04 regression.
 *
 * `listeningPracticeProgress` derives per-practice-kind completion from the learner's
 * run history. It used to read only the 200 most recent runs, so a practice kind the
 * learner genuinely COMPLETED could be forgotten once 200 newer runs existed for the
 * same test — the hub would then invite them to redo finished work and would drop the
 * graded score. Completion must be computed from authoritative history, not from an
 * arbitrary recent-run window.
 */
test("a completed practice kind survives beyond the 200 most recent runs", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query, close } = database as unknown as {
      db: Parameters<typeof listeningPracticeProgress>[2];
      query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
      close: () => Promise<void>;
    };
    void close;

    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('Practice QA','student')returning id",
    );
    const [other] = await query<{ id: string }>(
      "insert into users(name,role)values('Other QA','student')returning id",
    );
    const [testRow] = await query<{ id: string }>(
      "insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'Practice test','audio','draft')returning id",
      [user!.id],
    );
    const [otherTest] = await query<{ id: string }>(
      "insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'Other test','audio','draft')returning id",
      [user!.id],
    );
    for (const t of [testRow!.id, otherTest!.id]) {
      await query(
        "insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/audio.mp3',$4)",
        [t, t, JSON.stringify({ questions: [] }), "0".repeat(64)],
      );
    }

    const base = Date.now() - 400 * 60_000;
    const at = (i: number) => new Date(base + i * 60_000).toISOString();

    // The OLDEST run is a genuine completion of "map".
    await query(
      `insert into listening_activity_runs(user_id,test_id,activity,answers,score,total,completed,created_at)
       values($1,$2,4,$3,9,10,true,$4)`,
      [user!.id, testRow!.id, JSON.stringify({ _practice: "map", "1": "a" }), at(0)],
    );

    // ...then 250 newer runs of a DIFFERENT kind bury it well past any 200-row window.
    for (let i = 1; i <= 250; i += 1) {
      await query(
        `insert into listening_activity_runs(user_id,test_id,activity,answers,score,total,completed,created_at)
         values($1,$2,4,$3,null,null,false,$4)`,
        [user!.id, testRow!.id, JSON.stringify({ _practice: "form", n: String(i) }), at(i)],
      );
    }

    // Contamination controls: another user and another test must never bleed in.
    await query(
      `insert into listening_activity_runs(user_id,test_id,activity,answers,score,total,completed,created_at)
       values($1,$2,4,$3,10,10,true,$4)`,
      [other!.id, testRow!.id, JSON.stringify({ _practice: "sentence" }), at(300)],
    );
    await query(
      `insert into listening_activity_runs(user_id,test_id,activity,answers,score,total,completed,created_at)
       values($1,$2,4,$3,10,10,true,$4)`,
      [user!.id, otherTest!.id, JSON.stringify({ _practice: "diagram" }), at(301)],
    );

    const progress = await listeningPracticeProgress(user!.id, testRow!.id, db);

    assert.equal(progress.map?.complete, true, "the old completed practice was forgotten");
    assert.equal(progress.map?.latest.score, 9, "the graded score of the completed run was lost");
    assert.equal(progress.form?.complete, false, "an unfinished kind must not be marked complete");
    assert.equal(
      progress.form?.latest.answers.n,
      "250",
      "`latest` must still be the most recent run of that kind",
    );
    assert.equal(progress.sentence, undefined, "another learner's run leaked in");
    assert.equal(progress.diagram, undefined, "another test's run leaked in");

    const empty = await listeningPracticeProgress(other!.id, otherTest!.id, db);
    assert.deepEqual(empty, {}, "a learner with no history must get an empty map");
  } finally {
    await (database as unknown as { close: () => Promise<void> }).close();
  }
});

/**
 * C-OPEN-04 second edge: a newer UNFINISHED run of the SAME kind must not erase the
 * score the learner already earned.
 *
 * `bool_or(completed)` fixed "did they ever finish it", but the hub read the grade from
 * `latest`, which is the most recent run regardless of completion. Starting a second
 * "map" run and abandoning it therefore left the learner with
 * `complete = true` and a blank score: the result they had earned disappeared.
 *
 * Completion, resume state and the earned grade are three different questions, so the
 * reader now answers all three: `complete` (ever finished), `latest` (what to resume)
 * and `latestCompleted` (the last finished, graded run).
 */
test("a newer unfinished run of the same kind does not erase the earned score", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listeningPracticeProgress>[2];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('Grade QA','student')returning id",
    );
    const [testRow] = await query<{ id: string }>(
      "insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'Grade test','audio','draft')returning id",
      [user!.id],
    );
    await query(
      "insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/audio.mp3',$4)",
      [testRow!.id, testRow!.id, JSON.stringify({ questions: [] }), "1".repeat(64)],
    );

    const base = Date.now() - 400 * 60_000;
    const at = (i: number) => new Date(base + i * 60_000).toISOString();

    // An old, COMPLETED and graded "map" run.
    await query(
      `insert into listening_activity_runs(user_id,test_id,activity,answers,score,total,completed,created_at)
       values($1,$2,4,$3,9,10,true,$4)`,
      [user!.id, testRow!.id, JSON.stringify({ _practice: "map", "1": "a" }), at(0)],
    );
    // 250 newer UNFINISHED runs of the SAME kind.
    for (let i = 1; i <= 250; i += 1) {
      await query(
        `insert into listening_activity_runs(user_id,test_id,activity,answers,score,total,completed,created_at)
         values($1,$2,4,$3,null,null,false,$4)`,
        [user!.id, testRow!.id, JSON.stringify({ _practice: "map", "1": "b" }), at(i)],
      );
    }

    const progress = await listeningPracticeProgress(user!.id, testRow!.id, db);
    const map = progress.map;
    assert.ok(map, "the map practice must be reported");
    assert.equal(map!.complete, true, "it was completed once, so it stays complete");
    assert.equal(map!.latest.completed, false, "the newest attempt is the unfinished one, for resuming");
    assert.ok(map!.latestCompleted, "the last COMPLETED run must still be reachable");
    assert.equal(map!.latestCompleted!.score, 9, "the earned score must survive");
    assert.equal(map!.latestCompleted!.total, 10);
  } finally {
    await close();
  }
});

test("a kind that was never completed reports no completed run", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listeningPracticeProgress>[2];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('NoGrade QA','student')returning id",
    );
    const [testRow] = await query<{ id: string }>(
      "insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'NoGrade test','audio','draft')returning id",
      [user!.id],
    );
    await query(
      "insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/audio.mp3',$4)",
      [testRow!.id, testRow!.id, JSON.stringify({ questions: [] }), "2".repeat(64)],
    );
    await query(
      `insert into listening_activity_runs(user_id,test_id,activity,answers,score,total,completed,created_at)
       values($1,$2,4,$3,null,null,false,now())`,
      [user!.id, testRow!.id, JSON.stringify({ _practice: "map" })],
    );
    const progress = await listeningPracticeProgress(user!.id, testRow!.id, db);
    assert.equal(progress.map!.complete, false);
    assert.equal(progress.map!.latestCompleted, null, "no completed run means no graded result");
  } finally {
    await close();
  }
});

test("the last completed run is the newest completed one, with a deterministic tie-break", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listeningPracticeProgress>[2];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('Tie QA','student')returning id",
    );
    const [testRow] = await query<{ id: string }>(
      "insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'Tie test','audio','draft')returning id",
      [user!.id],
    );
    await query(
      "insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/audio.mp3',$4)",
      [testRow!.id, testRow!.id, JSON.stringify({ questions: [] }), "3".repeat(64)],
    );
    const stamp = new Date(Date.now() - 60_000).toISOString();
    // Two completed runs at the SAME instant: the result must still be deterministic.
    for (const score of [5, 7]) {
      await query(
        `insert into listening_activity_runs(user_id,test_id,activity,answers,score,total,completed,created_at)
         values($1,$2,4,$3,$4,10,true,$5)`,
        [user!.id, testRow!.id, JSON.stringify({ _practice: "map" }), score, stamp],
      );
    }
    const a = await listeningPracticeProgress(user!.id, testRow!.id, db);
    const b = await listeningPracticeProgress(user!.id, testRow!.id, db);
    assert.ok(a.map!.latestCompleted);
    assert.equal(a.map!.latestCompleted!.id, b.map!.latestCompleted!.id, "same answer every time");
  } finally {
    await close();
  }
});

test("an empty history reports nothing at all", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listeningPracticeProgress>[2];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('Empty QA','student')returning id",
    );
    const [testRow] = await query<{ id: string }>(
      "insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'Empty test','audio','draft')returning id",
      [user!.id],
    );
    await query(
      "insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/audio.mp3',$4)",
      [testRow!.id, testRow!.id, JSON.stringify({ questions: [] }), "4".repeat(64)],
    );
    const progress = await listeningPracticeProgress(user!.id, testRow!.id, db);
    assert.deepEqual(progress, {});
  } finally {
    await close();
  }
});

/**
 * Section 06 C4: latest attempt, latest completed, latest graded, last earned score
 * and resumable are FIVE different questions, and the hub must not confuse them.
 *
 * `latestCompleted` fixed the case where a newer UNFINISHED run blanked an earned
 * score. It left the same bug one step along: `score` is nullable and a completed run
 * can legitimately carry no grade (the activity route stores score = null for a
 * finished study-pack activity), so finishing an UNGRADED run would blank the score
 * too — a completed activity showing no result.
 */
test("a newer completed-but-UNGRADED run does not erase the last earned grade", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listeningPracticeProgress>[2];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('Ungraded QA','student')returning id",
    );
    const [testRow] = await query<{ id: string }>(
      "insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'Ungraded test','audio','draft')returning id",
      [user!.id],
    );
    await query(
      "insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/audio.mp3',$4)",
      [testRow!.id, testRow!.id, JSON.stringify({ questions: [] }), "2".repeat(64)],
    );

    const base = Date.now() - 400 * 60_000;
    const at = (i: number) => new Date(base + i * 60_000).toISOString();
    const run = (kind: string, i: number, score: number | null, total: number | null, completed: boolean) =>
      query(
        `insert into listening_activity_runs(user_id,test_id,activity,answers,score,total,completed,created_at)
         values($1,$2,4,$3,$4,$5,$6,$7)`,
        [user!.id, testRow!.id, JSON.stringify({ _practice: kind, "1": "a" }), score, total, completed, at(i)],
      );

    // Earned 9/10, then finished a later run that carries NO grade.
    await run("map", 0, 9, 10, true);
    await run("map", 5, null, null, true);
    // A third kind that has only ever been completed without a grade.
    await run("gap", 1, null, null, true);
    // A fourth kind: graded once, then an unfinished newer attempt (the earlier fix).
    await run("mcq", 0, 7, 10, true);
    await run("mcq", 9, null, null, false);

    const progress = await listeningPracticeProgress(user!.id, testRow!.id, db);

    const map = progress.map;
    assert.ok(map, "the map practice must be reported");
    assert.equal(map!.complete, true, "it was completed, so it stays complete");
    // THE POINT: the displayed grade is the last EARNED one, not the latest completed.
    assert.ok(map!.latestGraded, "the last graded run must still be reachable");
    assert.equal(map!.latestGraded!.score, 9, "the earned score was erased by an ungraded completion");
    assert.equal(map!.latestGraded!.total, 10);
    // ...while the other two questions keep their own, different answers.
    assert.equal(map!.latestCompleted!.score, null, "latestCompleted must still mean the newest completed run");
    assert.equal(map!.latest.completed, true, "latest must still mean the newest run of any state");

    // Never completed with a grade => no grade is invented.
    const gap = progress.gap;
    assert.ok(gap, "the gap practice must be reported");
    assert.equal(gap!.complete, true, "it was completed");
    assert.equal(gap!.latestGraded, null, "a grade must never be invented for an ungraded kind");
    assert.ok(gap!.latestCompleted, "but it is still a completed run");

    // The earlier contract still holds alongside the new one.
    const mcq = progress.mcq;
    assert.ok(mcq, "the mcq practice must be reported");
    assert.equal(mcq!.latest.completed, false, "the newest attempt is the unfinished one, for resuming");
    assert.equal(mcq!.latestGraded!.score, 7, "an unfinished newer run must not erase the earned score either");
  } finally {
    await close();
  }
});
