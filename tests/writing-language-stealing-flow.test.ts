import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./support/pglite";
import { users, writingLanguagePatterns, writingModelTexts } from "../src/db/schema";
import { advanceStealing, getStealing, startStealing } from "../src/lib/services/writing/stealing";

const PATTERN = "While X has clear benefits, it also raises serious concerns about Y";
const MODEL = "MODEL-BODY-SECRET Some people believe remote work is better. ".repeat(10);

async function setup() {
  const t = await createTestDatabase();
  const [u] = await t.db.insert(users).values({ email: `f${Math.random()}@example.test`, name: "F", passwordHash: "x" } as typeof users.$inferInsert).returning();
  const [mt] = await t.db.insert(writingModelTexts).values({ title: "Remote work", taskType: "task2", topic: "work", targetBand: "8.5", body: MODEL, wordCount: 90, provenance: "INTERNAL-PROVENANCE", publicationState: "published" } as typeof writingModelTexts.$inferInsert).returning();
  const [p] = await t.db.insert(writingLanguagePatterns).values({ pattern: PATTERN, function: "concession", taskType: "task2", topic: "work", targetBand: 8, example: "While remote work has clear benefits, it also raises serious concerns about isolation.", provenance: "INTERNAL-PROVENANCE", publicationState: "published", sourceRef: mt!.id } as typeof writingLanguagePatterns.$inferInsert).returning();
  return { t, db: t.db as never, userId: u!.id, textId: mt!.id, patternId: p!.id };
}

test("LS9–LS12 source visibility by step (service-level): 1 shown, 2–3 hidden, 4–6 shown, Day-3 hidden, completed shown", async () => {
  const { t, db, userId, textId, patternId } = await setup();
  try {
    const now = new Date("2026-10-03T10:00:00Z");
    const v = (await startStealing(userId, textId, db, now))!;
    assert.ok(v.modelBody?.includes("MODEL-BODY-SECRET"), "LS9 step 1 shows the authorized source essay");
    assert.deepEqual(v.source, { id: textId, title: "Remote work", taskType: "task2", topic: "work", targetBand: 8.5 });
    assert.equal(v.patterns, null, "no extracted patterns before Analyse");
    assert.ok(!JSON.stringify(v).includes("INTERNAL-PROVENANCE"), "provenance never reaches the learner");
    const s2 = await advanceStealing(userId, v.id, { action: "read" }, db, now);
    assert.ok(s2.ok && s2.view.step === 2 && s2.view.modelBody === null, "LS10 brainstorm without the source");
    const s3 = await advanceStealing(userId, v.id, { action: "brainstorm", text: "one two three four five six seven eight nine" }, db, now);
    assert.ok(s3.ok && s3.view.step === 3 && s3.view.modelBody === null && s3.view.patterns === null, "LS10 own draft without the source");
    const s4 = await advanceStealing(userId, v.id, { action: "draft", text: "Remote work is common today. ".repeat(10) }, db, now);
    assert.ok(s4.ok && s4.view.modelBody && s4.view.patterns?.length === 1, "source + patterns return for Analyse");
    await advanceStealing(userId, v.id, { action: "analyse", patternIds: [patternId] }, db, now);
    await advanceStealing(userId, v.id, { action: "compare", text: "The model uses a concession and balances both sides while I listed only benefits." }, db, now);
    const s7 = await advanceStealing(userId, v.id, { action: "recall", patternId, attempt: PATTERN }, db, now);
    assert.ok(s7.ok && s7.view.step === 7 && s7.view.modelBody === null, "LS11 Day-3 rewrite hides the source");
    const later = new Date(now.getTime() + 4 * 86_400_000);
    assert.equal((await getStealing(userId, v.id, db, later))!.modelBody, null, "LS11 still hidden once unlocked");
    const done = await advanceStealing(userId, v.id, { action: "rewrite", text: "My rewrite from memory. ".repeat(12) }, db, later);
    assert.ok(done.ok && done.view.completedAt && done.view.modelBody?.includes("MODEL-BODY-SECRET"), "LS12 completed shows the source again");
  } finally { await t.close(); }
});

test("Migration boundary: 0032 = Real Exam only; 0033 adds writing_stealing_sessions; 0031→0032→0033(→0034) additive", async () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.includes("0033_writing_language_stealing.sql"));
  const m32 = readFileSync(new URL("0032_writing_exam_papers.sql", dir), "utf8");
  const m33 = readFileSync(new URL("0033_writing_language_stealing.sql", dir), "utf8");
  assert.doesNotMatch(m32, /writing_stealing_sessions/);
  assert.match(m33, /CREATE TABLE writing_stealing_sessions/);
  assert.doesNotMatch(m33.replace(/ON DELETE (CASCADE|SET NULL|RESTRICT)/g, ""), /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", dir), "utf8")) as { entries: { tag: string }[] };
  // 0031→0032→0033 stay consecutive and in order; later additive migrations (0034 typing presets) follow them.
  const tags = journal.entries.map((e) => e.tag);
  const at = tags.indexOf("0031_writing_workspace");
  assert.deepEqual(tags.slice(at, at + 4), ["0031_writing_workspace", "0032_writing_exam_papers", "0033_writing_language_stealing", "0034_typing_duration_presets"]);
  const client = new PGlite();
  const has = async (table: string) => ((await client.query(`select to_regclass('public.${table}') as r`)).rows[0] as { r: string | null }).r;
  const apply = async (f: string) => {
    for (const st of readFileSync(new URL(f, dir), "utf8").split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean)) await client.exec(st);
  };
  try {
    for (const f of files.filter((f) => f < "0032")) await apply(f);
    await client.exec(`insert into writing_model_texts (title, task_type, topic, target_band, body, word_count, provenance) values ('T', 'task2', 'work', 8.5, repeat('model body ', 30), 60, 'qa')`);
    await apply("0032_writing_exam_papers.sql");
    assert.ok((await has("writing_exam_papers")) && (await has("writing_exam_paper_entries")));
    assert.equal(await has("writing_stealing_sessions"), null, "not part of 0032");
    await apply("0033_writing_language_stealing.sql");
    assert.ok(await has("writing_stealing_sessions"));
    const rows = (await client.query("select count(*)::int as n from writing_model_texts")).rows[0] as { n: number };
    assert.equal(rows.n, 1, "existing 0031 rows untouched");
    await apply("0034_typing_duration_presets.sql");
    const after = (await client.query("select count(*)::int as n from writing_model_texts")).rows[0] as { n: number };
    assert.equal(after.n, 1, "0034 leaves existing rows untouched");
    const col = (await client.query("select is_nullable from information_schema.columns where table_name = 'typing_run_texts' and column_name = 'preset_seconds'")).rows[0] as { is_nullable: string };
    assert.equal(col.is_nullable, "YES");
  } finally { await client.close(); }
});
