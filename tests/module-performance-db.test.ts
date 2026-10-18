import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { db } from "../src/db/client";
import { createTestDatabase } from "./support/pglite";
import { getStudentDetail } from "../src/lib/data/teacher";
import * as packs from "../src/lib/content/vocabulary-packs";
import * as owners from "../src/lib/services/resources/owners";
import { getTopicMastery } from "../src/lib/data/grammar";
import { listGeneralSets } from "../src/lib/data/general-reading";
import { getRetentionSummary } from "../src/lib/data/retention-attempts";
import { adminReadingCards, contentInventory } from "../src/lib/data/content-inventory";

type Measurements = { queries: number; rows: number; bytes: number; maxConcurrent: number };

/** Measures actual fixture query results, never production rows or SQL parameters. */
function measured(database: typeof db) {
  const metrics: Measurements = { queries: 0, rows: 0, bytes: 0, maxConcurrent: 0 };
  let active = 0;
  const proxies = new WeakMap<object, object>();
  function wrap<T>(value: T): T {
    if (!value || typeof value !== "object") return value;
    if (proxies.has(value)) return proxies.get(value) as T;
    const proxy = new Proxy(value, {
      get(target, key) {
        if (key === "then" && typeof Reflect.get(target, key) === "function") {
          return (resolve: (rows: unknown) => unknown, reject: (error: unknown) => unknown) => {
            metrics.queries++;
            active++;
            metrics.maxConcurrent = Math.max(metrics.maxConcurrent, active);
            const then = Reflect.get(target as object, key) as (...args: unknown[]) => unknown;
            return Reflect.apply(then, target, [(result: unknown) => {
              active--;
              const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] })?.rows ?? [];
              metrics.rows += rows.length;
              metrics.bytes += Buffer.byteLength(JSON.stringify(rows));
              return resolve(result);
            }, (error: unknown) => { active--; return reject(error); }]);
          };
        }
        const member = Reflect.get(target, key);
        if (key === "transaction" && typeof member === "function")
          return (run: (tx: typeof db) => unknown) => member.call(target, (tx: typeof db) => run(wrap(tx)));
        return typeof member === "function" ? (...args: unknown[]) => wrap(member.apply(target, args)) : wrap(member);
      },
    });
    proxies.set(value, proxy);
    return proxy;
  }
  return { database: wrap(database), metrics };
}

async function withFixtureDatabase<T>(database: typeof db, run: () => Promise<T>) {
  const previous = { select: db.select, query: db.query };
  Object.assign(db, { select: database.select, query: database.query });
  try { return await run(); } finally { Object.assign(db, previous); }
}

