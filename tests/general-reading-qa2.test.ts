import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { generalReadingPassages, generalReadingProgress, lexemes, lexicalOccurrences, readingPassages, userVocabulary, userVocabularyContexts, users } from "../src/db/schema";
import { readingSourceAccess, resolveOccurrence, type VocabularySourceSnapshot } from "../src/lib/services/lexical/context";
import { ingestListeningOccurrences } from "../src/lib/services/lexical/listening-occurrences";
import { addVocabularyBatch, applyScheduledReview, listVocabularyContexts } from "../src/lib/services/vocabulary/engine";
import { importGeneralReadingSet, type GeneralReadingBundle } from "../src/lib/services/reading/general-import";
import { generalMembership, generalProgress, generalSetDetail, listGeneralSets, saveGeneralProgress } from "../src/lib/data/general-reading";
import { getStartablePassage, listActivePassages } from "../src/lib/data/reading";
import { countLibrary, listLibrary } from "../src/lib/data/reading-library";

/**
 * General Reading (learning mode) on REAL PostgreSQL — isolated local QA2 only:
 *   QA2_DATABASE_TESTS=1 STORAGE_PROVIDER=local DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 …
 * Skipped (reported as skipped, not passed) without that database. Fixture texts
 * are test-only and never enter the publication bank.
 */
const enabled = process.env.QA2_DATABASE_TESTS === "1";
function isolated() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
}
type User = { id: string; role: "student" | "admin" };
async function learner(role: User["role"] = "student"): Promise<User> {
  const id = randomUUID();
  await db.insert(users).values({ id, name: `QA2 general ${role}`, role, accountStatus: "active" });
  return { id, role };
}

const P1 = "The bank approved the loan. They rested on the river bank. He took the cost into account. She runs every morning and ran a marathon last year.";
const P2 = "Our bank charges a small fee. Farmers bought seed in spring.";
const P3 = "Every bank in town closed early. Fog rolled over the hills.";

