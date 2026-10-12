/*
 * §05 — BOUNDED SERVER-AUTHORITATIVE EXAM SELECTION MUST STAY UNBIASED AND FAITHFUL.
 *
 * Moving the examiner's draw from the browser to the server creates two ways to get it wrong, and both
 * are silent:
 *
 *   1. BIAS / STRANDED QUESTIONS. If the server sampled only the first bounded page, every exam would
 *      draw from whichever prompts happen to sort first and the rest of the corpus could never appear.
 *      This is the failure mode §05 forbids outright, and it would look like a passing feature: exams
 *      still get built, they just always contain the same early questions.
 *   2. SEMANTIC DRIFT. `buildExaminerScript` had specific behaviour — uniform over topic GROUPS then
 *      within a group, Part 1/3 taking the first N of a topic in listing order, Part 2 drawing one cue
 *      card, Part 3 preferring the cue card's own topic. A reimplementation that quietly changed any of
 *      those would change what learners are asked without anyone deciding that.
 *
 * So `buildExaminerScript` is kept as the REFERENCE ORACLE and the server draw is asserted against it,
 * rather than the server version being trusted because it compiles.
 *
 * The fixture is shaped to make bias detectable: 300 Part 1 topics holding ONE question each, which is
 * three times the bounded prompt page (100). If selection were limited to a first page, topics past the
 * 100th could never be drawn — and the reachability assertion below is exactly that.
 *
 * Synthetic rows in a disposable QA database, inserted and deleted here. Not a measurement of the
 * owner's canonical bank.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { after, before } from "node:test";
import pg from "pg";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";
import { SPEAKING_PROMPT_PAGE, selectExaminerScript } from "../src/lib/data/speaking-practice";
import { PART1_QUESTIONS, PART3_QUESTIONS, buildExaminerScript, type AiMode } from "../src/lib/speaking/ai-session";
import { topicKey } from "../src/lib/speaking/practice-browse";

const PROBE = "speaking-ai-script-qa2";
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
  ? "set QA2_DATABASE_TESTS=1 with a LOCAL disposable DATABASE_URL"
  : false;

const MARKER = "QA-AI-";
/** Three times the bounded page, so a first-page-only implementation cannot reach the tail. */
const P1_TOPICS = 300;
const P2_TOPICS = 20;
const P2_PER_TOPIC = 3;
const P3_PER_TOPIC = 5;
const TRIALS = 90;

const p1Topic = (i: number) => `${MARKER}P1-${String(i).padStart(4, "0")}`;
const p2Topic = (i: number) => `${MARKER}P2-${String(i).padStart(4, "0")}`;

