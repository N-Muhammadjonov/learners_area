import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./support/pglite";
import { users, writingPrompts, writingSubmissions } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { startExamPaper, getExamPaper, saveExamDraft, finalizeExamPaper } from "../src/lib/services/writing/exam";
import { EXAM_MODES, fullPaperBand, formatClock } from "../src/lib/writing/exam-modes";

async function setup() {
  const t = await createTestDatabase();
  const [u] = await t.db.insert(users).values({ email: `e${Math.random()}@example.test`, name: "E", passwordHash: "x" } as typeof users.$inferInsert).returning();
  await t.db.insert(writingPrompts).values([
    { taskType: "task1", category: "chart", prompt: "The chart shows energy use.", targetWordCount: 150 },
    { taskType: "task2", category: "education", prompt: "Some people think university should be free.", targetWordCount: 250 },
  ] as (typeof writingPrompts.$inferInsert)[]);
  const db = t.db as never;
  return { t, db, userId: u!.id };
}
const ageBy = (t: Awaited<ReturnType<typeof createTestDatabase>>, id: string, secs: number) =>
  t.query(`UPDATE writing_exam_papers SET started_at = started_at - make_interval(secs => ${secs}), expires_at = expires_at - make_interval(secs => ${secs}) WHERE id = '${id}'`);

test("E1/E2/E3 durations: task1 1200, task2 2400, full 3600 — and Postgres rejects any other", async () => {
  assert.equal(EXAM_MODES.task1.durationSeconds, 1200);
  assert.equal(EXAM_MODES.task2.durationSeconds, 2400);
  assert.equal(EXAM_MODES.full.durationSeconds, 3600);
  const { t, db, userId } = await setup();
  try {
    const r = await startExamPaper(userId, "full", db);
    assert.ok(r.ok);
    assert.equal(r.paper.durationSeconds, 3600);
    assert.ok(r.paper.remainingSeconds <= 3600 && r.paper.remainingSeconds >= 3590);
    await assert.rejects(t.query(`INSERT INTO writing_exam_papers (user_id, mode, duration_seconds, expires_at) VALUES ('${userId}', 'task1', 3600, now() + interval '3600 seconds')`));
  } finally { await t.close(); }
});

test("E4 a full paper holds a task1 entry and a task2 entry, each with its own submission", async () => {
  const { t, db, userId } = await setup();
  try {
    const r = await startExamPaper(userId, "full", db);
    assert.ok(r.ok);
    assert.deepEqual(r.paper.entries.map((e) => e.taskType), ["task1", "task2"]);
    const single = await (async () => { await finalizeExamPaper(userId, r.paper.id, "abandoned", db); return startExamPaper(userId, "task2", db); })();
    assert.ok(single.ok);
    assert.deepEqual(single.paper.entries.map((e) => e.taskType), ["task2"]);
  } finally { await t.close(); }
});

test("E5/E6 refresh / restart resumes the same deadline; nothing client-sent can move it", async () => {
  const { t, db, userId } = await setup();
  try {
    const a = await startExamPaper(userId, "task1", db);
    assert.ok(a.ok);
    await ageBy(t, a.paper.id, 600);
    const again = await startExamPaper(userId, "task1", db);
    assert.ok(again.ok && again.resumed, "a second Start resumes, it never mints a new deadline");
    assert.equal(again.paper.id, a.paper.id);
    assert.equal(again.paper.expiresAt, (await getExamPaper(userId, a.paper.id, db))!.expiresAt);
    assert.ok(again.paper.remainingSeconds <= 600 && again.paper.remainingSeconds >= 590);
    const other = await startExamPaper(userId, "task2", db);
    assert.equal(other.ok, false, "another mode cannot start while a paper is open");
    // The service API takes no time/duration/deadline argument at all.
    const src = readFileSync("src/lib/services/writing/exam.ts", "utf8");
    assert.ok(src.includes("expiresAt: sql`now() + make_interval"));
    assert.ok(!/Date\.now\(\)/.test(src), "the server clock is Postgres now(), never a JS/client clock");
  } finally { await t.close(); }
});

test("E7 switching tasks keeps both drafts; stale revisions never overwrite newer text", async () => {
  const { t, db, userId } = await setup();
  try {
    const r = await startExamPaper(userId, "full", db);
    assert.ok(r.ok);
    assert.ok((await saveExamDraft(userId, r.paper.id, 1, "Task one draft words", 1, db)).ok);
    assert.ok((await saveExamDraft(userId, r.paper.id, 2, "Task two draft", 1, db)).ok);
    assert.ok((await saveExamDraft(userId, r.paper.id, 1, "Task one draft words and more", 2, db)).ok);
    const late = await saveExamDraft(userId, r.paper.id, 1, "OLD", 1, db);
    assert.ok(late.ok && late.stale);
    const view = (await getExamPaper(userId, r.paper.id, db))!;
    assert.equal(view.entries[0]!.content, "Task one draft words and more");
    assert.equal(view.entries[0]!.wordCount, 6);
    assert.equal(view.entries[1]!.content, "Task two draft");
  } finally { await t.close(); }
});