/** One authored General set with three passages; `tag` keeps canonical senses unique per run. */
async function generalSet(publish = true) {
  const tag = randomUUID().slice(0, 8);
  const money = `A business that keeps and lends money ${tag}`;
  const bundle: GeneralReadingBundle = {
    sourceRef: `qa2-general-${tag}`, title: `QA2 General ${tag}`, description: "test fixture", level: "B1", publish,
    passages: [
      { passageNo: 1, title: "Money and rivers", body: P1,
        questions: [
          { questionNo: 1, type: "true_false_not_given", text: "The loan was approved.", answer: "TRUE", accepted: [], evidence: "The bank approved the loan.", explanation: "" },
          { questionNo: 2, type: "short_answer", text: "What did the bank approve?", answer: "loan", accepted: ["the loan"], evidence: "They rested on the river bank.", explanation: "" },
          { questionNo: 3, type: "multiple_choice", text: "What did she run?", options: ["A marathon", "A shop"], answer: "A marathon", accepted: [], explanation: "" },
        ],
        vocabulary: [
          { word: "bank", pos: "noun", def: money, uz: "bank", ex: "The bank approved the loan." },
          { word: "take into account", pos: "phrase", def: `To consider something ${tag}`, uz: "", ex: "He took the cost into account.", surfaces: ["took the cost into account"] },
          { word: "account", pos: "noun", def: `A record of money ${tag}`, uz: "", ex: "He took the cost into account." },
          { word: "run", pos: "verb", def: `To move fast on foot ${tag}`, uz: "", ex: "She runs every morning and ran a marathon last year." },
          { word: "the", pos: "det", def: `Definite article ${tag}`, uz: "", ex: "The bank approved the loan." },
        ] },
      { passageNo: 2, title: "Fees", body: P2, questions: [],
        vocabulary: [
          { word: "bank", pos: "noun", def: money, uz: "bank", ex: "Our bank charges a small fee." },
          { word: "buy", pos: "verb", def: `To get by paying ${tag}`, uz: "", ex: "Farmers bought seed in spring." },
        ] },
      { passageNo: 3, title: "Town", body: P3,
        questions: [{ questionNo: 1, type: "yes_no_not_given", text: "Banks closed early.", answer: "YES", accepted: [], explanation: "" }],
        vocabulary: [{ word: "bank", pos: "noun", def: money, uz: "bank", ex: "Every bank in town closed early." }] },
    ],
  };
  const result = await db.transaction((tx) => importGeneralReadingSet(tx, bundle));
  const ids = Object.fromEntries(result.passages.map((p) => [p.passageNo, p.passageId])) as Record<1 | 2 | 3, string>;
  const occ = async (passageNo: 1 | 2 | 3) => db.select().from(lexicalOccurrences).where(eq(lexicalOccurrences.passageId, ids[passageNo])).orderBy(lexicalOccurrences.startChar);
  return { tag, money, bundle, setId: result.setId, ids, occ, result };
}
const at = <T extends { startChar: number; surfaceForm: string }>(rows: T[], body: string, surface: string, nth = 0): T | undefined => {
  let index = -1;
  for (let i = 0; i <= nth; i += 1) index = body.indexOf(surface, index + 1);
  return rows.find((r) => r.startChar === index && r.surfaceForm === surface);
};
async function save(user: User, sourceType: "reading" | "listening", sourceId: string, occurrenceId: string) {
  const resolved = await resolveOccurrence(user, sourceType, sourceId, occurrenceId);
  assert.ok(resolved && resolved.status === "resolved", "occurrence must resolve");
  const saved = await addVocabularyBatch({ userId: user.id, sourceType, sourceId, items: [{ ...resolved.lexeme, canonicalLexemeId: resolved.lexeme.id, sourceSnapshot: resolved.snapshot as VocabularySourceSnapshot }] });
  if (!saved.ok) throw new Error(`save failed: ${saved.error}`);
  return saved;
}
/** A live Academic passage with one "bank" occurrence (already existing content). */
async function academicPassage(lexemeId: string, attemptFor?: { userId: string; status: "in_progress" | "completed" }) {
  const body = "The bank lends money to firms.";
  const [passage] = await db.insert(readingPassages).values({ title: `QA2 academic ${randomUUID().slice(0, 6)}`, bodyText: body, publicationState: "published", testNo: 9, passageNo: 1 }).returning();
  const [occurrence] = await db.insert(lexicalOccurrences).values({ lexemeId, passageId: passage!.id, surfaceForm: "bank", startChar: 4, endChar: 8, sentenceText: body, occurrenceType: "vocabulary", isTargetVocabulary: true }).returning();
  let attemptId: string | null = null;
  if (attemptFor) {
    const [row] = await db.execute<{ id: string }>(sql`insert into reading_attempts (user_id, passage_id, status, submitted_at) values (${attemptFor.userId}, ${passage!.id}, ${attemptFor.status}, ${attemptFor.status === "completed" ? new Date().toISOString() : null}) returning id`).then((r) => r.rows);
    attemptId = row!.id;
  }
  return { passageId: passage!.id, occurrenceId: occurrence!.id, attemptId };
}

test("1 mode is persisted data: General membership row with reading_mode general_practice; Academic passages have none", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet();
  const m = await generalMembership(g.ids[1]);
  assert.equal(m?.readingMode, "general_practice");
  assert.equal(m?.setId, g.setId);
  assert.equal(m?.passageNo, 1);
  const lex = (await g.occ(1))[0]!.lexemeId!;
  const academic = await academicPassage(lex);
  assert.equal(await generalMembership(academic.passageId), null, "existing/new Academic content stays Academic");
});

test("2 General passage resolves immediately with no attempt (sourceId = passage id)", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const bank = at(await g.occ(1), P1, "bank")!;
  const r = await resolveOccurrence(u, "reading", g.ids[1], bank.id);
  assert.equal(r?.status, "resolved");
  assert.equal(r?.lexeme?.definitionEn, g.money);
  const snap = r!.snapshot as Record<string, unknown>;
  assert.equal(snap.readingMode, "general_practice");
  assert.equal(snap.generalSetId, g.setId);
  assert.equal(snap.passageNo, 1);
  assert.equal(snap.attemptId ?? null, null, "no fabricated attempt id");
});

test("3 one-meaning trap: the river 'bank' outside the authored example stays unresolved (Meaning not checked yet)", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const river = at(await g.occ(1), P1, "bank", 1);
  assert.ok(river, "the second bank is still a clickable occurrence");
  assert.equal(river!.lexemeId, null, "no sense attached by spelling");
  const r = await resolveOccurrence(u, "reading", g.ids[1], river!.id);
  assert.equal(r?.status, "unresolved");
  assert.equal(r?.lexeme, null);
});