test("module readers preserve fixture results while query/transfer probes stay bounded", async () => {
  const env = await createTestDatabase();
  const baseline = process.env.MODULE_PERFORMANCE_BASELINE === "1";
  const results: Record<string, Measurements> = {};
  try {
    const [student, other] = await env.query<{ id: string }>("insert into users(name,role) values ('Fixture learner','student'),('Other learner','student') returning id");
    const [prompt] = await env.query<{ id: string }>("insert into writing_prompts(task_type,category,prompt,target_word_count) values ('task2','Fixture','Fixture prompt',250) returning id");
    const submissionIds: string[] = [];
    for (let n = 0; n < 12; n++) {
      const [submission] = await env.query<{ id: string }>("insert into writing_submissions(user_id,prompt_id,content) values ($1,$2,$3) returning id", [student!.id, prompt!.id, `Essay ${n}`]);
      submissionIds.push(submission!.id);
      for (let f = 0; f < 2; f++) await env.query("insert into writing_feedback(submission_id,source,comment,created_at) values ($1,'teacher',$2,$3)", [submission!.id, `Feedback ${n}:${f}`, new Date(Date.UTC(2026, 0, f + 1))]);
    }
    const [foreign] = await env.query<{ id: string }>("insert into writing_submissions(user_id,prompt_id,content) values ($1,$2,'Other essay') returning id", [other!.id, prompt!.id]);
    await env.query("insert into writing_feedback(submission_id,source,comment) values ($1,'teacher','Other feedback')", [foreign!.id]);
    {
      const probe = measured(env.db);
      const detail = await withFixtureDatabase(probe.database, () => getStudentDetail(student!.id));
      assert.equal(detail!.submissions.length, 12);
      assert.equal(detail!.feedbackBySubmission.size, 12);
      for (const id of submissionIds) assert.equal(detail!.feedbackBySubmission.get(id)![0]!.comment?.endsWith(":1"), true);
      assert.equal([...detail!.feedbackBySubmission.values()].flat().some(row => row.comment === "Other feedback"), false);
      if (!baseline) assert.equal(probe.metrics.queries, 3, "feedback reads do not grow with the student's submissions");
      results.teacherDetail = probe.metrics;
    }
    assert.deepEqual(await packs.listTopicPackSummariesForLearner("uz", env.db), packs.builtInPacks("uz").map(({ words, ...pack }) => ({ ...pack, wordCount: words.length })),
      "summary reader preserves the exact built-in fallback before any pack is published");
    for (let p = 0; p < 4; p++) {
      const [pack] = await env.query<{ id: string }>("insert into vocabulary_topic_packs(source_ref,slug,label_en,label_uz,position,publication_state) values ($1,$1,$2,$3,$4,$5) returning id", [`fixture-${p}`, `Pack ${p}`, `To‘plam ${p}`, p, p === 3 ? "draft" : "published"]);
      for (let w = 0; w < 20; w++) {
        const [word] = await env.query<{ id: string }>("insert into lexemes(term,definition_en,example_sentence,sense_key) values ($1,$2,$3,$1) returning id", [`word-${p}-${w}`, "definition ".repeat(30), "Example ".repeat(30)]);
        await env.query("insert into vocabulary_topic_pack_words(pack_id,lexeme_id,position) values ($1,$2,$3)", [pack!.id, word!.id, w]);
      }
    }
    assert.equal(await packs.findTopicPackForLearner("fixture-3", env.db), null, "a draft pack is not readable");
    assert.equal(await packs.findTopicPackForLearner("health_medicine", env.db), null, "authored live packs disable the global built-in fallback even for a missing slug");
    {
      const probe = measured(env.db);
      const reader = Reflect.get(packs, "listTopicPackSummariesForLearner") as typeof packs.listTopicPackSummariesForLearner | undefined;
      const summary = reader
        ? await Reflect.apply(reader, null, ["uz", probe.database])
        : (await packs.listTopicPacksForLearner("uz", probe.database)).map(pack => ({ id: pack.id, label: pack.label, wordCount: pack.words.length }));
      assert.deepEqual(summary.map(row => ({ id: row.id, label: row.label, wordCount: Reflect.get(row, "wordCount") })), [0, 1, 2].map(p => ({ id: `fixture-${p}`, label: `To‘plam ${p}`, wordCount: 20 })));
      if (!baseline) { assert.ok(reader); assert.ok(probe.metrics.rows <= 3); }
      results.vocabularySummary = probe.metrics;
    }
    {
      const probe = measured(env.db);
      const pack = await packs.findTopicPackForLearner("fixture-1", probe.database);
      assert.equal(pack!.words.length, 20);
      assert.deepEqual(pack!.words.map(row => row.term), Array.from({ length: 20 }, (_, w) => `word-1-${w}`));
      if (!baseline) assert.ok(probe.metrics.rows <= 21, "only the requested live pack's words are transferred");
      results.vocabularyOnePack = probe.metrics;
    }
    for (const area of ["writing", "speaking"]) {
      const [topic] = await env.query<{ id: string }>("insert into grammar_topics(title,explanation,\"order\",skill_area) values ($1,'Fixture',1,$2) returning id", [area, area]);
      for (let e = 0; e < 4; e++) {
        const [exercise] = await env.query<{ id: string }>("insert into grammar_exercises(topic_id,\"order\",prompt_text,options,correct_option,explanation,source_owner_user_id) values ($1,$2,'Fixture','[]','A','Fixture',$3) returning id", [topic!.id, e, e === 3 ? other!.id : null]);
        for (let day = 1; day <= 4; day++) await env.query("insert into grammar_attempts(user_id,exercise_id,activity,is_correct,attempted_at) values ($1,$2,'correct_it',$3,$4)", [student!.id, exercise!.id, day === 4, new Date(Date.UTC(2026, 0, day))]);
      }
    }
    {
      const probe = measured(env.db);
      const rows = await withFixtureDatabase(probe.database, () => Reflect.apply(getTopicMastery, null, [student!.id, "writing"]));
      const selected = rows.filter((row: { topic: { skillArea: string } }) => row.topic.skillArea === "writing");
      assert.equal(selected.length, 1);
      assert.equal(selected[0]!.totalExercises, 3, "another student's private exercise stays hidden");
      assert.equal(selected[0]!.mastery!.sessions, 4, "all historical days remain counted");
      assert.equal(selected[0]!.mastery!.scorePercent, 100, "latest retry replaces earlier errors");
      if (!baseline) assert.equal(probe.metrics.rows, 16, "selected topic, three exercises and twelve historical attempts only");
      results.grammarWriting = probe.metrics;
    }
    const [set] = await env.query<{ id: string }>("insert into general_reading_sets(title,publication_state) values ('Fixture set','published') returning id");
    for (let p = 1; p <= 3; p++) {
      const [passage] = await env.query<{ id: string }>("insert into reading_passages(title,body_text) values ('Fixture passage',$1) returning id", ["Authored passage ".repeat(100)]);
      await env.query("insert into general_reading_passages(passage_id,set_id,passage_no) values ($1,$2,$3)", [passage!.id, set!.id, p]);
      for (let q = 1; q <= (p === 3 ? 14 : 13); q++) await env.query("insert into reading_questions(passage_id,\"order\",type,question_text,correct_answer,explanation) values ($1,$2,'short_answer','Fixture','A','Fixture')", [passage!.id, q]);
    }
    {
      const probe = measured(env.db);
      const rows = await listGeneralSets(student!.id, { academic: true }, probe.database);
      assert.equal(rows[0]!.passages.length, 3);
      assert.equal(rows[0]!.assessmentStatus, "not_started");
      if (!baseline) assert.ok(probe.metrics.maxConcurrent >= 3, "independent set metadata and learner state reads overlap");
      results.readingCatalogue = probe.metrics;
    }
    {
      const probe = measured(env.db);
      const result = await getRetentionSummary(student!.id, probe.database);
      assert.equal(result.completedCount, 0);
      assert.equal(result.lastTenAverage, null);
      if (!baseline) assert.equal(probe.metrics.maxConcurrent, 2, "independent summaries begin together");
      results.retentionSummary = probe.metrics;
    }
    // A management inventory is larger than one learner's current formal set.
    for (let n = 0; n < 24; n++) await env.query("insert into reading_passages(title,body_text,publication_state) values ($1,$2,$3)", [`Inventory ${n}`, "Authored inventory text ".repeat(100), n % 2 ? "draft" : "published"]);
    {
      const probe = measured(env.db);
      const countReader = Reflect.get(owners, "countResourceOwners") as ((type: owners.ResourceOwnerType) => Promise<number>) | undefined;
      const counts = await withFixtureDatabase(probe.database, () => Promise.all(owners.RESOURCE_OWNER_TYPES.map(async type => ({ type, count: countReader ? await countReader(type) : (await owners.listResourceOwners(type)).length }))));
      assert.equal(counts.find(row => row.type === "reading")!.count, 27);
      assert.equal(counts.find(row => row.type === "grammar")!.count, 2);
      assert.equal(counts.find(row => row.type === "writing")!.count, 1);
      if (!baseline) { assert.ok(countReader); assert.equal(probe.metrics.rows, 8); }
      results.adminMaterialsCounts = probe.metrics;
    }
    if (process.env.MODULE_PERFORMANCE_PROBE_OUT) await writeFile(process.env.MODULE_PERFORMANCE_PROBE_OUT, JSON.stringify({ fixtureOnly: true, baseline, results }, null, 2));
    console.info("MODULE_PERFORMANCE_PROBE", JSON.stringify(results));
  } finally { await env.close(); }
});