test("E9 timeout: final flush accepted within grace, later saves refused, paper auto-finalized and drafts kept", async () => {
  const { t, db, userId } = await setup();
  try {
    const r = await startExamPaper(userId, "task2", db);
    assert.ok(r.ok);
    await ageBy(t, r.paper.id, 2405); // 5 s past the deadline, inside the grace window
    const flush = await saveExamDraft(userId, r.paper.id, 1, "final visible text", 5, db);
    assert.ok(flush.ok, "the in-flight final flush is not lost");
    await ageBy(t, r.paper.id, 60);
    assert.deepEqual(await saveExamDraft(userId, r.paper.id, 1, "too late", 6, db), { ok: false, code: "closed" });
    const view = (await getExamPaper(userId, r.paper.id, db))!;
    assert.equal(view.finalizeReason, "timeout");
    assert.equal(view.remainingSeconds, 0);
    assert.equal(view.entries[0]!.content, "final visible text");
    const [sub] = await t.db.select().from(writingSubmissions).where(eq(writingSubmissions.userId, userId));
    assert.equal(sub!.status, "submitted");
  } finally { await t.close(); }
});

test("E10 duplicate submit is safe and idempotent; another user cannot read or save", async () => {
  const { t, db, userId } = await setup();
  try {
    const r = await startExamPaper(userId, "task1", db);
    assert.ok(r.ok);
    const a = await finalizeExamPaper(userId, r.paper.id, "submitted", db);
    const b = await finalizeExamPaper(userId, r.paper.id, "submitted", db);
    assert.equal(a!.finalizedAt, b!.finalizedAt);
    assert.equal(b!.finalizeReason, "submitted");
    const stranger = "00000000-0000-0000-0000-000000000001";
    assert.equal(await getExamPaper(stranger, r.paper.id, db), null);
    assert.deepEqual(await saveExamDraft(stranger, r.paper.id, 1, "x", 9, db), { ok: false, code: "not_found" });
  } finally { await t.close(); }
});

test("full paper band: Task 2 counts double; clock formatting", () => {
  assert.equal(fullPaperBand(6, 7), 6.5); // 20/3 = 6.67 → 6.5
  assert.equal(fullPaperBand(7, 6), 6.5); // 19/3 = 6.33 → 6.5
  assert.equal(fullPaperBand(5, 7), 6.5); // 19/3
  assert.equal(formatClock(1200), "20:00");
  assert.equal(formatClock(3600), "1:00:00");
});

test("E8 autosave is debounced and revisioned; the runner never reads the device wall clock", async () => {
  const { EXAM_AUTOSAVE_DEBOUNCE_MS } = await import("../src/lib/writing/exam-modes");
  assert.ok(EXAM_AUTOSAVE_DEBOUNCE_MS >= 1000);
  const runner = readFileSync("src/components/writing/exam/ExamRunner.tsx", "utf8");
  const onChange = runner.slice(runner.indexOf("const onChange"), runner.indexOf("// Time up"));
  assert.match(onChange, /clearTimeout\(timers\.current\.debounce\)/);
  assert.match(onChange, /setTimeout\([\s\S]*EXAM_AUTOSAVE_DEBOUNCE_MS\)/);
  assert.doesNotMatch(onChange, /fetch\(/, "no request per keystroke");
  assert.match(onChange, /localStorage\.setItem/, "local emergency copy before any network call");
  assert.match(runner, /revision: e\.revision/);
  assert.doesNotMatch(runner, /Date\.now\(\)|new Date\(\)/);
  assert.match(runner, /performance\.now\(\)/);
});

test("Exam API: the client sends only the mode / text / revision — never time or duration", () => {
  const start = readFileSync("src/app/api/writing/exam/route.ts", "utf8");
  assert.match(start, /z\.object\(\{ mode: z\.enum\(\["task1", "task2", "full"\]\) \}\)\.strict\(\)/);
  const draft = readFileSync("src/app/api/writing/exam/[id]/draft/route.ts", "utf8");
  assert.doesNotMatch(draft, /expires|duration|startedAt/);
  assert.match(draft, /\.strict\(\)/);
  const page = readFileSync("src/app/app/(shell)/writing/page.tsx", "utf8");
  assert.match(page, /tab === "exam" \?[\s\S]*WritingExamHome/);
  assert.doesNotMatch(page, /StartPromptButton/, "the old prompt-card list is no longer the exam");
});