test("4 MWE: longest occurrence wins — 'took the cost into account' is one phrase occurrence, not 'account' alone", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const rows = await g.occ(1);
  const phrase = rows.find((r) => r.surfaceForm === "took the cost into account");
  assert.ok(phrase && phrase.lexemeId);
  assert.equal(rows.filter((r) => r.surfaceForm === "account").length, 0, "the nested single word lost to the longer span");
  const r = await resolveOccurrence(u, "reading", g.ids[1], phrase!.id);
  assert.equal(r?.lexeme?.term, "take into account");
});

test("5 inflections resolve to the lemma sense: runs/ran (P1), bought (P2)", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  for (const surface of ["runs", "ran"]) {
    const o = at(await g.occ(1), P1, surface);
    assert.ok(o, surface);
    assert.equal((await resolveOccurrence(u, "reading", g.ids[1], o!.id))?.lexeme?.term, "run");
  }
  const bought = at(await g.occ(2), P2, "bought");
  assert.equal((await resolveOccurrence(u, "reading", g.ids[2], bought!.id))?.lexeme?.term, "buy");
});

test("6 save from General: canonical sense id, context with set/passage/occurrence/sentence/mode, no attempt id", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const bank = at(await g.occ(1), P1, "bank")!;
  const saved = await save(u, "reading", g.ids[1], bank.id);
  const [item] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, saved.ids[0]!));
  assert.equal(item!.lexemeId, bank.lexemeId, "saved by exact sense");
  const [ctx] = await db.select().from(userVocabularyContexts).where(eq(userVocabularyContexts.userVocabularyId, item!.id));
  const s = ctx!.snapshot as Record<string, unknown>;
  assert.equal(ctx!.occurrenceId, bank.id);
  assert.equal(s.passageId, g.ids[1]);
  assert.equal(s.generalSetId, g.setId);
  assert.equal(s.passageNo, 1);
  assert.equal(s.readingMode, "general_practice");
  assert.equal(s.sentenceText, "The bank approved the loan.");
  assert.equal(s.attemptId ?? null, null);
});

test("7 revisit route returns to the set and passage", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const saved = await save(u, "reading", g.ids[3], at(await g.occ(3), P3, "bank")!.id);
  const contexts = await listVocabularyContexts(u.id, saved.ids[0]!);
  assert.equal(contexts?.contexts[0]?.revisitHref, `/app/reading/general/${g.setId}?passage=3`);
});

test("8 dedup by learner+sense across General P1 and P3 (one item, two contexts)", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const a = await save(u, "reading", g.ids[1], at(await g.occ(1), P1, "bank")!.id);
  const b = await save(u, "reading", g.ids[3], at(await g.occ(3), P3, "bank")!.id);
  assert.equal(a.ids[0], b.ids[0]);
  assert.equal((await db.select().from(userVocabularyContexts).where(eq(userVocabularyContexts.userVocabularyId, a.ids[0]!))).length, 2);
});

test("9 same sense shared across passages: P1/P2/P3 'bank' point at ONE canonical lexeme (no duplicate senses)", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet();
  const ids = new Set([at(await g.occ(1), P1, "bank")!.lexemeId, at(await g.occ(2), P2, "bank")!.lexemeId, at(await g.occ(3), P3, "bank")!.lexemeId]);
  assert.equal(ids.size, 1);
  assert.equal((await db.select().from(lexemes).where(eq(lexemes.definitionEn, g.money))).length, 1);
});

test("10 Academic review remains locked; the General saved item is preserved", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const bank = at(await g.occ(1), P1, "bank")!;
  const academic = await academicPassage(bank.lexemeId!, { userId: u.id, status: "completed" });
  const a = await save(u, "reading", g.ids[1], bank.id);
  assert.equal((await resolveOccurrence(u, "reading", academic.attemptId!, academic.occurrenceId))?.status, "locked");
  assert.equal((await db.select().from(userVocabulary).where(eq(userVocabulary.userId,u.id))).length,1);
  assert.ok(a.ids[0]);
});