test("inventory aggregates keep scheduled visibility and Reading cards keep exact metadata without bodies", async () => {
  const env = await createTestDatabase();
  try {
    const now = new Date("2026-10-17T00:00:00Z");
    const states = ["published", "scheduled", "scheduled", "scheduled", "draft", "archived"];
    for (const [index, state] of states.entries()) await env.query("insert into reading_passages(title,body_text,publication_state,publish_at,created_at) values ($1,$2,$3,$4,$5)", [
      `Passage ${index}`, "Full authored body ".repeat(500), state,
      index === 1 ? new Date("2026-10-16T00:00:00Z") : index === 2 ? new Date("2026-10-18T00:00:00Z") : null,
      new Date(Date.UTC(2026, 0, index + 1)),
    ]);
    await env.query("insert into grammar_topics(title,explanation,\"order\",publication_state) values ('Published','Body',1,'published'),('Draft','Body',2,'draft')");
    const probe = measured(env.db);
    const inventory = await contentInventory(probe.database, now);
    assert.deepEqual(inventory.reading, { total: 6, live: 2 });
    assert.deepEqual(inventory.grammar, { total: 2, live: 2 }, "preserve the management index's existing Grammar count semantics");
    assert.deepEqual(inventory.video, { total: 0, live: 0 });
    assert.equal(probe.metrics.rows, 5, "five content kinds transfer one aggregate row each");
    const cards = await adminReadingCards(env.db);
    assert.deepEqual(cards.map(row => row.title), [5, 4, 3, 2, 1, 0].map(index => `Passage ${index}`));
    assert.deepEqual(Object.keys(cards[0]!).sort(), ["id", "title", "difficultyLevel", "suggestedMinutes", "publicationState", "publishAt"].sort());
    assert.equal(JSON.stringify(cards).includes("Full authored body"), false);
  } finally { await env.close(); }
});
