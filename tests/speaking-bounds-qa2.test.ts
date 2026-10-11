/*
 * §03 — BOUNDED READS MUST NOT GROW WITH THE BANK.
 *
 * This is a measurement AND a guard. Measuring once and writing the numbers into a document proves
 * nothing about the next change; asserting the bound makes a regression fail loudly.
 *
 * The before/after is measured on the SAME corpus at three sizes — 100, 1 000 and 10 000 prompts — by
 * calling both the old unbounded reader (`listActivePrompts`, which both learner-facing pages used to
 * embed directly into the client payload) and the new bounded readers (`speakingFacets` for part counts
 * and topic discovery, `listSpeakingPromptPage` for one page of questions), plus the on-demand
 * `findPublishedPromptSupport` and the server-side `selectExaminerScript`.
 *
 * ── WHAT THESE BYTE FIGURES ARE, AND WHAT THEY ARE NOT ────────────────────────────────────────────
 * The fixture's `study_support` and `follow_ups` are EMPTY, which is the default for a synthetic row.
 * So these bytes measure the shape of the payload — how many rows travel — and NOT the weight of real
 * authored content. The historical 6.15 MB figure was measured over HTTP against a page payload with
 * React escaping and is not reproducible from a synthetic bank; the two are reported separately and
 * neither is substituted for the other. A populated canonical bank would multiply the OLD figure far
 * more than the NEW one, because the old path ships study support for every question while the new path
 * ships it for the single question the learner opened — but that multiplier is NOT measured here and is
 * deliberately not invented.
 *
 * Synthetic rows in a disposable QA database, inserted and deleted here.
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
  selectExaminerScript,
  speakingFacets,
} from "../src/lib/data/speaking-practice";

const PROBE = "speaking-bounds-qa2";
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
  process.env.QA2_DATABASE_TESTS === "1" && !!DATABASE_URL && /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const skipReason = !enabled ? "set QA2_DATABASE_TESTS=1 with a LOCAL disposable DATABASE_URL" : false;

const MARKER = "QA-BOUND-";
const SIZES = [100, 1_000, 10_000] as const;
/** One topic per ten questions, so the topic page (500) saturates at 5 000 prompts and beyond. */
const topicsFor = (size: number) => Math.max(1, Math.floor(size / 10));
/*
 * A deliberately over-full topic, so a genuinely FULL question page can be measured. Without it the
 * "after" figure would be whatever the first topic happened to hold — a few rows — which understates the
 * worst case an initial view can transfer and makes the improvement look better than it is.
 */
const FULL_TOPIC_ROWS = 120;
const FULL_TOPIC = `${MARKER}FULL`;

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;

type Measure = {
  size: number;
  oldRows: number;
  oldBytes: number;
  oldMs: number;
  newRows: number;
  newBytes: number;
  worstRows: number;
  worstBytes: number;
  facetsMs: number;
  topicsMs: number;
  searchMs: number;
  pageMs: number;
  supportMs: number;
  supportBytes: number;
  scriptMs: number;
  scriptRows: number;
  topicCount: number;
};