test("11 dedup General + Listening: an identically authored Listening sense is the same canonical item", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner(); const author = await learner("admin");
  const bank = at(await g.occ(1), P1, "bank")!;
  const transcript = "The bank approved the loan.";
  const tag = randomUUID().slice(0, 8);
  const [testRow] = await db.execute<{ id: string }>(sql`insert into listening_tests (created_by_user_id, title, audio_type, audio_url) values (${author.id}, ${`QA2 gl ${tag}`}, 'audio', '/api/resources/qa2') returning id`).then((r) => r.rows);
  const payload = { testId: `qa2-${tag}`, sections: [{ number: 1, title: "QA2", transcript }], vocabulary: [{ word: "bank", pos: "noun", def: g.money, ex: transcript, uz: "bank", also: [], quiz: [] }], questions: [] };
  await db.execute(sql`insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash) values (${testRow!.id}, ${`qa2-${tag}`}, ${JSON.stringify(payload)}::jsonb, 'qa2-audio', ${"0".repeat(64)})`);
  await db.transaction((tx) => ingestListeningOccurrences(tx, testRow!.id, payload as never));
  const [lo] = await db.select().from(lexicalOccurrences).where(and(eq(lexicalOccurrences.listeningTestId, testRow!.id), eq(lexicalOccurrences.surfaceForm, "bank")));
  assert.equal(lo!.lexemeId, bank.lexemeId, "one canonical sense across sources");
  await db.execute(sql`insert into listening_attempts (user_id, test_id, status, submitted_at) values (${u.id}, ${testRow!.id}, 'completed', now())`);
  const a = await save(u, "reading", g.ids[1], bank.id);
  const b = await save(u, "listening", testRow!.id, lo!.id);
  assert.equal(a.ids[0], b.ids[0]);
});

test("12 SRS is not reset when the same sense is saved again from another General passage", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const a = await save(u, "reading", g.ids[1], at(await g.occ(1), P1, "bank")!.id);
  assert.ok((await applyScheduledReview({ userId: u.id, entryId: a.ids[0]!, outcome: "correct" })).ok);
  const [before] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, a.ids[0]!));
  await save(u, "reading", g.ids[2], at(await g.occ(2), P2, "bank")!.id);
  const [after] = await db.select().from(userVocabulary).where(eq(userVocabulary.id, a.ids[0]!));
  // VD-006: every compared field must exist (no silent skip of a misspelled key).
  for (const key of ["mastery", "srsStage", "intervalDays", "nextReviewAt", "lastReviewedAt", "correctCount", "lexemeId"] as const) {
    assert.ok(key in before!, `field ${key} exists`);
    assert.deepEqual(after![key], before![key], key);
  }
  assert.ok(before!.srsStage > 0 || before!.lastReviewedAt, "the review really changed SRS state before the re-encounter");
  assert.equal(after!.seenCount, before!.seenCount + 1, "exposure is recorded instead");
});

test("13 Academic exam lock unchanged: an open Academic attempt is locked while General works for the same learner", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const bank = at(await g.occ(1), P1, "bank")!;
  const academic = await academicPassage(bank.lexemeId!, { userId: u.id, status: "in_progress" });
  assert.equal((await resolveOccurrence(u, "reading", academic.attemptId!, academic.occurrenceId))?.status, "locked");
  assert.equal((await resolveOccurrence(u, "reading", academic.passageId, academic.occurrenceId))?.status, "locked", "passage-id bypass locked");
  assert.equal((await resolveOccurrence(u, "reading", g.ids[1], bank.id))?.status, "resolved");
});

test("14 forged General: an Academic passage id or occurrence cannot borrow General permission", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const bank = at(await g.occ(1), P1, "bank")!;
  const academic = await academicPassage(bank.lexemeId!);
  // An Academic occurrence through a General source id: not this passage's occurrence → no resolution.
  assert.equal(await resolveOccurrence(u, "reading", g.ids[1], academic.occurrenceId), null);
  // Academic passage id with no completed attempt: locked (no attempt, no review) — never General.
  assert.equal((await resolveOccurrence(u, "reading", academic.passageId, academic.occurrenceId))?.status, "locked");
  // A General occurrence through another General passage id: rejected.
  assert.equal(await resolveOccurrence(u, "reading", g.ids[2], bank.id), null);
});

test("15 retake stays locked: completed + new in-progress Academic attempt, General unaffected", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const bank = at(await g.occ(1), P1, "bank")!;
  const academic = await academicPassage(bank.lexemeId!, { userId: u.id, status: "completed" });
  const [retake] = await db.execute<{ id: string }>(sql`insert into reading_attempts (user_id, passage_id, status) values (${u.id}, ${academic.passageId}, 'in_progress') returning id`).then((r) => r.rows);
  assert.equal((await resolveOccurrence(u, "reading", retake!.id, academic.occurrenceId))?.status, "locked");
  assert.equal((await resolveOccurrence(u, "reading", academic.passageId, academic.occurrenceId))?.status, "locked");
  assert.equal((await resolveOccurrence(u, "reading", g.ids[1], bank.id))?.status, "resolved");
});

