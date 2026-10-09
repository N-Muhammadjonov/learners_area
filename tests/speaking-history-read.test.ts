import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { listAttempts } from "../src/lib/data/speaking-practice";

/**
 * §08 E2: the Speaking history read.
 *
 * listAttempts() resolved prompt references with `where: undefined` — it selected the
 * ENTIRE speaking_prompts table to label at most 100 attempts, so the learner's
 * history page cost grew with the size of the prompt bank instead of with their own
 * history, and it pulled drafts and archived prompts the page never shows.
 *
 * BOUNDEDNESS IS PROVED BY MEASUREMENT, NOT BY THIS TEST: see
 * scripts/measure-speaking-history-read.mjs, which runs EXPLAIN ANALYZE against the
 * real QA Postgres (2006 rows / Seq Scan -> 12 rows / Bitmap Heap Scan). What this
 * test pins is the CORRECTNESS the narrowing must not break — the association, the
 * ownership boundary, and the missing-prompt case.
 */
test("history resolves each attempt to its own prompt, and only this learner's attempts", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listAttempts>[1];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [mine] = await query<{ id: string }>("insert into users(name,role)values('Speak A','student')returning id");
    const [theirs] = await query<{ id: string }>("insert into users(name,role)values('Speak B','student')returning id");

    // A bank far larger than the history that references it.
    const promptIds: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const [row] = await query<{ id: string }>(
        `insert into speaking_prompts(part,category,prompt_text,topic,publication_state)
         values('part1','general',$1,$2,$3)returning id`,
        [`Prompt ${i}`, `Topic ${i}`, i % 5 === 0 ? "draft" : "published"],
      );
      promptIds.push(row!.id);
    }

    // This learner's attempts point at three DIFFERENT prompts, including a draft one
    // (an attempt recorded before the prompt was unpublished must still be labelled).
    const referenced = [promptIds[0]!, promptIds[7]!, promptIds[39]!];
    for (const id of referenced) {
      await query("insert into speaking_attempts(user_id,prompt_id,part)values($1,$2,'part1')", [mine!.id, id]);
    }
    // One attempt whose prompt no longer exists.
    await query("insert into speaking_attempts(user_id,prompt_id,part)values($1,null,'part1')", [mine!.id]);
    // Another learner's attempt, which must never surface here.
    await query("insert into speaking_attempts(user_id,prompt_id,part)values($1,$2,'part1')", [theirs!.id, promptIds[1]!]);

    const attempts = await listAttempts({ userId: mine!.id }, db);

    assert.equal(attempts.length, 4, "the learner's own attempts, and only those");
    assert.ok(attempts.every((a) => a.userId === mine!.id), "another learner's attempt leaked into this history");

    // Each attempt must carry ITS OWN prompt — a narrowed read that mixed up the
    // mapping would still return the right number of rows.
    for (const attempt of attempts) {
      if (attempt.promptId === null) {
        assert.equal(attempt.prompt, null, "an attempt with no prompt must resolve to null, not a stray row");
        continue;
      }
      assert.ok(attempt.prompt, `attempt ${attempt.id} lost its prompt`);
      assert.equal(attempt.prompt!.id, attempt.promptId, "attempt resolved to the WRONG prompt");
    }
    const labelled = attempts.filter((a) => a.prompt).map((a) => a.prompt!.id).sort();
    assert.deepEqual(labelled, [...referenced].sort(), "the resolved prompts are not the referenced ones");

    // A draft prompt an attempt references is still resolved: publication governs what
    // can be PRACTISED, not whether finished work can be named in history.
    const draft = attempts.find((a) => a.promptId === promptIds[0]);
    assert.equal(draft?.prompt?.publicationState, "draft", "an attempt on a now-unpublished prompt lost its label");

    // Single-attempt lookup resolves identically.
    const one = await listAttempts({ attemptId: attempts[0]!.id }, db);
    assert.equal(one.length, 1);
    assert.equal(one[0]!.prompt?.id ?? null, attempts[0]!.promptId);
  } finally {
    await close();
  }
});
