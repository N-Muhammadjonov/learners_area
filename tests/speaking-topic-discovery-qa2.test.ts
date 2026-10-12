/*
 * §4.2 — TOPIC DISCOVERY REACHABILITY AND NORMALIZATION.
 *
 * TWO DEFECTS IN THE V17 FACETS CONTRACT, both proven here against real PostgreSQL before either is
 * fixed.
 *
 * DEFECT 1 — TOPICS PAST THE FIRST PAGE ARE UNREACHABLE. `speakingFacets` bounds its topic list with
 * `.limit(SPEAKING_TOPIC_PAGE + 1)` and reports the true `topicCount`, but hands back NO continuation.
 * A learner whose centre has authored more than 500 topics in one Part can see the first 500 and can
 * be told "1 200 topics exist", with no way to reach topic 501. Reporting a total you cannot navigate
 * to is worse than not reporting it: the UI looks complete. This is the same class of defect the
 * prompt pagination was built to avoid, left open one level up.
 *
 * DEFECT 2 — ONE NORMALIZED TOPIC SPLITS INTO CONFLICTING UI GROUPS. The V17 query grouped by BOTH the
 * normalized key AND the raw trimmed title:
 *
 *     .groupBy(TOPIC_KEY, nullif(btrim(topic), ''))
 *
 * `TOPIC_KEY` lowercases and trims, so `"Traffic"`, `"traffic"` and `"  traffic  "` all normalize to
 * the key `traffic` — but they carry three different raw titles, so the GROUP BY emits THREE rows with
 * the SAME key. A client rendering that list draws three buttons that all navigate to `?topic=traffic`,
 * each showing a different count, and none of them showing the true total for the topic. The counts
 * are individually correct and collectively wrong.
 *
 * The fixture is built to expose both: 1 200 distinct topics (so 501, 1 000 and the last one sit past
 * the page bound), and deliberate case/whitespace variants of the first topic (so a split group is
 * visible as duplicate keys with a fragmented count).
 *
 * Synthetic rows in a disposable QA database, inserted and deleted here, every one identifiable by the
 * QA-TOPIC marker. Nothing in this file is a measurement of the owner's canonical bank.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { after, before } from "node:test";
import pg from "pg";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";
import { SPEAKING_TOPIC_PAGE, speakingFacets } from "../src/lib/data/speaking-practice";

const PROBE = "speaking-topic-discovery-qa2";
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
  ? "set QA2_DATABASE_TESTS=1 with a LOCAL disposable DATABASE_URL (this test inserts a 1 200-topic fixture)"
  : false;

const MARKER = "QA-TOPIC-";
/** Deliberately more than SPEAKING_TOPIC_PAGE, so topic 501 and beyond sit past the first page. */
const TOPICS = 1_200;
const PART = "part1";
const topicKey = (i: number) => `${MARKER.toLowerCase()}${String(i).padStart(4, "0")}`;