test("16 Academic surfaces exclude General passages (library count, facets-free list, active list, start)", { skip: !enabled }, async () => {
  isolated();
  const u = await learner();
  const before = await countLibrary(u.id);
  const activeBefore = (await listActivePassages()).length;
  const g = await generalSet();
  assert.equal(await countLibrary(u.id), before, "three published General passages added nothing to the Academic library");
  assert.equal((await listActivePassages()).length, activeBefore);
  assert.ok(!(await listLibrary(u.id, {})).items.some((p) => Object.values(g.ids).includes(p.id)));
  assert.equal(await getStartablePassage(g.ids[1]), null, "a General passage cannot start an Academic exam");
});

test("17 draft sets are invisible to learners and locked; staff can preview", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(false); const u = await learner(); const staff = await learner("admin");
  assert.equal(await generalSetDetail(g.setId, "student"), null);
  assert.ok(await generalSetDetail(g.setId, "admin"));
  assert.ok(!(await listGeneralSets(u.id)).some((s) => s.id === g.setId));
  const bank = at(await g.occ(1), P1, "bank")!;
  const denied = await resolveOccurrence(u, "reading", g.ids[1], bank.id);
  assert.ok(denied === null || denied.status === "locked", "a learner gets no help (and no existence signal) on a draft");
  assert.equal((await resolveOccurrence(staff, "reading", g.ids[1], bank.id))?.status, "resolved");
});

test("18 question evidence stays separate: evidence quotes create no sense and do not resolve the river 'bank'", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet();
  const rows = await g.occ(1);
  assert.equal(at(rows, P1, "bank", 1)!.lexemeId, null, "Q2 evidence quotes this sentence; still unresolved");
  const defs = (await db.select().from(lexemes).where(inArray(lexemes.id, rows.map((r) => r.lexemeId).filter(Boolean) as string[]))).map((l) => l.definitionEn);
  assert.ok(!defs.some((d) => /river|rested/i.test(d ?? "")));
});

test("19 function words are not vocabulary targets", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet();
  assert.equal((await g.occ(1)).filter((r) => r.surfaceForm.toLowerCase() === "the").length, 0);
  assert.equal(g.result.passages[0]!.passageNo, 1);
});

test("20 per-passage progress persists answers without grading; reload returns them", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const detail = await generalSetDetail(g.setId, u.role);
  const q = detail!.passages[0]!.questions;
  const saved = await saveGeneralProgress({ userId: u.id, role: u.role, passageId: g.ids[1], answers: { [q[0]!.id]: "TRUE" }, check: false });
  assert.ok(saved && saved.result === null);
  const rows = await generalProgress(u.id, g.setId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.answers[q[0]!.id], "TRUE");
  assert.equal(rows[0]!.checkedAt, null);
});

test("21 learning results: Check grades with correct answer and evidence; foreign question ids are dropped", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const q = (await generalSetDetail(g.setId, u.role))!.passages[0]!.questions;
  const p3q = (await generalSetDetail(g.setId, u.role))!.passages[2]!.questions[0]!;
  const r = await saveGeneralProgress({ userId: u.id, role: u.role, passageId: g.ids[1], answers: { [q[0]!.id]: "true" /* the UI radio value */, [q[1]!.id]: "the loan", [q[2]!.id]: "A shop", [p3q.id]: "YES" }, check: true });
  assert.equal(r!.progress.score, 2);
  assert.equal(r!.progress.total, 3);
  assert.equal(r!.result!.length, 3, "a P3 question cannot be smuggled into P1 progress");
  assert.equal(r!.result!.find((x) => x.questionId === q[0]!.id)?.evidenceQuote, "The bank approved the loan.");
  assert.equal(r!.result!.find((x) => x.questionId === q[2]!.id)?.correctAnswer, "A marathon");
});

test("22 Full Reading keeps progress of all 3 passages independently", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner();
  const d = (await generalSetDetail(g.setId, u.role))!;
  await saveGeneralProgress({ userId: u.id, role: u.role, passageId: g.ids[1], answers: { [d.passages[0]!.questions[0]!.id]: "FALSE" }, check: false });
  await saveGeneralProgress({ userId: u.id, role: u.role, passageId: g.ids[2], answers: {}, check: false });
  await saveGeneralProgress({ userId: u.id, role: u.role, passageId: g.ids[3], answers: { [d.passages[2]!.questions[0]!.id]: "yes" }, check: true });
  await saveGeneralProgress({ userId: u.id, role: u.role, passageId: g.ids[1], answers: { [d.passages[0]!.questions[0]!.id]: "TRUE" }, check: false });
  const rows = await generalProgress(u.id, g.setId);
  assert.equal(rows.length, 3, "one row per passage (upsert, no duplicates)");
  const by = Object.fromEntries(rows.map((r) => [r.passageId, r]));
  assert.equal(by[g.ids[1]]!.answers[d.passages[0]!.questions[0]!.id], "TRUE");
  assert.equal(by[g.ids[3]]!.score, 1);
  assert.ok(by[g.ids[3]]!.checkedAt);
  const list = (await listGeneralSets(u.id)).find((s) => s.id === g.setId)!;
  assert.equal(list.started, 3);
  assert.equal(list.checked, 1);
});

