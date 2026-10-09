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

/**
 * C-OPEN-03 second edge.
 *
 * Server-side search narrows the bank but does not make it reachable. One broad term
 * ("scenario") legitimately matches every prompt a centre has authored, so with a
 * bounded page and no continuation the room can still only ever reach the first 500 —
 * exactly the defect the first fix was meant to remove, just moved behind a search box.
 * A keyset cursor over the existing deterministic order is the bounded way out.
 */
async function seedPrompts(
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>,
  count: number,
  opts: { externalId?: boolean } = {},
) {
  for (let i = 1; i <= count; i += 1) {
    const ext = opts.externalId === false ? null : `ext-${String(i).padStart(5, "0")}`;
    await query(
      `insert into speaking_prompts
         (part,category,prompt_text,topic,available_in,publication_state,publish_at,external_id)
       values('part1','part1',$1,$2,'["live_partner"]'::jsonb,'published',now() - interval '1 day',$3)`,
      [`Describe scenario ${String(i).padStart(5, "0")}`, `Topic ${String(i).padStart(5, "0")}`, ext],
    );
  }
}

test("a broad live-partner search is fully walkable by cursor without duplicates or omissions", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listLivePartnerQuestions>[1];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const total = 1620;
    await seedPrompts(query, total);
    await query(
      `insert into speaking_prompts
         (part,category,prompt_text,topic,available_in,publication_state,external_id)
       values('part1','part1','Unpublished scenario','Secret topic','["live_partner"]'::jsonb,'draft','ext-draft')`,
    );

    // "scenario" matches all 1620 published prompts: far more than one page.
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listLivePartnerQuestions({ search: "scenario", ...(cursor ? { cursor } : {}) }, db);
      assert.ok(page.questions.length <= page.pageSize, "a page must stay bounded");
      assert.equal(page.matching, total, "matching must describe the same predicate on every page");
      assert.ok(
        !page.questions.some((q) => q.promptText.includes("Unpublished")),
        "a draft prompt leaked while paging",
      );
      seen.push(...page.questions.map((q) => q.id));
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages <= 20, "the cursor walk must terminate");
    } while (cursor);

    assert.ok(pages > 3, "1620 matches must span several pages, or this proves nothing");
    assert.equal(seen.length, total, "every matching prompt must be reachable by paging");
    assert.equal(new Set(seen).size, total, "no prompt may be served twice across pages");
  } finally {
    await close();
  }
});

test("a live-partner cursor walk reproduces the unpaginated order exactly", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listLivePartnerQuestions>[1];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    // Mixed external ids: NULL is legal for hand-authored prompts, and a sort key that
    // can be NULL is exactly where a naive keyset comparison silently drops rows.
    await seedPrompts(query, 700);
    await seedPrompts(query, 80, { externalId: false });

    const truth = await query<{ id: string }>(
      `select id from speaking_prompts
        where publication_state = 'published'
        order by part, (external_id is null), external_id, created_at, id`,
    );

    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listLivePartnerQuestions({ ...(cursor ? { cursor } : {}) }, db);
      walked.push(...page.questions.map((q) => q.id));
      cursor = page.nextCursor;
    } while (cursor);

    assert.equal(walked.length, truth.length, "the walk must visit every published prompt once");
    assert.deepEqual(walked, truth.map((r) => r.id), "paging must not reorder or drop prompts");
  } finally {
    await close();
  }
});

test("the final live-partner page reports no continuation", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listLivePartnerQuestions>[1];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    await seedPrompts(query, 12);
    const page = await listLivePartnerQuestions({}, db);
    assert.equal(page.questions.length, 12);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null, "a complete result must not advertise another page");
  } finally {
    await close();
  }
});

test("a malformed live-partner cursor is refused rather than silently returning page 1", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof listLivePartnerQuestions>[1];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    await seedPrompts(query, 5);
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const malformed: Array<[string, string]> = [
      ["undecodable", "not-a-cursor"],
      ["valid base64, not JSON", Buffer.from("<<<", "utf8").toString("base64url")],
      ["object, not a tuple", b64({ part: "part1" })],
      ["tuple too short", b64(["part1", false, "ext"])],
      ["tuple too long", b64(["part1", false, "ext", "2024-01-01T00:00:00.000Z", "id", "extra"])],
      ["wrong member types", b64([1, "no", 2, 3, 4])],
      ["unknown enum member", b64(["part9", false, "ext", "2024-01-01T00:00:00.000Z", "00000000-0000-0000-0000-000000000000"])],
      ["empty string", ""],
    ];
    for (const [label, cursor] of malformed) {
      await assert.rejects(
        () => listLivePartnerQuestions({ cursor }, db),
        /cursor/i,
        `a bad cursor (${label}) must not quietly return page 1`,
      );
    }
  } finally {
    await close();
  }
});