test("bounded speaking reads stay constant while the unbounded read grows with the bank", { skip: skipReason, timeout: 900_000 }, async (t) => {
  const db = new pg.Client({ connectionString: DATABASE_URL! });
  db.on("error", () => {});
  await db.connect();
  const markerRows = async () =>
    (await db.query("select count(*)::int n from speaking_prompts where prompt_text like $1", [`${MARKER}%`])).rows[0]?.n ?? 0;
  const results: Measure[] = [];

  try {
    for (const size of SIZES) {
      await t.test(`arrange ${size} prompts`, async () => {
        assert.equal(await markerRows(), 0, "no synthetic rows may pre-exist");
        /*
         * `part` is the speaking_part enum and `category` is a DIFFERENT enum (speaking_category), and a
         * CASE expression yields text, which Postgres will not implicitly coerce into either. Both are
         * cast explicitly. Getting this wrong failed loudly rather than quietly measuring an empty
         * fixture, because the row count is asserted immediately afterwards.
         */
        await db.query(`
          insert into speaking_prompts (part, category, prompt_text, topic, available_in)
          select p::speaking_part, p::speaking_category,
                 '${MARKER}' || lpad(i::text,5,'0') || ' — an ordinary IELTS question',
                 '${MARKER}T' || lpad(((i - 1) / 10)::text, 5, '0'),
                 '["practice_alone","ai","live_partner"]'::jsonb
          from (
            select i, case (i % 3) when 0 then 'part1' when 1 then 'part2' else 'part3' end as p
            from generate_series(1, ${size}) i
          ) rows
        `);
        // One saturated topic on top of the distributed corpus.
        await db.query(`
          insert into speaking_prompts (part, category, prompt_text, topic, available_in)
          select 'part1'::speaking_part, 'part1'::speaking_category,
                 '${MARKER}FULL ' || lpad(i::text,5,'0') || ' — a question in one very long topic',
                 '${FULL_TOPIC}', '["practice_alone","ai","live_partner"]'::jsonb
          from generate_series(1, ${FULL_TOPIC_ROWS}) i
        `);
        assert.equal(await markerRows(), size + FULL_TOPIC_ROWS, `expected ${size + FULL_TOPIC_ROWS} synthetic prompts`);
        /*
         * The byte figures below are only interpretable if the heavy fields really are empty. Note the
         * column DEFAULT is a populated-shaped object ({"vocabularyHtml":"", …}), not '{}', so comparing
         * the raw jsonb text would have flagged every row as "heavy" and failed for the wrong reason.
         * What matters is that no authored CONTENT is present.
         */
        const heavy = await db.query(
          `select count(*)::int n from speaking_prompts
            where prompt_text like $1 and (
                   coalesce(study_support->>'vocabularyHtml', '') <> ''
                or coalesce(study_support->>'modelAnswerHtml', '') <> ''
                or coalesce(study_support->>'ideasHtml', '') <> ''
                or jsonb_array_length(coalesce(study_support->'vocabulary', '[]'::jsonb)) > 0
                or jsonb_array_length(coalesce(follow_ups, '[]'::jsonb)) > 0
            )`,
          [`${MARKER}%`],
        );
        assert.equal(heavy.rows[0].n, 0, "study_support/follow_ups must carry no authored CONTENT, or these bytes would misrepresent a populated bank");
      });

      await t.test(`measure ${size} prompts`, async () => {
        // ── BEFORE: what both learner pages used to embed whole into the client payload ───────────
        const oldStart = performance.now();
        const oldPrompts = await listActivePrompts("practice_alone");
        const oldMs = performance.now() - oldStart;
        const oldRows = oldPrompts.length;
        const oldBytes = bytes(oldPrompts);

        // ── AFTER, initial view: part counts + the first topic page (no topic chosen yet) ─────────
        const facetsStart = performance.now();
        const facets = await speakingFacets({ channel: "practice_alone" });
        const facetsMs = performance.now() - facetsStart;

        // ── AFTER, topic discovery for a part ────────────────────────────────────────────────────
        const topicsStart = performance.now();
        const topics = await speakingFacets({ channel: "practice_alone", part: "part1" });
        const topicsMs = performance.now() - topicsStart;

        // ── AFTER, server-side search ────────────────────────────────────────────────────────────
        const searchStart = performance.now();
        const searched = await speakingFacets({ channel: "practice_alone", part: "part1", search: `${MARKER}T00001` });
        const searchMs = performance.now() - searchStart;

        // ── AFTER, one bounded page of questions ─────────────────────────────────────────────────
        const topic = topics.topics[0]?.key ?? null;
        assert.ok(topic, "a populated part must expose at least one topic");
        const pageStart = performance.now();
        const page = await listSpeakingPromptPage({ channel: "practice_alone", part: "part1", topic });
        const pageMs = performance.now() - pageStart;

        // ── AFTER, study support for the ONE selected question ───────────────────────────────────
        const selected = page.prompts[0];
        assert.ok(selected, "the first question page must not be empty");
        const supportStart = performance.now();
        const support = await findPublishedPromptSupport(selected.id, "practice_alone");
        const supportMs = performance.now() - supportStart;

        // ── AFTER, the AI examiner draw ──────────────────────────────────────────────────────────
        const scriptStart = performance.now();
        const script = await selectExaminerScript({ mode: "full", channel: "ai" });
        const scriptMs = performance.now() - scriptStart;

        // ── AFTER, WORST CASE: a saturated topic page plus a full question page ──────────────────
        const fullPage = await listSpeakingPromptPage({ channel: "practice_alone", part: "part1", topic: FULL_TOPIC.toLowerCase() });
        assert.equal(fullPage.prompts.length, SPEAKING_PROMPT_PAGE,
          `the saturated topic must return a FULL ${SPEAKING_PROMPT_PAGE}-row page, got ${fullPage.prompts.length}`);
        assert.equal(fullPage.hasMore, true, "a saturated topic must report that more questions exist");
        const worstRows = facets.parts.length + Math.min(topics.topics.length, SPEAKING_TOPIC_PAGE) + fullPage.prompts.length;
        const worstBytes = bytes(facets) + bytes(topics) + bytes(fullPage);

        const newRows = facets.parts.length + facets.topics.length;
        const newBytes = bytes(facets) + bytes(page);
        results.push({
          size, oldRows, oldBytes, oldMs, newRows, newBytes, worstRows, worstBytes, facetsMs, topicsMs, searchMs, pageMs,
          supportMs, supportBytes: bytes(support ?? null), scriptMs, scriptRows: script.length,
          topicCount: topics.topicCount,
        });

        console.log(
          `#   ${PROBE} @ ${String(size).padStart(5)} prompts | BEFORE rows ${String(oldRows).padStart(5)} bytes ${kb(oldBytes).padStart(9)} ${oldMs.toFixed(1).padStart(7)} ms` +
          ` | AFTER rows ${String(newRows).padStart(4)} bytes ${kb(newBytes).padStart(9)}` +
          ` | AFTER worst-case rows ${String(worstRows).padStart(4)} bytes ${kb(worstBytes).padStart(9)}` +
          ` | facets ${facetsMs.toFixed(1)}ms topics ${topicsMs.toFixed(1)}ms search ${searchMs.toFixed(1)}ms page ${pageMs.toFixed(1)}ms` +
          ` | support ${supportMs.toFixed(1)}ms/${kb(bytes(support ?? null))} script ${scriptMs.toFixed(1)}ms/${script.length} rows` +
          ` | topicCount ${topics.topicCount}`,
        );

        // ── the bounds themselves ────────────────────────────────────────────────────────────────
        assert.equal(oldRows >= size, true, `the unbounded reader must return the whole bank (${oldRows} < ${size})`);
        assert.ok(facets.topics.length <= SPEAKING_TOPIC_PAGE, `topic page exceeded its ${SPEAKING_TOPIC_PAGE} bound`);
        assert.ok(page.prompts.length <= SPEAKING_PROMPT_PAGE, `question page exceeded its ${SPEAKING_PROMPT_PAGE} bound`);
        assert.ok(page.pageSize === SPEAKING_PROMPT_PAGE, "the page size must be the declared bound");
        // The initial view transfers part counts + one topic page + one question page, and nothing else.
        assert.ok(newRows <= 4 + SPEAKING_TOPIC_PAGE + SPEAKING_PROMPT_PAGE,
          `initial rows ${newRows} exceeded the constant bound ${4 + SPEAKING_TOPIC_PAGE + SPEAKING_PROMPT_PAGE}`);
        assert.equal(topics.topicCount >= topicsFor(size), true,
          `topicCount ${topics.topicCount} under-reports the ${topicsFor(size)} topics in the bank`);
        if (topicsFor(size) > SPEAKING_TOPIC_PAGE) {
          // The cap must be enforced AND advertised: a bounded list with no continuation is worse than
          // no bound at all, because the UI looks complete while later topics are unreachable.
          assert.equal(topics.topics.length, SPEAKING_TOPIC_PAGE, `the topic page must stop at its ${SPEAKING_TOPIC_PAGE} cap`);
          assert.equal(topics.hasMoreTopics, true, "a truncated topic page must report that more exist");
          assert.ok(topics.nextTopicCursor, "a truncated topic page must offer a continuation cursor");
        }
        assert.ok(searched.topics.length > 0, "a search matching a real topic must return it");
        assert.ok(script.length > 0, "the AI draw must return a script from a populated bank");
        assert.ok(script.length <= 9, `the AI script must stay bounded, got ${script.length} rows`);
      });

      await t.test(`cleanup ${size} prompts`, async () => {
        const removed = await db.query("delete from speaking_prompts where prompt_text like $1 returning id", [`${MARKER}%`]);
        assert.equal(removed.rows.length, size + FULL_TOPIC_ROWS, `expected to delete ${size + FULL_TOPIC_ROWS} rows`);
        assert.equal(await markerRows(), 0, "every synthetic prompt must be removed");
      });
    }

    await t.test("the unbounded payload grows with the bank; the bounded one does not", async () => {
      const at = (size: number) => {
        const found = results.find((r) => r.size === size);
        assert.ok(found, `no measurement for ${size}`);
        return found;
      };
      const small = at(100), mid = at(1_000), large = at(10_000);

      /*
       * BEFORE: the unbounded reader must grow one-for-one with the bank. The fixture carries a fixed
       * overhead — the deliberately saturated topic plus the seeded demo prompts — so a RATIO against the
       * smallest size is dominated by that overhead (44x rather than 100x) and proves nothing either way.
       * The DELTA is the honest linearity test: 9 000 more prompts must mean 9 000 more rows returned.
       */
      assert.ok(large.oldRows - mid.oldRows >= 0.98 * (large.size - mid.size),
        `adding ${large.size - mid.size} prompts returned only ${large.oldRows - mid.oldRows} more rows — the reader is not tracking the bank`);
      assert.ok(mid.oldRows - small.oldRows >= 0.98 * (mid.size - small.size),
        `adding ${mid.size - small.size} prompts returned only ${mid.oldRows - small.oldRows} more rows`);
      assert.ok(large.oldBytes > 8 * mid.oldBytes,
        `a 10x larger bank produced only ${(large.oldBytes / mid.oldBytes).toFixed(2)}x the bytes (${kb(mid.oldBytes)} -> ${kb(large.oldBytes)})`);

      // AFTER: rows are bounded by a CONSTANT at every size — this is the property that matters most,
      // because it cannot drift with content weight or corpus size.
      const bound = 4 + SPEAKING_TOPIC_PAGE + SPEAKING_PROMPT_PAGE;
      for (const measure of results) {
        assert.ok(measure.newRows <= bound, `@${measure.size}: initial rows ${measure.newRows} exceeded ${bound}`);
      }
      /*
       * The bounded payload is capped by a CONSTANT that does not depend on the bank: both pages have
       * hard limits, so past saturation the initial view cannot grow at all. Note the honest shape of
       * this — between 1 000 and 10 000 prompts the topic list does still grow (100 topics -> the 500
       * cap), so a flat-bytes assertion across those two sizes would be wrong. What must hold is that it
       * grows strictly slower than the bank, and that it stops growing once the cap is reached.
       */
      const newGrowth = large.newBytes / Math.max(mid.newBytes, 1);
      const oldGrowth = large.oldBytes / Math.max(mid.oldBytes, 1);
      assert.ok(newGrowth < oldGrowth,
        `the bounded payload grew ${newGrowth.toFixed(2)}x from 1 000 to 10 000 prompts while the unbounded one grew ${oldGrowth.toFixed(2)}x — it is tracking the bank`);
      assert.ok(large.newBytes < large.oldBytes / 20,
        `at 10 000 prompts the bounded payload (${kb(large.newBytes)}) must be a small fraction of the unbounded one (${kb(large.oldBytes)})`);
      // Past saturation the cap is what bounds it, and continuation must exist rather than being lost.
      assert.equal(large.topicCount >= topicsFor(large.size), true,
        `topicCount must report the true total (${large.topicCount} vs ${topicsFor(large.size)}) even though only one page is returned`);

      // Study support is fetched for ONE question whatever the bank holds.
      for (const measure of results) {
        assert.ok(measure.supportBytes < 4096,
          `@${measure.size}: study support for one question was ${kb(measure.supportBytes)} — it must not carry the bank`);
      }
      // The worst case is the honest headline: a saturated topic page AND a full question page.
      assert.ok(large.worstBytes < large.oldBytes / 20,
        `at 10 000 prompts even the WORST-CASE bounded view (${kb(large.worstBytes)}) must be a small fraction of the unbounded one (${kb(large.oldBytes)})`);
      assert.ok(large.worstRows <= 4 + SPEAKING_TOPIC_PAGE + SPEAKING_PROMPT_PAGE,
        `worst-case initial rows ${large.worstRows} exceeded the constant bound`);
      const worstGrowth = large.worstBytes / Math.max(mid.worstBytes, 1);
      assert.ok(worstGrowth < oldGrowth,
        `the worst-case bounded view grew ${worstGrowth.toFixed(2)}x while the bank grew ${oldGrowth.toFixed(2)}x`);
      console.log(
        `#   ${PROBE} SUMMARY | unbounded ${kb(small.oldBytes)} -> ${kb(mid.oldBytes)} -> ${kb(large.oldBytes)} (grows with the bank)` +
        ` | bounded typical ${kb(small.newBytes)} -> ${kb(mid.newBytes)} -> ${kb(large.newBytes)}` +
        ` | bounded WORST-CASE ${kb(small.worstBytes)} -> ${kb(mid.worstBytes)} -> ${kb(large.worstBytes)} (capped by page limits, not by the bank)` +
        ` | rows ${small.oldRows}/${large.oldRows} vs worst-case ${small.worstRows}/${large.worstRows}`,
      );
      console.log(`#   ${PROBE} NOTE: study_support and follow_ups were EMPTY in this fixture; these bytes measure payload SHAPE, not authored content weight.`);
    });
  } finally {
    const removed = await db.query("delete from speaking_prompts where prompt_text like $1 returning id", [`${MARKER}%`]).catch(() => ({ rows: [] }));
    assert.equal(await markerRows(), 0, "every synthetic prompt must be removed");
    if (removed.rows.length > 0) console.log(`#   ${PROBE}: swept ${removed.rows.length} leftover synthetic prompt(s)`);
    await db.end().catch(() => {});
  }
});
