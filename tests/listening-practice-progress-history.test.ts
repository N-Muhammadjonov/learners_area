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
