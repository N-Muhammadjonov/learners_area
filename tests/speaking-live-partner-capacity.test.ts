import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { listLivePartnerQuestions } from "../src/lib/data/speaking-practice";

/**
 * C-OPEN-03 regression.
 *
 * The Live Partner room loaded the whole question pool with a bare `.limit(1500)` and
 * filtered it in the BROWSER. Two problems: every learner downloaded the entire bank
 * just to read a handful of prompts, and once a centre authored more than 1500 live
 * prompts the later ones never reached the client at all — they could not be found by
 * searching, because the search only ever saw what had already been shipped.
 *
 * The read must stay bounded AND every published prompt must remain findable, which
 * means narrowing has to happen on the server.
 */
test("live-partner prompts stay bounded yet every prompt remains findable", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listLivePartnerQuestions>[1];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const total = 1620;
    for (let i = 1; i <= total; i += 1) {
      await query(
        `insert into speaking_prompts
           (part,category,prompt_text,topic,available_in,publication_state,publish_at,external_id)
         values('part1','part1',$1,$2,'["live_partner"]'::jsonb,'published',now() - interval '1 day',$3)`,
        [`Describe scenario ${String(i).padStart(5, "0")}`, `Topic ${String(i).padStart(5, "0")}`, `ext-${String(i).padStart(5, "0")}`],
      );
    }

    // A draft prompt must never leak into the room, however we page.
    await query(
      `insert into speaking_prompts
         (part,category,prompt_text,topic,available_in,publication_state,external_id)
       values('part1','part1','Unpublished scenario','Secret topic','["live_partner"]'::jsonb,'draft','ext-draft')`,
    );

    const page = await listLivePartnerQuestions({}, db);
    assert.ok(page.questions.length <= 500, `page not bounded: ${page.questions.length}`);
    assert.equal(page.hasMore, true, "more prompts exist than were returned, unreported");
    assert.equal(page.matching, total, "the true published prompt count must be reported");
    assert.ok(
      !page.questions.some((q) => q.promptText.includes("Unpublished")),
      "a draft prompt leaked into the live-partner room",
    );

    // A prompt far past the old 1500 ceiling must still be findable by searching.
    const late = await listLivePartnerQuestions({ search: "scenario 01601" }, db);
    assert.equal(late.questions.length, 1, "prompt 1601 could not be found");
    assert.match(late.questions[0]!.promptText, /01601/);

    const last = await listLivePartnerQuestions({ search: `scenario ${String(total).padStart(5, "0")}` }, db);
    assert.equal(last.questions.length, 1, "the final seeded prompt could not be found");

    // Searching by topic works too, and never surfaces drafts.
    const byTopic = await listLivePartnerQuestions({ search: "Topic 01601" }, db);
    assert.equal(byTopic.questions.length, 1);
    const secret = await listLivePartnerQuestions({ search: "Secret topic" }, db);
    assert.equal(secret.questions.length, 0, "search exposed an unpublished prompt");

    // Bounded, duplicate-free, stably ordered.
    const broad = await listLivePartnerQuestions({ search: "scenario" }, db);
    assert.ok(broad.questions.length <= 500, "search result is not bounded");
    const ids = broad.questions.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate prompts in one page");
    const again = await listLivePartnerQuestions({ search: "scenario" }, db);
    assert.deepEqual(again.questions.map((q) => q.id), ids, "ordering is not stable");

    const none = await listLivePartnerQuestions({ search: "no-such-prompt-xyz" }, db);
    assert.equal(none.questions.length, 0);
    assert.equal(none.hasMore, false);
    assert.equal(none.matching, 0);
  } finally {
    await close();
  }
});
