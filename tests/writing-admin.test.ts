import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createTestDatabase } from "./support/pglite";
import { auditLog, resourceBlocks, users, writingLanguagePatterns, writingModelTexts, writingPrompts, writingTranslationSets } from "../src/db/schema";
import { canManageWriting } from "../src/lib/auth/writing-admin";
import {
  changeWritingPublication, getWritingContent, listWritingContent, saveWritingContent, writingAdminCounts, writingPublicationIssues,
} from "../src/lib/services/writing/admin";
import { listTranslationSets } from "../src/lib/services/writing/translation";
import { stealingLibrary } from "../src/lib/services/writing/stealing";
import { eq } from "drizzle-orm";

process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-123";

async function setup() {
  const t = await createTestDatabase();
  const [u] = await t.db.insert(users).values({ email: `a${Math.random()}@example.test`, name: "Admin", passwordHash: "x", role: "admin" } as typeof users.$inferInsert).returning();
  return { t, db: t.db as never, actor: u!.id };
}
const read = (p: string) => readFileSync(p, "utf8");
const essay = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 9}`).join(" ") + ".";
const SET = {
  title: "Free university", topic: "education", questionType: "opinion", taskType: "task2", targetBand: 7,
  promptText: "Some people think university should be free.", provenance: "Learners Area authored",
  sentences: [{ position: 1, uzbekSource: "Ta'lim muhim.", modelEnglish: "Education matters.", acceptedAlternatives: ["Education is important."] }],
};

test("J1–J4 role policy: student/teacher denied, admin/owner allowed — enforced in pages, APIs and publication", () => {
  assert.equal(canManageWriting("student"), false);
  assert.equal(canManageWriting("teacher"), false);
  assert.equal(canManageWriting("admin"), true);
  assert.equal(canManageWriting("owner"), true);
  assert.equal(canManageWriting(null), false);
  for (const p of ["src/app/(app)/admin/writing/page.tsx", "src/app/(app)/admin/writing/[kind]/new/page.tsx", "src/app/(app)/admin/writing/[kind]/[id]/page.tsx"]) {
    assert.match(read(p), /requireAdministrator\(\)[\s\S]*redirect\("\/dashboard"\)/, p);
  }
  for (const p of ["src/app/api/admin/writing/[kind]/route.ts", "src/app/api/admin/writing/[kind]/[id]/route.ts", "src/app/api/admin/writing-prompts/route.ts"]) {
    assert.match(read(p), /canManageWriting\(user\.role\)[\s\S]*403/, p);
  }
  assert.match(read("src/app/api/admin/content/[type]/[id]/publication/route.ts"), /requireAdministrator\(\)[\s\S]*changeWritingPublication/);
});

test("J5/J23/J24 one canonical route: legacy redirect, Management and Content library link to /admin/writing", () => {
  assert.match(read("src/app/(app)/admin/writing-prompts/page.tsx"), /redirect\("\/admin\/writing\?section=exam"\)/);
  assert.match(read("src/app/(app)/management/page.tsx"), /href: "\/admin\/writing",/);
  assert.doesNotMatch(read("src/app/(app)/management/page.tsx"), /\/admin\/writing-prompts/);
  assert.match(read("src/app/(app)/admin/content/page.tsx"), /href: "\/admin\/writing",/);
  assert.doesNotMatch(read("src/app/(app)/admin/content/page.tsx"), /\/admin\/writing-prompts/);
});

test("J6/J7 lessons and exam prompts: create/edit validation, new items start as drafts, edits are audited", async () => {
  const { t, db, actor } = await setup();
  try {
    assert.deepEqual(await saveWritingContent("lesson", null, { title: "", category: "task2", body: "x" }, actor, db), { ok: false, issues: ["invalid_fields"] });
    assert.deepEqual(await saveWritingContent("lesson", null, { title: "T", category: "poetry", body: "x" }, actor, db), { ok: false, issues: ["invalid_fields"] });
    const l = await saveWritingContent("lesson", null, { title: "Paragraph structure", category: "structure", body: "Topic sentence first.", durationMinutes: 12 }, actor, db);
    assert.ok(l.ok);
    const row = await getWritingContent("lesson", l.id, db);
    assert.equal(row!.publicationState, "draft");
    assert.ok((await saveWritingContent("lesson", l.id, { title: "Paragraph structure (fixed)", category: "structure", body: "Topic sentence first." }, actor, db)).ok);
    assert.equal((await getWritingContent("lesson", l.id, db))!.title, "Paragraph structure (fixed)");
    assert.deepEqual(await saveWritingContent("prompt", null, { taskType: "task2", category: "education", prompt: "short", targetWordCount: 250 }, actor, db), { ok: false, issues: ["invalid_fields"] });
    const p = await saveWritingContent("prompt", null, { taskType: "task2", category: "education", prompt: "Some people think university should be free. Discuss.", targetWordCount: 250 }, actor, db);
    assert.ok(p.ok);
    assert.deepEqual(await saveWritingContent("prompt", crypto.randomUUID(), { taskType: "task2", category: "x", prompt: "A long enough prompt here.", targetWordCount: 250 }, actor, db), { ok: false, issues: ["not_found"] });
    const audits = await t.db.select().from(auditLog);
    assert.ok(audits.some((a) => a.targetId === l.id && (a.metadata as { operation: string }).operation === "edit"));
  } finally { await t.close(); }
});

test("J8 Task 1 prompt cannot go live without an uploaded image block (secure material upload path)", async () => {
  const { t, db, actor } = await setup();
  try {
    const p = await saveWritingContent("prompt", null, { taskType: "task1", category: "line graph", prompt: "The graph shows energy use in three countries.", targetWordCount: 150 }, actor, db);
    assert.ok(p.ok);
    assert.deepEqual(await writingPublicationIssues("prompt", p.id, db), ["task1_visual_missing"]);
    const blocked = await changeWritingPublication("prompt", p.id, "published", null, actor, db);
    assert.ok(!blocked.ok && blocked.error === "not_ready" && blocked.issues?.includes("task1_visual_missing"));
    await t.db.insert(resourceBlocks).values({ ownerType: "writing", ownerId: p.id, position: 0, type: "link", linkUrl: "https://example.test/x.png", createdByUserId: actor } as typeof resourceBlocks.$inferInsert);
    assert.deepEqual(await writingPublicationIssues("prompt", p.id, db), ["task1_visual_missing"], "a hotlink is not an uploaded visual");
    await t.db.insert(resourceBlocks).values({ ownerType: "writing", ownerId: p.id, position: 1, type: "image", objectKey: "uploads/x.png", originalName: "x.png", mimeType: "image/png", size: 10, createdByUserId: actor } as typeof resourceBlocks.$inferInsert);
    assert.ok((await changeWritingPublication("prompt", p.id, "published", null, actor, db)).ok);
    assert.equal(read("src/app/(app)/admin/writing/[kind]/[id]/page.tsx").includes('ResourceComposer dict={dict} ownerType="writing"'), true);
  } finally { await t.close(); }
});

test("J9/J10/J11 translation: valid set saved with ordered sentences; zero-sentence publish and duplicate positions blocked", async () => {
  const { t, db, actor } = await setup();
  try {
    const ok = await saveWritingContent("translation", null, { ...SET, sentences: [...SET.sentences, { position: 2, uzbekSource: "Bu qimmat.", modelEnglish: "It is expensive." }] }, actor, db);
    assert.ok(ok.ok);
    const row = await getWritingContent("translation", ok.id, db);
    assert.deepEqual((row!.sentences as { position: number }[]).map((s) => s.position), [1, 2]);
    assert.ok((await changeWritingPublication("translation", ok.id, "published", null, actor, db)).ok);
    const empty = await saveWritingContent("translation", null, { ...SET, sentences: [] }, actor, db);
    assert.ok(empty.ok, "an empty draft may be saved");
    const blocked = await changeWritingPublication("translation", empty.id, "published", null, actor, db);
    assert.ok(!blocked.ok && blocked.issues?.includes("no_sentences"));
    const dup = await saveWritingContent("translation", null, { ...SET, sentences: [SET.sentences[0], { ...SET.sentences[0] }] }, actor, db);
    assert.deepEqual(dup, { ok: false, issues: ["duplicate_position"] });
    assert.deepEqual(await saveWritingContent("translation", null, { ...SET, targetBand: 9 }, actor, db), { ok: false, issues: ["invalid_fields"] });
    assert.deepEqual(await saveWritingContent("translation", null, { ...SET, questionType: "essay" }, actor, db), { ok: false, issues: ["invalid_fields"] });
    assert.deepEqual(await saveWritingContent("translation", null, { ...SET, sentences: [{ position: 1, uzbekSource: "", modelEnglish: "x" }] }, actor, db), { ok: false, issues: ["invalid_fields"] });
  } finally { await t.close(); }
});

test("J12/J13 model texts: complete body required, word count derived on the server, short/empty cannot be saved or published", async () => {
  const { t, db, actor } = await setup();
  try {
    const base = { title: "Remote work", taskType: "task2", topic: "work", targetBand: 8.5, provenance: "Learners Area authored" };
    assert.deepEqual(await saveWritingContent("model-text", null, { ...base, body: "" }, actor, db), { ok: false, issues: ["invalid_fields"] });
    assert.deepEqual(await saveWritingContent("model-text", null, { ...base, body: "Some people think remote work is better. Discuss both views and give your opinion. ".repeat(3) }, actor, db), { ok: false, issues: ["model_too_short"] });
    assert.deepEqual(await saveWritingContent("model-text", null, { ...base, targetBand: 7, body: essay(300) }, actor, db), { ok: false, issues: ["invalid_fields"] }, "Typing uses Band 8–9 only");
    const ok = await saveWritingContent("model-text", null, { ...base, body: essay(300) }, actor, db);
    assert.ok(ok.ok);
    assert.equal((await getWritingContent("model-text", ok.id, db))!.wordCount, 300);
    // A legacy row whose body was shortened outside the editor cannot be published.
    await t.db.update(writingModelTexts).set({ body: essay(60) }).where(eq(writingModelTexts.id, ok.id));
    const blocked = await changeWritingPublication("model-text", ok.id, "published", null, actor, db);
    assert.ok(!blocked.ok && blocked.issues?.includes("model_too_short"));
  } finally { await t.close(); }
});

test("J14/J15/J16 patterns: valid create/edit, canonical function list only, unknown source and missing provenance blocked", async () => {
  const { t, db, actor } = await setup();
  try {
    const base = { pattern: "X is likely to Y", function: "argument", taskType: "task2", example: "Remote work is likely to grow.", provenance: "Learners Area authored" };
    assert.deepEqual(await saveWritingContent("pattern", null, { ...base, function: "metaphor" }, actor, db), { ok: false, issues: ["invalid_fields"] });
    assert.deepEqual(await saveWritingContent("pattern", null, { ...base, sourceRef: crypto.randomUUID() }, actor, db), { ok: false, issues: ["unknown_source"] });
    assert.deepEqual(await saveWritingContent("pattern", null, { ...base, provenance: "" }, actor, db), { ok: false, issues: ["invalid_fields"] });
    const p = await saveWritingContent("pattern", null, base, actor, db);
    assert.ok(p.ok);
    assert.ok((await saveWritingContent("pattern", p.id, { ...base, usageNote: "Hedge a prediction." }, actor, db)).ok);
    await t.db.update(writingLanguagePatterns).set({ provenance: " " }).where(eq(writingLanguagePatterns.id, p.id));
    const blocked = await changeWritingPublication("pattern", p.id, "published", null, actor, db);
    assert.ok(!blocked.ok && blocked.issues?.includes("missing_provenance"));
  } finally { await t.close(); }
});

test("J17–J21 shared publication rule: scheduled needs a date, scheduled→published, archive hides but keeps, every change audited, learners see live only", async () => {
  const { t, db, actor } = await setup();
  try {
    const s = await saveWritingContent("translation", null, SET, actor, db);
    assert.ok(s.ok);
    const noDate = await changeWritingPublication("translation", s.id, "scheduled", null, actor, db);
    assert.ok(!noDate.ok && noDate.status === 400);
    const future = new Date(Date.now() + 86_400_000);
    assert.ok((await changeWritingPublication("translation", s.id, "scheduled", future, actor, db)).ok);
    assert.equal((await listTranslationSets(db)).length, 0, "J21 scheduled-in-future is not live");
    assert.ok((await changeWritingPublication("translation", s.id, "published", null, actor, db)).ok);
    assert.equal((await listTranslationSets(db)).length, 1);
    assert.ok((await changeWritingPublication("translation", s.id, "archived", null, actor, db)).ok);
    assert.equal((await listTranslationSets(db)).length, 0, "J19 archived hidden from new starts");
    assert.equal((await t.db.select().from(writingTranslationSets)).length, 1, "J19 archived row kept");
    const audits = (await t.db.select().from(auditLog)).filter((a) => a.targetId === s.id && (a.metadata as { to?: string }).to);
    assert.deepEqual(audits.map((a) => (a.metadata as { to: string }).to).sort(), ["archived", "published", "scheduled"]);
    for (const a of audits) { assert.equal(a.actorUserId, actor); assert.equal(a.targetType, "writing_translation"); assert.ok("from" in (a.metadata as object) && "publishAt" in (a.metadata as object)); }
    const pat = await saveWritingContent("pattern", null, { pattern: "draft only", function: "trend", taskType: "task1", example: "Sales rose.", provenance: "p" }, actor, db);
    assert.ok(pat.ok);
    assert.equal((await stealingLibrary(actor, {}, db)).patterns.length, 0, "J21 drafts never reach learners");
    const counts = await writingAdminCounts(db);
    assert.equal(counts.translation.archived, 1);
    assert.equal(counts.pattern.draft, 1);
    assert.equal((await listWritingContent("translation", db)).length, 1);
    void writingPrompts;
  } finally { await t.close(); }
});

test("J22 Topic Vocabulary stays canonical: no Writing word table; admin section links to the shared vocabulary system", () => {
  const schema = read("src/db/schema.ts");
  assert.doesNotMatch(schema, /writing_topic_words|writingTopicWords/);
  assert.match(read("src/app/(app)/admin/writing/page.tsx"), /data-admin-writing-topic[\s\S]*href="\/vocabulary"/);
  assert.match(read("src/lib/services/writing/topic-vocabulary.ts"), /TOPIC_PACKS/);
});

test("Writing Management screens use the shared BackLink and dictionary strings (UZ/EN parity)", async () => {
  for (const p of ["src/app/(app)/admin/writing/page.tsx", "src/app/(app)/admin/writing/[kind]/new/page.tsx", "src/app/(app)/admin/writing/[kind]/[id]/page.tsx"]) {
    assert.match(read(p), /<BackLink /, p);
    assert.doesNotMatch(read(p), /← /, p);
  }
  const { default: en } = await import("../src/lib/i18n/en");
  const { default: uz } = await import("../src/lib/i18n/uz");
  const keys = (o: object, pre = ""): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${pre}${k}.`) : [`${pre}${k}`]));
  assert.deepEqual(keys(uz.admin.writingAdmin).sort(), keys(en.admin.writingAdmin).sort());
  assert.doesNotMatch(JSON.stringify(uz.admin.writingAdmin), /[\u0400-\u04FF]/, "Uzbek Latin only");
  assert.ok(existsSync("src/lib/services/writing/admin.ts"));
});