test("topic discovery reaches every topic and never splits one normalized topic", { skip: skipReason, timeout: 600_000 }, async (t) => {
  const db = new pg.Client({ connectionString: DATABASE_URL! });
  db.on("error", () => {});
  await db.connect();
  const count = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0]?.n ?? 0;
  const markerRows = () => count("select count(*)::int n from speaking_prompts where prompt_text like $1", [`${MARKER}%`]);

  /*
   * The seeded demo bank already has prompts in this Part, including some with no topic at all, which
   * normalize to one `__untitled__` group. Discovery is corpus-wide and must include them, so every
   * total below is asserted as an exact DELTA against a baseline measured before the fixture is
   * inserted — not against a hardcoded number that silently assumes an otherwise empty table.
   */
  let baselineTopicCount = 0;
  const baselineKeys = new Set<string>();

  try {
    await t.test("arrange: 1 200 distinct topics, plus case/whitespace variants of the first", async () => {
      assert.equal(await markerRows(), 0, "no synthetic rows may pre-exist");

      const before = await speakingFacets({ channel: "practice_alone", part: PART });
      baselineTopicCount = before.topicCount;
      for (const topic of before.topics) baselineKeys.add(topic.key);
      assert.equal(baselineKeys.size, baselineTopicCount, "the seeded baseline must fit one page, or the delta arithmetic is unsound");

      // Two prompts per topic, so every topic count is a known 2.
      await db.query(`
        insert into speaking_prompts (part, category, prompt_text, topic, available_in)
        select '${PART}'::speaking_part, '${PART}'::speaking_category,
               '${MARKER}' || lpad(i::text, 4, '0') || ' q' || j || ' — describe an occasion that mattered',
               '${MARKER}' || lpad(i::text, 4, '0'),
               '["practice_alone","ai","live_partner"]'::jsonb
        from generate_series(1, ${TOPICS}) i, generate_series(1, 2) j
      `);
      // Case and whitespace variants of topic 1. All three normalize to the SAME key, so the true
      // count for that topic is 2 + 3 = 5 and it must appear as exactly ONE group.
      await db.query(`
        insert into speaking_prompts (part, category, prompt_text, topic, available_in)
        select '${PART}'::speaking_part, '${PART}'::speaking_category,
               '${MARKER}0001 variant ' || v || ' — same topic, different surface form',
               (array['${MARKER}0001', lower('${MARKER}0001'), '   ${MARKER}0001   '])[v],
               '["practice_alone","ai","live_partner"]'::jsonb
        from generate_series(1, 3) v
      `);

      const rows = await markerRows();
      assert.equal(rows, TOPICS * 2 + 3, `expected ${TOPICS * 2 + 3} synthetic rows, inserted ${rows}`);
      const distinctKeys = await count(
        `select count(distinct case when topic is null or btrim(topic) = '' then '__untitled__'
                                    else lower(btrim(topic)) end)::int n
           from speaking_prompts where prompt_text like $1`,
        [`${MARKER}%`],
      );
      assert.equal(distinctKeys, TOPICS, `the fixture must hold exactly ${TOPICS} distinct normalized topics, holds ${distinctKeys}`);
      assert.ok(![...baselineKeys].some((k) => k.startsWith(MARKER.toLowerCase())), "the seeded baseline must not collide with the fixture's topic keys");
      assert.ok(TOPICS > SPEAKING_TOPIC_PAGE, `the fixture must exceed the ${SPEAKING_TOPIC_PAGE} page bound or it cannot prove reachability past it`);
    });

    await t.test("one normalized topic is exactly one group, with its true total count", async () => {
      const facets = await speakingFacets({ channel: "practice_alone", part: PART });
      const groupsForTopic1 = facets.topics.filter((tp) => tp.key === topicKey(1));
      assert.equal(
        groupsForTopic1.length,
        1,
        `${groupsForTopic1.length} groups share the key ${topicKey(1)} — one normalized topic split into conflicting UI groups: ` +
          JSON.stringify(groupsForTopic1),
      );
      assert.equal(
        groupsForTopic1[0]?.count,
        5,
        `topic 1 holds 2 prompts plus 3 case/whitespace variants = 5; the group reported ${groupsForTopic1[0]?.count}`,
      );
      // No key may appear twice anywhere in the list, not just for topic 1.
      const keys = facets.topics.map((tp) => tp.key);
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      assert.deepEqual([...new Set(dupes)], [], `duplicate topic keys in one discovery response: ${[...new Set(dupes)].join(", ")}`);
    });

    await t.test("topicCount reports the true total, and the list is bounded", async () => {
      const facets = await speakingFacets({ channel: "practice_alone", part: PART });
      const expectedTotal = baselineTopicCount + TOPICS;
      assert.equal(facets.topicCount, expectedTotal, `topicCount must be the corpus-wide total ${expectedTotal} (seeded ${baselineTopicCount} + fixture ${TOPICS}), reported ${facets.topicCount}`);
      assert.ok(facets.topics.length <= SPEAKING_TOPIC_PAGE, `the response must stay bounded at ${SPEAKING_TOPIC_PAGE}, returned ${facets.topics.length}`);
      assert.ok(facets.topicCount > facets.topics.length, "the fixture must genuinely have more topics than one page, or the reachability test is vacuous");
    });

    await t.test("walking the topic cursor reaches topic 1, 500, 501, 1 000 and the last one", async () => {
      // This is the assertion that fails on the V17 contract: it returned no continuation at all, so
      // everything past the first page was simply unreachable through the intended journey.
      const reached = new Map<string, number>();
      let cursor: string | null | undefined = undefined;
      let pages = 0;
      let reportedTotal = 0;
      do {
        const facets = await speakingFacets({
          channel: "practice_alone",
          part: PART,
          ...(cursor ? { topicCursor: cursor } : {}),
        });
        reportedTotal = facets.topicCount;
        pages += 1;
        assert.ok(facets.topics.length <= SPEAKING_TOPIC_PAGE, `topic page ${pages} exceeded the bound`);
        for (const topic of facets.topics) {
          reached.set(topic.key, (reached.get(topic.key) ?? 0) + 1);
        }
        cursor = facets.nextTopicCursor ?? null;
        assert.ok(pages <= 50, `the topic walk did not terminate after ${pages} pages — a cursor that never advances loops forever`);
      } while (cursor);

      const expectedTotal = baselineTopicCount + TOPICS;
      assert.equal(reportedTotal, expectedTotal, `the walk must be told the true total ${expectedTotal}, got ${reportedTotal}`);
      assert.equal(reached.size, expectedTotal, `the walk reached ${reached.size} distinct topics, the corpus holds ${expectedTotal}`);
      for (const key of baselineKeys) {
        assert.ok(reached.has(key), `the seeded topic ${key} became unreachable once the fixture was added`);
      }
      const duplicates = [...reached].filter(([, n]) => n > 1);
      assert.deepEqual(duplicates, [], `${duplicates.length} topic(s) served twice — the topic order is not total`);

      // The specific topics the owner named, plus the very last one.
      for (const i of [1, 500, 501, 1_000, TOPICS]) {
        assert.ok(reached.has(topicKey(i)), `topic ${i} (${topicKey(i)}) was never reachable`);
        assert.equal(reached.get(topicKey(i)), 1, `topic ${i} reached ${reached.get(topicKey(i))} times, must be exactly once`);
      }
      assert.equal(
        pages,
        Math.ceil((baselineTopicCount + TOPICS) / SPEAKING_TOPIC_PAGE),
        `pages=${pages} must equal ceil(${baselineTopicCount + TOPICS}/${SPEAKING_TOPIC_PAGE})`,
      );

      // Every topic's count must survive the walk intact.
      const truth = await db.query(
        `select case when topic is null or btrim(topic) = '' then '__untitled__' else lower(btrim(topic)) end as key,
                count(*)::int as n
           from speaking_prompts where prompt_text like $1
          group by 1`,
        [`${MARKER}%`],
      );
      const reachedCounts = new Map<string, number>();
      cursor = undefined;
      do {
        const facets = await speakingFacets({ channel: "practice_alone", part: PART, ...(cursor ? { topicCursor: cursor } : {}) });
        for (const topic of facets.topics) reachedCounts.set(topic.key, topic.count);
        cursor = facets.nextTopicCursor ?? null;
      } while (cursor);
      for (const row of truth.rows) {
        assert.equal(reachedCounts.get(row.key as string), row.n as number, `topic ${row.key} reported ${reachedCounts.get(row.key as string)}, holds ${row.n}`);
      }
    });

    await t.test("a forged topic cursor is refused, not silently restarted at the first page", async () => {
      await assert.rejects(
        () => speakingFacets({ channel: "practice_alone", part: PART, topicCursor: "not-a-cursor-this-server-minted" }),
        /cursor/i,
        "a topic cursor this server did not mint must be refused; restarting at page 1 would re-serve topics already shown",
      );
    });

    await t.test("topic discovery still narrows by search and reports a bounded page", async () => {
      // Searching for a topic name that matches every fixture topic must still be navigable.
      const facets = await speakingFacets({ channel: "practice_alone", part: PART, search: MARKER });
      assert.ok(facets.topics.length > 0, "a search matching the fixture must return topics");
      assert.ok(facets.topics.length <= SPEAKING_TOPIC_PAGE, "search results stay bounded too");
      assert.ok(facets.topicCount >= TOPICS, `search must still report at least the ${TOPICS} fixture topics, got ${facets.topicCount}`);
      assert.ok(facets.nextTopicCursor, "a search with more topics behind it must offer a continuation");
    });
  } finally {
    const removed = await db.query("delete from speaking_prompts where prompt_text like $1 returning id", [`${MARKER}%`]).catch(() => ({ rows: [] }));
    assert.equal(await markerRows(), 0, "every synthetic prompt must be removed");
    console.log(`#   ${PROBE}: deleted ${removed.rows.length} synthetic prompt(s)`);
    await db.end().catch(() => {});
  }
});