test("the server examiner draw is unbiased, faithful and eligibility-correct", { skip: skipReason, timeout: 600_000 }, async (t) => {
  const db = new pg.Client({ connectionString: DATABASE_URL! });
  db.on("error", () => {});
  await db.connect();
  const count = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0]?.n ?? 0;
  const markerRows = () => count("select count(*)::int n from speaking_prompts where prompt_text like $1", [`${MARKER}%`]);

  /*
   * The reference implementation's input must be the SAME universe the server draws from — every
   * published, ai-eligible prompt, seeded demo rows included, not just this test's fixture. Comparing
   * the server against a fixture-only corpus is unsound in both directions: the server can legitimately
   * draw a seeded topic, and a seeded Part 1 topic holding two questions produces a script shape the
   * fixture-only reference can never produce. The first draft of this test made exactly that mistake and
   * failed intermittently depending on whether a seeded topic happened to be drawn.
   */
  type Row = { id: string; part: string; topic: string | null; promptText: string; cueCard: string | null; prepSeconds: number; answerSeconds: number };
  let corpus: Row[] = [];
  /** The subset this test inserted, so fixture-specific assertions can be made without assuming an empty table. */
  let fixtureIds = new Set<string>();
  let fixturePart1Topics = new Set<string>();
  let draftId = "";

  try {
    await t.test("arrange: a corpus three times the page bound, plus a draft that must never appear", async () => {
      assert.equal(await markerRows(), 0, "no synthetic rows may pre-exist");

      // Part 1: one question per topic, so a drawn topic yields exactly one question — which makes the
      // set of drawn topics directly observable across trials.
      await db.query(`
        insert into speaking_prompts (part, category, prompt_text, topic, available_in)
        select 'part1','part1', '${MARKER}p1 ' || lpad(i::text,4,'0') || ' — where do you live?',
               '${p1Topic(0).replace(/0000$/, "")}' || lpad(i::text,4,'0'),
               '["practice_alone","ai","live_partner"]'::jsonb
        from generate_series(1, ${P1_TOPICS}) i
      `);
      // Part 2: several cue cards per topic, so drawing within a topic is observable.
      await db.query(`
        insert into speaking_prompts (part, category, prompt_text, topic, cue_card, available_in)
        select 'part2','part2', '${MARKER}p2 ' || lpad(i::text,4,'0') || '-' || j || ' — describe a place',
               '${p2Topic(0).replace(/0000$/, "")}' || lpad(i::text,4,'0'),
               'You should say: what, where, when, and explain why it mattered.',
               '["practice_alone","ai","live_partner"]'::jsonb
        from generate_series(1, ${P2_TOPICS}) i, generate_series(1, ${P2_PER_TOPIC}) j
      `);
      // Part 3: one topic per Part 2 topic, so the "prefer the cue card's topic" rule can always apply.
      await db.query(`
        insert into speaking_prompts (part, category, prompt_text, topic, available_in)
        select 'part3','part3', '${MARKER}p3 ' || lpad(i::text,4,'0') || '-' || j || ' — how has this changed?',
               '${p2Topic(0).replace(/0000$/, "")}' || lpad(i::text,4,'0'),
               '["practice_alone","ai","live_partner"]'::jsonb
        from generate_series(1, ${P2_TOPICS}) i, generate_series(1, ${P3_PER_TOPIC}) j
      `);
      // A draft in Part 1: it must be invisible to the draw.
      const draft = await db.query(`
        insert into speaking_prompts (part, category, prompt_text, topic, available_in, publication_state)
        values ('part1','part1','${MARKER}DRAFT must never be asked','${p1Topic(0).replace(/0000$/, "")}0001',
                '["practice_alone","ai","live_partner"]'::jsonb,'draft')
        returning id
      `);
      draftId = draft.rows[0].id as string;

      const rows = await db.query(
        `select id, part::text as part, topic, prompt_text, cue_card, prep_seconds, answer_seconds
           from speaking_prompts
          where publication_state = 'published'
            and (available_in @> '["ai"]'::jsonb or available_in @> '["practice_alone"]'::jsonb)
          order by part, created_at, id`,
      );
      corpus = rows.rows.map((r) => ({
        id: r.id as string,
        part: r.part as string,
        topic: r.topic as string | null,
        promptText: r.prompt_text as string,
        cueCard: r.cue_card as string | null,
        prepSeconds: r.prep_seconds as number,
        answerSeconds: r.answer_seconds as number,
      }));
      const expectedFixture = P1_TOPICS + P2_TOPICS * P2_PER_TOPIC + P2_TOPICS * P3_PER_TOPIC;
      fixtureIds = new Set(corpus.filter((row) => row.promptText.startsWith(MARKER)).map((row) => row.id));
      fixturePart1Topics = new Set(
        corpus.filter((row) => row.part === "part1" && row.promptText.startsWith(MARKER)).map((row) => row.topic ?? ""),
      );
      assert.equal(fixtureIds.size, expectedFixture, `expected ${expectedFixture} published synthetic prompts, found ${fixtureIds.size}`);
      assert.ok(corpus.length > fixtureIds.size, "the corpus must also contain the seeded demo prompts, or the comparison is against an unrealistically empty bank");
      assert.equal(await markerRows(), expectedFixture + 1, "the draft must exist too, or its exclusion proves nothing");
      assert.ok(P1_TOPICS > SPEAKING_PROMPT_PAGE, `the Part 1 corpus must exceed the ${SPEAKING_PROMPT_PAGE} page bound or bias is undetectable`);
    });

    await t.test("every script is eligibility-correct, draft-free and carries recorder timings", async () => {
      const publishedIds = new Set(corpus.map((row) => row.id));
      for (const mode of ["full", "part1", "part2", "part3"] as AiMode[]) {
        const script = await selectExaminerScript({ mode, channel: "ai" });
        assert.ok(script.length > 0, `${mode}: a populated corpus must produce a script`);
        for (const prompt of script) {
          // Published and ai-eligible — the whole corpus, seeded rows included. "Invented" means absent
          // from it, not merely absent from this test's fixture.
          assert.ok(publishedIds.has(prompt.id), `${mode}: script contains ${prompt.id}, which is not a published ai-eligible prompt`);
          assert.notEqual(prompt.id, draftId, `${mode}: the DRAFT prompt was selected`);
          // §5.1: the recorder drives its timers from these two, so a script without them is unusable.
          assert.equal(typeof prompt.prepSeconds, "number", `${mode}: prepSeconds missing from the script contract`);
          assert.equal(typeof prompt.answerSeconds, "number", `${mode}: answerSeconds missing from the script contract`);
          assert.ok(prompt.answerSeconds > 0, `${mode}: answerSeconds must be a real timer length`);
        }
        const ids = script.map((p) => p.id);
        assert.equal(new Set(ids).size, ids.length, `${mode}: the script repeated a question`);
      }
    });

    await t.test("script shape matches the reference implementation for every mode", async () => {
      // The reference over the same corpus, sampled many times, enumerates the shapes it can produce.
      const referenceShapes = new Map<AiMode, Set<string>>();
      for (const mode of ["full", "part1", "part2", "part3"] as AiMode[]) {
        const shapes = new Set<string>();
        for (let i = 0; i < 400; i += 1) {
          const script = buildExaminerScript(corpus, mode);
          shapes.add(script.map((p) => p.part).join(","));
        }
        referenceShapes.set(mode, shapes);
      }
      /*
       * Deterministic comparison, not a sampled one. Seeded demo rows make some shapes rare — a seeded
       * Part 2 cue card has no matching Part 3 topic, so Part 3 falls back and may land on the single
       * seeded Part 3 question, giving a shape a 400-sample reference sweep can easily miss. Comparing
       * against a sampled shape set therefore fails intermittently for a reason that is NOT a defect,
       * which is worse than not comparing at all. So: when the whole script is fixture rows the shape is
       * fully determined and is asserted exactly; when it reaches a seeded row, the invariants that still
       * hold are asserted instead.
       */
      const fixtureShapes = new Map<AiMode, Set<string>>();
      const fixtureOnly = corpus.filter((row) => row.promptText.startsWith(MARKER));
      for (const mode of ["full", "part1", "part2", "part3"] as AiMode[]) {
        const shapes = new Set<string>();
        for (let i = 0; i < 200; i += 1) shapes.add(buildExaminerScript(fixtureOnly, mode).map((p) => p.part).join(","));
        fixtureShapes.set(mode, shapes);
      }
      let exactCompared = 0;
      for (const mode of ["full", "part1", "part2", "part3"] as AiMode[]) {
        const allowed = fixtureShapes.get(mode)!;
        assert.equal(allowed.size, 1, `${mode}: the fixture corpus is homogeneous, so the reference must produce exactly one shape (got ${[...allowed].join(" | ")})`);
        for (let trial = 0; trial < 12; trial += 1) {
          const script = await selectExaminerScript({ mode, channel: "ai" });
          const shape = script.map((p) => p.part).join(",");
          const allFixture = script.every((p) => fixtureIds.has(p.id));
          if (allFixture) {
            assert.ok(allowed.has(shape), `${mode}: server shape "${shape}" is not the reference's ${[...allowed].join(",")}`);
            exactCompared += 1;
          } else {
            // Reached a seeded row: assert what must hold regardless of which topic was drawn.
            assert.equal(script.filter((p) => p.part === "part2").length <= 1, true, `${mode}: at most one cue card`);
            assert.ok(script.filter((p) => p.part === "part1").length <= PART1_QUESTIONS, `${mode}: Part 1 exceeds its cap`);
            const p3 = script.filter((p) => p.part === "part3").map((p) => topicKey(p.topic));
            assert.ok(new Set(p3).size <= 1, `${mode}: Part 3 must come from a single topic, got ${p3.join(", ")}`);
            assert.ok(allowed.size > 0, `${mode}: the reference produced no shape`);
          }
          assert.ok(referenceShapes.get(mode)!.size > 0, `${mode}: the whole-corpus reference produced no shape`);
        }
      }
      assert.ok(exactCompared > 0, "no trial drew an entirely fixture script, so the exact shape comparison never ran");
      // Part counts must match the documented constants exactly.
      const full = await selectExaminerScript({ mode: "full", channel: "ai" });
      const part1 = full.filter((p) => p.part === "part1");
      assert.ok(part1.length >= 1 && part1.length <= PART1_QUESTIONS, `Part 1 must yield 1..${PART1_QUESTIONS} questions, got ${part1.length}`);
      if (part1.every((p) => fixturePart1Topics.has(p.topic ?? ""))) {
        // Every fixture Part 1 topic holds exactly one question, so drawing one yields exactly one.
        assert.equal(part1.length, 1, "a fixture Part 1 topic holds one question, so the script must contain one");
      }
      assert.equal(full.filter((p) => p.part === "part2").length, 1, "Part 2 is exactly one cue card");
      /*
       * Part 3 yields exactly min(PART3_QUESTIONS, P3_PER_TOPIC) ONLY when the discussion questions come
       * from a fixture topic, each of which holds P3_PER_TOPIC questions. When the drawn cue card is a
       * SEEDED topic, no fixture Part 3 topic matches it and the documented fallback picks a random
       * Part 3 topic from the whole corpus — the seeded bank holds exactly ONE Part 3 prompt, so one
       * question is then the CORRECT answer, not a defect.
       *
       * A single unconditional trial asserted the fixture-only expectation against a corpus-wide draw and
       * failed roughly one full-suite run in ten (QA2 run 1 green, run 2 red on this line). This is the
       * third assertion in this file to make that same mistake, so the conditional form — assert exactly
       * when the draw is fixture-only, assert the documented range otherwise, and require that the exact
       * branch actually ran — is now the pattern throughout.
       */
      let exactPart3 = 0;
      for (let trial = 0; trial < 20; trial += 1) {
        const script = await selectExaminerScript({ mode: "full", channel: "ai" });
        const discussion = script.filter((p) => p.part === "part3");
        assert.ok(discussion.length >= 1 && discussion.length <= PART3_QUESTIONS,
          `Part 3 must yield 1..${PART3_QUESTIONS} questions, got ${discussion.length}`);
        if (discussion.every((p) => fixtureIds.has(p.id))) {
          assert.equal(discussion.length, Math.min(PART3_QUESTIONS, P3_PER_TOPIC),
            "a fixture Part 3 topic holds P3_PER_TOPIC questions, so the script must take up to PART3_QUESTIONS of them");
          exactPart3 += 1;
        }
      }
      assert.ok(exactPart3 > 0, "no trial drew fixture Part 3 questions, so the exact count was never actually asserted");
      assert.ok(PART1_QUESTIONS >= 1, "sanity: the Part 1 constant is used by both implementations");
      // Order mirrors the interview: Part 1, then the cue card, then discussion.
      const parts = full.map((p) => p.part);
      assert.deepEqual(parts, [...parts].sort((a, b) => a.localeCompare(b)), `script order must be part1 → part2 → part3, got ${parts.join(",")}`);
    });

    await t.test("Part 3 prefers the Part 2 cue card's own topic", async () => {
      // Every fixture Part 2 topic has a matching Part 3 topic, so whenever one is drawn the preference
      // must apply: a fallback to a random Part 3 topic would be indistinguishable from ignoring the cue.
      let matched = 0;
      for (let trial = 0; trial < 40; trial += 1) {
        const script = await selectExaminerScript({ mode: "full", channel: "ai" });
        const cue = script.find((p) => p.part === "part2");
        const discussion = script.filter((p) => p.part === "part3");
        assert.ok(cue, "a full script must contain a cue card");
        assert.ok(discussion.length > 0, "a full script must contain discussion questions");
        const cueKey = topicKey(cue!.topic);
        /*
         * The preference is asserted only when the corpus actually HAS Part 3 questions on the cue's
         * topic. Every fixture Part 2 topic does; a seeded Part 2 topic need not, and there the
         * documented fallback to a random Part 3 topic is correct behaviour, not a defect. Checking
         * existence first is what keeps this assertion honest instead of accidentally demanding a match
         * the reference implementation never promised.
         */
        const hasMatchingDiscussion = corpus.some((row) => row.part === "part3" && topicKey(row.topic) === cueKey);
        if (!hasMatchingDiscussion) continue;
        for (const prompt of discussion) {
          assert.equal(topicKey(prompt.topic), cueKey, `Part 3 asked about "${prompt.topic}" while the cue card was "${cue!.topic}"`);
        }
        matched += 1;
      }
      assert.ok(matched > 0, "no trial drew a cue card with matching Part 3 questions, so the preference was never actually tested");
    });

    await t.test("Part 1 selection reaches topics far past the first bounded page", async () => {
      /*
       * This is the assertion that catches the forbidden shortcut. Every Part 1 topic holds exactly one
       * question, so the set of questions drawn across trials is the set of topics reached. Topics are
       * numbered, and any implementation sampling only the first SPEAKING_PROMPT_PAGE rows could never
       * draw a topic numbered above that bound.
       */
      const drawn = new Set<string>();
      for (let trial = 0; trial < TRIALS; trial += 1) {
        const script = await selectExaminerScript({ mode: "part1", channel: "ai" });
        for (const prompt of script) drawn.add(prompt.topic ?? "");
      }
      assert.ok(drawn.size > 1, `${TRIALS} trials drew only ${drawn.size} distinct topic(s) — selection is not varying`);

      // Only fixture topics are numbered. Seeded demo topics may legitimately be drawn too — the server
      // samples the whole published corpus — so they are set aside rather than treated as a failure.
      const fixtureDrawn = [...drawn].filter((topic) => fixturePart1Topics.has(topic));
      const seededDrawn = [...drawn].filter((topic) => !fixturePart1Topics.has(topic));
      /*
       * The number is the TRAILING four-digit group only. Stripping every non-digit instead reads the
       * "1" out of the "P1" part of the topic name, turning "QA-AI-P1-0001" into 10001 — which silently
       * made both thresholds below pass no matter what was drawn, i.e. the one assertion that exists to
       * catch first-page bias became vacuous. Guarded here, and the mutation test re-run to prove the
       * assertion can actually fail.
       */
      const topicNumber = (topic: string) => {
        const match = /(\d{4})$/.exec(topic);
        const digits = match?.[1];
        return digits ? Number.parseInt(digits, 10) : Number.NaN;
      };
      const numbers = fixtureDrawn.map(topicNumber).filter((n) => Number.isFinite(n));
      assert.equal(numbers.length, fixtureDrawn.length, "every drawn FIXTURE topic must be one of the numbered ones");
      assert.ok(numbers.length > 0, "no fixture topic was drawn at all, so the bias assertion would be vacuous");
      assert.ok(Math.max(...numbers) <= P1_TOPICS, `a parsed topic number (${Math.max(...numbers)}) exceeds the fixture's ${P1_TOPICS} topics — the extraction is reading digits out of the topic name again`);
      const beyondFirstPage = numbers.filter((n) => n > SPEAKING_PROMPT_PAGE);
      assert.ok(
        beyondFirstPage.length > 0,
        `${TRIALS} trials never drew a Part 1 topic past ${SPEAKING_PROMPT_PAGE} (max drawn was ${Math.max(...numbers)}) — ` +
          "selection is biased to the first page, so later published questions are unreachable in an exam",
      );
      const maxDrawn = Math.max(...numbers);
      assert.ok(maxDrawn > P1_TOPICS * 0.6, `the draw only reached topic ${maxDrawn} of ${P1_TOPICS} — the tail of the corpus is under-sampled`);
      assert.ok(Math.min(...numbers) < SPEAKING_PROMPT_PAGE, "the draw never touched an early topic either — that would suggest a fixed offset, not a uniform sample");
      console.log(`#   ${PROBE}: part1 topics drawn — fixture ${fixtureDrawn.length}, seeded ${seededDrawn.length}, highest fixture topic ${maxDrawn}/${P1_TOPICS}`);
    });

    await t.test("Part 2 cue cards are drawn from across the corpus, not one fixed card", async () => {
      const drawn = new Set<string>();
      for (let trial = 0; trial < TRIALS; trial += 1) {
        const script = await selectExaminerScript({ mode: "part2", channel: "ai" });
        assert.equal(script.length, 1, "Part 2 is exactly one cue card");
        const cue = script[0];
        assert.ok(cue, "the cue card must be present");
        drawn.add(cue.id);
      }
      assert.ok(drawn.size > 1, `${TRIALS} trials always drew the same cue card`);
      const topics = new Set(
        (await db.query("select distinct topic from speaking_prompts where id = any($1::uuid[])", [[...drawn]])).rows.map((r) => r.topic as string),
      );
      assert.ok(topics.size > 1, `${TRIALS} trials always drew from one topic — topic selection is not uniform`);
    });

    await t.test("an empty part is simply absent, exactly as the reference behaved", async () => {
      // Nothing is published for 'general' in the fixture, and the reference never invented questions
      // for a part with no prompts. The server draw must agree.
      const script = await selectExaminerScript({ mode: "full", channel: "ai" });
      assert.equal(script.some((p) => p.part === "general"), false, "a part with no published prompts must not appear");
      const reference = buildExaminerScript(corpus, "full");
      assert.equal(reference.some((p) => p.part === "general"), false, "the reference agrees");
    });
  } finally {
    const removed = await db.query("delete from speaking_prompts where prompt_text like $1 returning id", [`${MARKER}%`]).catch(() => ({ rows: [] }));
    assert.equal(await markerRows(), 0, "every synthetic prompt must be removed");
    console.log(`#   ${PROBE}: deleted ${removed.rows.length} synthetic prompt(s)`);
    await db.end().catch(() => {});
  }
});