test("23 progress is per learner and cannot target Academic passages", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const a = await learner(); const b = await learner();
  await saveGeneralProgress({ userId: a.id, role: a.role, passageId: g.ids[1], answers: {}, check: false });
  assert.equal((await generalProgress(b.id, g.setId)).length, 0);
  const academic = await academicPassage(at(await g.occ(1), P1, "bank")!.lexemeId!);
  assert.equal(await saveGeneralProgress({ userId: a.id, role: a.role, passageId: academic.passageId, answers: {}, check: false }), null);
  assert.equal((await db.select().from(generalReadingProgress).where(eq(generalReadingProgress.passageId, academic.passageId))).length, 0);
});

test("24 import is idempotent on sourceRef and canonical ids are stable on re-run", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet();
  const before = (await g.occ(1)).map((r) => `${r.id}:${r.lexemeId}`);
  const again = await db.transaction((tx) => importGeneralReadingSet(tx, g.bundle));
  assert.equal(again.created, false);
  assert.equal(again.setId, g.setId);
  assert.deepEqual((await g.occ(1)).map((r) => `${r.id}:${r.lexemeId}`), before);
  assert.equal((await db.select().from(generalReadingPassages).where(eq(generalReadingPassages.setId, g.setId))).length, 3);
});

test("25 existing ids unchanged: adding General content never touches existing Academic rows or learner items", { skip: !enabled }, async () => {
  isolated();
  const u = await learner();
  const seed = await generalSet();
  const academic = await academicPassage(at(await seed.occ(1), P1, "bank")!.lexemeId!, { userId: u.id, status: "completed" });
  // A historically saved item remains valid; the new Academic policy must not delete it.
  const saved = await addVocabularyBatch({userId:u.id,sourceType:"manual",sourceId:null,items:[{term:"bank",partOfSpeech:"noun",definitionEn:seed.money,canonicalLexemeId:at(await seed.occ(1), P1, "bank")!.lexemeId!}]});
  assert.ok(saved.ok);
  const snap = async () => JSON.stringify(await db.execute(sql`select
      (select row_to_json(p) from reading_passages p where id = ${academic.passageId}) p,
      (select row_to_json(o) from lexical_occurrences o where id = ${academic.occurrenceId}) o,
      (select row_to_json(v) from user_vocabulary v where id = ${saved.ids[0]!}) v,
      (select count(*) from general_reading_passages where passage_id = ${academic.passageId}) g`).then((r) => r.rows));
  const before = await snap();
  await generalSet();
  assert.equal(await snap(), before);
});

test("26 VD-001 occurrence-less Reading save gate: active exam locked, forged source not found, General allowed and Academic review locked", { skip: !enabled }, async () => {
  isolated();
  const g = await generalSet(); const u = await learner(); const other = await learner();
  const lex = at(await g.occ(1), P1, "bank")!.lexemeId!;
  const exam = await academicPassage(lex, { userId: u.id, status: "in_progress" });
  const done = await academicPassage(lex, { userId: u.id, status: "completed" });
  assert.equal(await readingSourceAccess(u, exam.attemptId!), "locked", "active attempt id");
  assert.equal(await readingSourceAccess(u, exam.passageId), "locked", "passage-id bypass");
  assert.equal(await readingSourceAccess(u, randomUUID()), "not_found", "forged source id");
  assert.equal(await readingSourceAccess(other, done.attemptId!), "not_found", "another learner's attempt id is not a source for them (IDOR)");
  assert.equal(await readingSourceAccess(u, done.attemptId!), "locked");
  assert.equal(await readingSourceAccess(u, g.ids[2]), "allowed", "General passage");
  const draft = await generalSet(false);
  assert.equal(await readingSourceAccess(u, draft.ids[1]), "not_found", "draft General is invisible to a learner");
});
