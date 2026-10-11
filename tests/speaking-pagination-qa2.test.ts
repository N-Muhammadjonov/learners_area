/*
 * §06 — PROOF THAT ALL 10 000 SYNTHETIC SPEAKING QUESTIONS REMAIN REACHABLE.
 *
 * The owner's decision was server-side pagination, part/topic discovery, search and on-demand study
 * support for Speaking Practice and Speaking Practice with AI, while preserving every eligible
 * question. Bounding a read is easy; bounding it WITHOUT stranding questions past the first page is
 * the actual requirement, and that is what this file proves against real PostgreSQL.
 *
 * These are SYNTHETIC questions in a disposable QA database, inserted and deleted here. They exist to
 * prove reachability and paging correctness at scale — they are NOT a measurement of the owner's
 * canonical bank, and nothing in this file is offered as a performance figure for a populated
 * production corpus. The canonical bank remains an owner asset.
 *
 * THE FIXTURE IS BUILT TO BREAK THE WRONG IMPLEMENTATION. Two lessons are baked into the timestamps,
 * because both were real defects in this repository's first bounded read:
 *
 *   1. `created_at` values carry MICROSECONDS that are not representable in JavaScript milliseconds
 *      (offsets of 7, 20, 33 … µs). A cursor built from a JS `Date` would round them away, the keyset
 *      would never advance, and every "next page" would return the same rows with hasMore still true —
 *      an infinite walk in which nothing past page one was reachable.
 *   2. Row `i` and row `i + 5000` share the SAME timestamp, so ordering ties are real and must be
 *      broken by the total order's last component (`id`). A cursor that is not total either duplicates
 *      rows or silently skips them, and only a walk that asserts "every id exactly once" can see that.
 *
 * A draft row is inserted too, to prove the bounded read still enforces publication rules rather than
 * trading them for speed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { after, before } from "node:test";
import pg from "pg";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";
import {
  SPEAKING_PROMPT_PAGE,
  SPEAKING_TOPIC_PAGE,
  findPublishedPromptSupport,
  listActivePrompts,
  listSpeakingPromptPage,
  speakingFacets,
} from "../src/lib/data/speaking-practice";

const PROBE = "speaking-pagination-qa2";
const QA2_RESIDUE_GUARD = process.env.QA2_DATABASE_TESTS === "1";
let qa2ResidueGuard: ResidueGuard | null = null;
before(async () => {
  if (!QA2_RESIDUE_GUARD) return;
  qa2ResidueGuard = await createResidueGuard(PROBE);
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard(PROBE, qa2ResidueGuard);
  qa2ResidueGuard = null;
});

const DATABASE_URL = process.env.DATABASE_URL;
const enabled =
  process.env.QA2_DATABASE_TESTS === "1" &&
  !!DATABASE_URL &&
  /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const skipReason = !enabled
  ? "set QA2_DATABASE_TESTS=1 with a LOCAL disposable DATABASE_URL (this test inserts 10 000 synthetic prompts)"
  : false;

/** Every synthetic row is identifiable by this prefix, so cleanup is exact and cannot touch real data. */
const MARKER = "QA-REACH-";
const TOTAL = 10_000;
const TOPICS = 40;

test("server-side speaking pagination keeps all 10 000 synthetic questions reachable", { skip: skipReason, timeout: 600_000 }, async (t) => {
  const db = new pg.Client({ connectionString: DATABASE_URL! });
  db.on("error", () => {});
  await db.connect();
  const count = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0]?.n ?? 0;
  const markerRows = () => count("select count(*)::int n from speaking_prompts where prompt_text like $1", [`${MARKER}%`]);

  try {
    await t.test("arrange: 10 000 synthetic published prompts, plus one draft that must stay hidden", async () => {
      const before = await markerRows();
      assert.equal(before, 0, "no synthetic rows may exist before this test creates them");

      // One statement, so every row shares the same now() and the microsecond offsets below are the
      // only thing distinguishing their timestamps — exactly the bulk-insert shape that broke the
      // first cursor implementation.
      await db.query(`
        insert into speaking_prompts (part, category, prompt_text, topic, available_in, created_at)
        select
          (array['part1','part2','part3'])[1 + (i % 3)]::speaking_part,
          (array['part1','part2','part3'])[1 + (i % 3)]::speaking_category,
          '${MARKER}' || lpad(i::text, 6, '0') || ' describe a time when traffic and careful planning mattered',
          '${MARKER}Topic ' || (i % ${TOPICS}),
          '["practice_alone","ai","live_partner"]'::jsonb,
          now() + (((i % 5000) * 13 + 7) || ' microseconds')::interval
        from generate_series(1, ${TOTAL}) i
      `);
      await db.query(`
        insert into speaking_prompts (part, category, prompt_text, topic, available_in, publication_state)
        values ('part1','part1','${MARKER}DRAFT must never surface','${MARKER}Topic 0','["practice_alone","ai","live_partner"]','draft')
      `);
      assert.equal(await markerRows(), TOTAL + 1, "the fixture must really hold 10 001 synthetic rows");

      // Prove the microsecond lesson is actually being exercised: if every timestamp were
      // millisecond-representable, this fixture could not catch a Date-rounded cursor.
      const nonMs = await count(`
        select count(*)::int n from speaking_prompts
        where prompt_text like $1
          and date_part('microsecond', created_at)::int % 1000 <> 0
      `, [`${MARKER}%`]);
      assert.ok(nonMs > 0, `${nonMs}: the fixture must contain sub-millisecond timestamps, or it cannot catch a rounded cursor`);
      const ties = await count(`
        select count(*)::int n from (
          select created_at from speaking_prompts where prompt_text like $1
          group by created_at having count(*) > 1
        ) dupes
      `, [`${MARKER}%`]);
      assert.ok(ties > 0, `${ties}: the fixture must contain duplicate timestamps, or it cannot catch a non-total order`);
    });

    await t.test("one page is bounded, and reports the true total", async () => {
      const page = await listSpeakingPromptPage({ channel: "practice_alone" });
      assert.equal(page.pageSize, SPEAKING_PROMPT_PAGE, "the page size must be the declared bound");
      assert.ok(page.prompts.length <= SPEAKING_PROMPT_PAGE, `returned ${page.prompts.length}, bound is ${SPEAKING_PROMPT_PAGE}`);
      assert.equal(page.hasMore, true, "10 000 prompts cannot fit one bounded page");
      assert.ok(page.nextCursor, "a bounded page with more behind it must hand back a continuation");
      assert.ok(page.matching >= TOTAL, `matching=${page.matching} must include all ${TOTAL} synthetic prompts`);
    });

    await t.test("walking the cursor reaches EVERY synthetic question exactly once", async () => {
      const seen = new Map<string, number>();
      let pages = 0;
      let cursor: string | null = null;
      let matching = 0;
      do {
        const page = await listSpeakingPromptPage({ channel: "practice_alone", ...(cursor ? { cursor } : {}) });
        matching = page.matching;
        pages += 1;
        assert.ok(page.prompts.length <= SPEAKING_PROMPT_PAGE, `page ${pages} exceeded the bound`);
        for (const prompt of page.prompts) {
          seen.set(prompt.id, (seen.get(prompt.id) ?? 0) + 1);
        }
        cursor = page.nextCursor;
        assert.ok(pages <= 400, `the walk did not terminate after ${pages} pages — a cursor that never advances loops forever`);
      } while (cursor);

      const duplicates = [...seen].filter(([, n]) => n > 1);
      assert.equal(duplicates.length, 0, `${duplicates.length} prompt(s) were served twice — the order is not total`);
      const synthetic = await db.query("select id from speaking_prompts where prompt_text like $1 and publication_state = 'published'", [`${MARKER}%`]);
      assert.equal(synthetic.rows.length, TOTAL, "the fixture must hold exactly 10 000 published synthetic prompts");
      for (const row of synthetic.rows) {
        assert.equal(seen.get(row.id), 1, `prompt ${row.id} was never reached — it is stranded past the bounded page`);
      }
      assert.equal(pages, Math.ceil(matching / SPEAKING_PROMPT_PAGE), `pages=${pages} must equal ceil(matching/pageSize) for matching=${matching}`);
    });

    await t.test("the bounded read is eligibility-equivalent to the unbounded one it replaces", async () => {
      // This is the assertion that matters most for "preserve all eligible questions": whatever the old
      // unbounded listActivePrompts returned, the paged walk must return the same set — no more, no less.
      const unbounded = await listActivePrompts("practice_alone");
      const unboundedIds = new Set(unbounded.map((p) => p.id));

      const paged = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await listSpeakingPromptPage({ channel: "practice_alone", ...(cursor ? { cursor } : {}) });
        for (const prompt of page.prompts) paged.add(prompt.id);
        cursor = page.nextCursor;
      } while (cursor);

      assert.equal(paged.size, unboundedIds.size, `paged ${paged.size} vs unbounded ${unboundedIds.size}`);
      const missing = [...unboundedIds].filter((id) => !paged.has(id));
      const extra = [...paged].filter((id) => !unboundedIds.has(id));
      assert.deepEqual(missing, [], `${missing.length} eligible prompt(s) lost by paging`);
      assert.deepEqual(extra, [], `${extra.length} prompt(s) surfaced that the unbounded read would not have`);
    });

    await t.test("the draft is never reachable, on any page", async () => {
      const draft = await db.query("select id from speaking_prompts where prompt_text = $1", [`${MARKER}DRAFT must never surface`]);
      assert.equal(draft.rows.length, 1, "the draft fixture must exist, or this proves nothing");
      const draftId = draft.rows[0].id as string;

      let cursor: string | null = null;
      let found = false;
      do {
        const page = await listSpeakingPromptPage({ channel: "practice_alone", ...(cursor ? { cursor } : {}) });
        if (page.prompts.some((p) => p.id === draftId)) found = true;
        cursor = page.nextCursor;
      } while (cursor && !found);
      assert.equal(found, false, "a draft surfaced to a learner through the paged read");

      const support = await findPublishedPromptSupport(draftId, "practice_alone");
      assert.equal(support, null, "on-demand study support must refuse a draft, not leak it by id");
    });

    await t.test("part discovery reports the true counts, not counts of one page", async () => {
      const facets = await speakingFacets({ channel: "practice_alone" });
      assert.ok(facets.matching >= TOTAL, `matching=${facets.matching}`);
      const summed = facets.parts.reduce((total, p) => total + p.count, 0);
      assert.equal(summed, facets.matching, "the per-part counts must sum to the reported total");

      for (const part of facets.parts) {
        const truth = await count(
          `select count(*)::int n from speaking_prompts
            where prompt_text like $1 and publication_state = 'published' and part = $2::speaking_part`,
          [`${MARKER}%`, part.part],
        );
        assert.ok(part.count >= truth, `${part.part}: facets reported ${part.count}, the corpus holds ${truth} synthetic rows`);
      }
      const part1 = facets.parts.find((p) => p.part === "part1");
      assert.ok(part1 && part1.count >= Math.floor(TOTAL / 3), `part1 count ${part1?.count} must reflect the whole corpus, not a page of it`);
    });

    await t.test("topic discovery lists every topic in a part, with true counts", async () => {
      const facets = await speakingFacets({ channel: "practice_alone", part: "part1" });
      assert.ok(facets.topics.length > 0, "part1 must report topics");
      assert.ok(facets.topics.length <= SPEAKING_TOPIC_PAGE, `topic page exceeded its bound of ${SPEAKING_TOPIC_PAGE}`);
      assert.equal(facets.topicCount, facets.topics.length, "with only 41 synthetic topics the discovery list must be complete, not truncated");

      const truth = await count(
        `select count(distinct case when topic is null or btrim(topic) = '' then '__untitled__' else lower(btrim(topic)) end)::int n
           from speaking_prompts where prompt_text like $1 and publication_state = 'published' and part = 'part1'`,
        [`${MARKER}%`],
      );
      const syntheticTopics = facets.topics.filter((tp) => tp.key.startsWith(MARKER.toLowerCase()));
      assert.equal(syntheticTopics.length, truth, `discovery found ${syntheticTopics.length} synthetic topics, the corpus holds ${truth}`);

      for (const topic of syntheticTopics.slice(0, 5)) {
        const expected = await count(
          `select count(*)::int n from speaking_prompts
            where prompt_text like $1 and publication_state = 'published' and part = 'part1'
              and case when topic is null or btrim(topic) = '' then '__untitled__' else lower(btrim(topic)) end = $2`,
          [`${MARKER}%`, topic.key],
        );
        assert.equal(topic.count, expected, `${topic.key}: reported ${topic.count}, holds ${expected}`);
      }
    });

    await t.test("narrowing to one part and topic reaches exactly that topic's questions", async () => {
      const facets = await speakingFacets({ channel: "practice_alone", part: "part2" });
      const topic = facets.topics.find((tp) => tp.key.startsWith(MARKER.toLowerCase()));
      assert.ok(topic, "the fixture must expose a synthetic topic in part2");

      const ids = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await listSpeakingPromptPage({ channel: "practice_alone", part: "part2", topic: topic!.key, ...(cursor ? { cursor } : {}) });
        for (const prompt of page.prompts) {
          ids.add(prompt.id);
          assert.equal(prompt.part, "part2", "a part filter must not leak another part");
        }
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(ids.size, topic!.count, `the narrowed walk reached ${ids.size}, discovery reported ${topic!.count}`);
    });

    await t.test("search narrows the bank but does NOT strand anything past page one", async () => {
      // Every synthetic prompt contains "traffic", so this term matches the whole fixture: the exact
      // case the Live Partner notes warn about, where a broad term matches more than one page and a
      // bounded response with no continuation would strand everything after the first page.
      const first = await listSpeakingPromptPage({ channel: "practice_alone", search: "traffic" });
      assert.ok(first.matching >= TOTAL, `a broad term matched ${first.matching}; the fixture holds ${TOTAL}`);
      assert.equal(first.prompts.length, SPEAKING_PROMPT_PAGE, "the response is still bounded");
      assert.ok(first.hasMore && first.nextCursor, "search must offer a continuation, or matches past page one are unreachable");

      const seen = new Set<string>();
      let cursor: string | null = first.nextCursor;
      for (const prompt of first.prompts) seen.add(prompt.id);
      let guard = 0;
      while (cursor) {
        const page = await listSpeakingPromptPage({ channel: "practice_alone", search: "traffic", cursor });
        for (const prompt of page.prompts) seen.add(prompt.id);
        cursor = page.nextCursor;
        assert.ok(++guard <= 400, "the search walk did not terminate");
      }
      assert.equal(seen.size, first.matching, `search reached ${seen.size} of ${first.matching} matches — the rest are stranded`);
    });

    await t.test("a search for one specific question finds it, wherever it sits in the corpus", async () => {
      // Prompt 9 999 is on the last page of an unbounded walk. If paging stranded the tail, this fails.
      const needle = `${MARKER}009999`;
      const page = await listSpeakingPromptPage({ channel: "practice_alone", search: needle });
      assert.equal(page.matching, 1, `expected exactly one match for ${needle}, got ${page.matching}`);
      assert.equal(page.prompts.length, 1);
      const only = page.prompts[0];
      assert.ok(only, "the single match must actually be returned");
      assert.match(only.promptText, /^QA-REACH-009999 /);
    });

    await t.test("the ai channel reaches its own eligible set, and refuses a bad cursor", async () => {
      const unbounded = await listActivePrompts("ai");
      const paged = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await listSpeakingPromptPage({ channel: "ai", ...(cursor ? { cursor } : {}) });
        for (const prompt of page.prompts) paged.add(prompt.id);
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(paged.size, unbounded.length, `ai channel: paged ${paged.size} vs unbounded ${unbounded.length}`);

      await assert.rejects(
        () => listSpeakingPromptPage({ channel: "practice_alone", cursor: "not-a-cursor-this-server-minted" }),
        /cursor/i,
        "a cursor this server did not mint must be refused, not silently restarted at page one",
      );
    });

    await t.test("study support is available on demand for one published prompt", async () => {
      const row = await db.query(
        "select id from speaking_prompts where prompt_text like $1 and publication_state = 'published' limit 1",
        [`${MARKER}%`],
      );
      const support = await findPublishedPromptSupport(row.rows[0].id as string, "practice_alone");
      assert.ok(support, "a published prompt's study support must be fetchable on its own");
      assert.equal(support!.id, row.rows[0].id);
      assert.ok("studySupport" in support!, "the payload must carry studySupport for the selected question only");
    });
  } finally {
    const removed = await db.query("delete from speaking_prompts where prompt_text like $1 returning id", [`${MARKER}%`]).catch(() => ({ rows: [] }));
    assert.equal(await markerRows(), 0, "every synthetic prompt must be removed, not left to inflate the next run");
    console.log(`#   ${PROBE}: deleted ${removed.rows.length} synthetic prompt(s)`);
    await db.end().catch(() => {});
  }
});
