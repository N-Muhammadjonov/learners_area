/**
 * Vocabulary forensic acceptance — HTTP E2E against a LOCAL production build.
 *
 *   npm run build
 *   AUTH_SECRET=… STORAGE_PROVIDER=local DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 npx next start -H 127.0.0.1 -p 3100
 *   AUTH_SECRET=… STORAGE_PROVIDER=local DATABASE_URL=… npx tsx --conditions=react-server scripts/qa2-vocabulary-acceptance-e2e.ts
 *
 * ISOLATED QA2 ONLY: refuses any database other than localhost/learners_qa2. Creates
 * test-only fixtures (never publication content). Every check hits the real server
 * over HTTP; DB reads only verify persisted truth. Never prints secrets.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createSessionToken } from "../src/lib/auth/session";
import { db } from "../src/db/client";
import { importGeneralReadingSet } from "../src/lib/services/reading/general-import";
import { ingestListeningOccurrences, listeningVocabularySession } from "../src/lib/services/lexical/listening-occurrences";

const dbUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname) || dbUrl.pathname !== "/learners_qa2") { console.error("refusing: only the isolated local learners_qa2 database"); process.exit(2); }
const BASE = "http://127.0.0.1:3100";
const c = new pg.Client("postgres://postgres@localhost:5432/learners_qa2"); await c.connect();
const q = async (s: string, a: unknown[] = []) => (await c.query(s, a)).rows;
const results: { id: string; ok: boolean; info: string }[] = [];
const check = (id: string, ok: boolean, info = "") => results.push({ id, ok, info });
const tag = randomUUID().slice(0, 8);
const MONEY = `E2E-${tag} business that keeps and lends money`;

// ---------- fixtures (authored, test-only) ----------
const P1 = "She deposited her salary in the bank. They rested on the river bank. He took the cost into account. She runs daily; she ran yesterday and is running now.";
const P2 = "Our bank charges a small fee. Farmers bought seed in spring.";
const P3 = "Every bank in town closed early. <b>Bold</b> text stays text.";
const set = await db.transaction((tx) => importGeneralReadingSet(tx, {
  sourceRef: `e2e-audit-${tag}`, title: `Audit set ${tag}`, description: "fixture", level: "B1", publish: true,
  passages: [
    { passageNo: 1, title: "Money and rivers", body: P1, questions: [{ questionNo: 1, type: "true_false_not_given", text: "Salary deposited.", answer: "TRUE", accepted: [], evidence: "They rested on the river bank.", explanation: "" }],
      vocabulary: [
        { word: "bank", pos: "noun", def: MONEY, uz: "bank", ex: "She deposited her salary in the bank." },
        { word: "take into account", pos: "phrase", def: `E2E-${tag} to consider`, uz: "", ex: "He took the cost into account.", surfaces: ["took the cost into account"] },
        { word: "run", pos: "verb", def: `E2E-${tag} move fast on foot`, uz: "", ex: "She runs daily; she ran yesterday and is running now." },
        { word: "the", pos: "det", def: `E2E-${tag} article`, uz: "", ex: "She deposited her salary in the bank." },
      ] },
    { passageNo: 2, title: "Fees", body: P2, questions: [], vocabulary: [
      { word: "bank", pos: "noun", def: MONEY, uz: "bank", ex: "Our bank charges a small fee." },
      { word: "buy", pos: "verb", def: `E2E-${tag} get by paying`, uz: "", ex: "Farmers bought seed in spring." }] },
    { passageNo: 3, title: "Town", body: P3, questions: [{ questionNo: 1, type: "yes_no_not_given", text: "Closed early.", answer: "YES", accepted: [], explanation: "" }],
      vocabulary: [{ word: "bank", pos: "noun", def: MONEY, uz: "bank", ex: "Every bank in town closed early." }] },
  ],
}));
const gp = Object.fromEntries(set.passages.map((p) => [p.passageNo, p.passageId])) as Record<1 | 2 | 3, string>;
const occAt = async (pid: string, body: string, surface: string, nth = 0) => {
  let i = -1; for (let k = 0; k <= nth; k += 1) i = body.indexOf(surface, i + 1);
  return (await q("select id, lexeme_id from lexical_occurrences where passage_id=$1 and start_char=$2", [pid, i]))[0];
};
const bankG1 = await occAt(gp[1], P1, "bank"), riverG1 = await occAt(gp[1], P1, "bank", 1), mweG1 = await occAt(gp[1], P1, "took the cost into account");
const ranG1 = await occAt(gp[1], P1, "ran"), runningG1 = await occAt(gp[1], P1, "running"), runsG1 = await occAt(gp[1], P1, "runs");
const bankG2 = await occAt(gp[2], P2, "bank"), boughtG2 = await occAt(gp[2], P2, "bought"), bankG3 = await occAt(gp[3], P3, "bank");
const theCount = (await q("select count(*)::int n from lexical_occurrences where passage_id=$1 and lower(surface_form)='the'", [gp[1]]))[0].n;

const mkUser = async (name: string) => (await q("insert into users (name, role, account_status) values ($1,'student','active') returning id", [name]))[0].id as string;
const A = await mkUser("E2E A"), B = await mkUser("E2E B");
const [owner] = await q("select id from users where is_owner limit 1");

// Academic: same canonical financial sense + a separate river sense
const AB = "She deposited her salary in the bank. They rested on the river bank.";
const [riverLex] = await q("insert into lexemes (term, part_of_speech, definition_en, sense_key, provenance, verification_status) values ('bank','noun',$1,$2,'authored','verified') returning id", [`E2E-${tag} land beside a river`, `e2e-river-${tag}`]);
const academic = async (status: "in_progress" | "completed", user = A) => {
  const [p] = await q("insert into reading_passages (title, body_text, publication_state, test_no, passage_no) values ($1,$2,'published',12,1) returning id", [`Academic ${tag}`, AB]);
  const [money] = await q("insert into lexical_occurrences (lexeme_id, passage_id, surface_form, start_char, end_char, sentence_text, occurrence_type, is_target_vocabulary) values ($1,$2,'bank',$3,$4,$5,'vocabulary',true) returning id", [bankG1.lexeme_id, p.id, AB.indexOf("bank"), AB.indexOf("bank") + 4, "She deposited her salary in the bank."]);
  const r = AB.indexOf("bank", AB.indexOf("bank") + 1);
  const [river] = await q("insert into lexical_occurrences (lexeme_id, passage_id, surface_form, start_char, end_char, sentence_text, occurrence_type, is_target_vocabulary) values ($1,$2,'bank',$3,$4,$5,'vocabulary',true) returning id", [riverLex.id, p.id, r, r + 4, "They rested on the river bank."]);
  const [a] = await q(`insert into reading_attempts (user_id, passage_id, status, submitted_at) values ($1,$2,$3,${status === "completed" ? "now()" : "null"}) returning id`, [user, p.id, status]);
  return { passageId: p.id as string, money: money.id as string, river: river.id as string, attemptId: a.id as string };
};
const exam = await academic("in_progress"), review = await academic("completed");

// Listening: same financial sense authored in the first sentence only
const T = "I opened an account at the bank. They sat on the river bank.";
const [lt] = await q("insert into listening_tests (created_by_user_id, title, audio_type, audio_url) values ($1,$2,'audio','/api/resources/e2e') returning id", [owner.id, `Listening ${tag}`]);
const payload = { testId: `e2e-${tag}`, sections: [{ number: 2, title: "S2", transcript: T }], vocabulary: [{ word: "bank", pos: "noun", def: MONEY, ex: "I opened an account at the bank.", uz: "PACKAGE-ONLY uz", also: [], quiz: [] }], questions: [] };
await q("insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash) values ($1,$2,$3::jsonb,'e2e-audio',$4)", [lt.id, `e2e-${tag}`, JSON.stringify(payload), "0".repeat(64)]);
await db.transaction((tx) => ingestListeningOccurrences(tx, lt.id, payload as never));
const lOcc = await q("select id, lexeme_id, start_char, start_ms, end_ms from lexical_occurrences where listening_test_id=$1 order by start_char", [lt.id]);
const lMoney = lOcc.find((o) => o.start_char === T.indexOf("bank")), lRiver = lOcc.find((o) => o.start_char === T.lastIndexOf("bank"));
const session = await listeningVocabularySession(db, lt.id, payload.vocabulary as never);
const sessionSense = session[0]!.senseId!;
const [lAttempt] = await q("insert into listening_attempts (user_id, test_id, status) values ($1,$2,'in_progress') returning id", [A, lt.id]);

const tokenFor = (id: string, name: string) => createSessionToken({ sub: id, role: "student", name, locale: "en", onboarded: true } as never);
const TA = await tokenFor(A, "E2E A"), TB = await tokenFor(B, "E2E B");
const H = (t: string) => ({ cookie: `la_session=${t}`, origin: BASE, "content-type": "application/json" });
const get = (p: string, t = TA) => fetch(BASE + p, { headers: H(t), redirect: "manual" });
const post = (p: string, b: unknown, t = TA) => fetch(BASE + p, { method: "POST", headers: H(t), body: JSON.stringify(b) });
const lookup = (st: string, src: string, o: string, extra = "", t = TA) => get(`/api/vocabulary/lookup?sourceType=${st}&sourceId=${src}&occurrenceId=${o}${extra}`, t);
const save = (st: string, src: string, o: string | undefined, extra: object = {}, t = TA) => post("/api/vocabulary", { sourceType: st, sourceId: src, ...(o ? { occurrenceId: o } : {}), items: [{ term: "bank" }], ...extra }, t);
const body = async (r: Response) => { const s = await r.text(); try { return JSON.parse(s); } catch { return { raw: s.slice(0, 80) }; } };
const items = async (u: string, lex: string) => (await q("select id, srs_stage, interval_days, next_review_at from user_vocabulary where user_id=$1 and lexeme_id=$2", [u, lex]));

// ================= ACADEMIC =================
let r = await get(`/reading/attempts/${exam.attemptId}`); let html = await r.text();
check("AR-01 active exam HTML is plain text", r.status === 200 && html.includes("data-exam-passage-text") && !html.includes("data-clickable-text"), String(r.status));
check("AR-02 no occurrence/sense ids or definitions in exam payload", !html.includes(exam.money) && !html.includes(exam.river) && !html.includes(bankG1.lexeme_id) && !html.includes(MONEY), "");
r = await lookup("reading", exam.attemptId, exam.money); check("AR-06 lookup by active attempt id -> 403 lexical_assistance_locked", r.status === 403 && (await body(r)).error === "lexical_assistance_locked", String(r.status));
r = await lookup("reading", exam.passageId, exam.money); check("AR-07 passage-id bypass -> 403", r.status === 403, String(r.status));
r = await lookup("reading", exam.attemptId, exam.money, `&mode=GENERAL_READING&readingMode=general_practice&generalSetId=${set.setId}`); check("AR-08 forged General mode (lookup) -> 403", r.status === 403, String(r.status));
r = await save("reading", exam.attemptId, exam.money, { mode: "GENERAL_READING", readingMode: "general_practice" }); check("AR-05 Add to Vocabulary by API during exam (occurrence) -> 403", r.status === 403, String(r.status));
r = await save("reading", exam.attemptId, undefined, { items: [{ term: "bank", definitionEn: "my own" }] }); check("VD-001 save WITHOUT occurrence during active exam -> 403", r.status === 403 && (await body(r)).error === "lexical_assistance_locked", String(r.status));
r = await save("reading", exam.passageId, undefined, { items: [{ term: "bank", definitionEn: "my own" }] }); check("VD-001 save without occurrence via passage id during exam -> 403", r.status === 403, String(r.status));
r = await save("reading", randomUUID(), undefined, { items: [{ term: "bank", definitionEn: "x" }] }); check("VD-001 forged Reading source id -> 404", r.status === 404, String(r.status));
r = await lookup("reading", gp[1], exam.money); check("AR-08b Academic occurrence through a General passage id -> rejected", r.status === 404, String(r.status));
r = await lookup("reading", review.attemptId, review.money); let j = await body(r);
check("AR-10 review: financial bank exact sense", r.status === 200 && j.status === "resolved" && j.contextual?.definitionEn === MONEY, String(r.status));
r = await lookup("reading", review.attemptId, review.river); j = await body(r);
check("BANK-POLYSEMY review: river bank -> river sense (distinct)", r.status === 200 && /land beside a river/.test(j.contextual?.definitionEn ?? ""), String(r.status));
r = await lookup("reading", review.attemptId, review.money, "", TB); check("SEC IDOR: B cannot use A's attempt id", r.status === 404 || r.status === 403, String(r.status));

// ================= GENERAL READING =================
r = await get("/reading/general"); html = await r.text(); check("GR-01 list page", r.status === 200 && html.includes(`Audit set ${tag}`), String(r.status));
r = await get(`/reading/general/${set.setId}`); html = await r.text(); check("GR-01 chooser offers P1/P2/P3/Full", ["1", "2", "3", "full"].every((m) => html.includes(`?passage=${m}`)), String(r.status));
for (const n of [1, 2, 3]) {
  r = await get(`/reading/general/${set.setId}?passage=${n}`); html = await r.text();
  check(`GR-0${n + 1} Passage ${n} page renders interactive text`, r.status === 200 && html.includes("data-clickable-text") && html.includes(`data-general-passage="${n}"`) && !html.includes("data-exam-passage-text"), String(r.status));
}
r = await get(`/reading/general/${set.setId}?passage=full`); html = await r.text();
check("GR-05 Full Reading: 3 tabs + interactive text", r.status === 200 && (html.match(/data-general-passage-tab=/g) ?? []).length === 3 && html.includes("data-clickable-text"), String(r.status));
check("GR-payload answer key not shipped before Check", !html.includes(">TRUE<") && !html.includes('"correctAnswer"'), "");
for (const [n, o] of [[1, bankG1], [2, bankG2], [3, bankG3]] as const) {
  r = await lookup("reading", gp[n], o.id); j = await body(r);
  check(`GR-08/09 P${n} bank resolves by occurrence to the exact sense, no attempt`, r.status === 200 && j.status === "resolved" && j.contextual?.definitionEn === MONEY, String(r.status));
}
r = await lookup("reading", gp[1], riverG1.id); j = await body(r); check("GR-10 trap: river bank unresolved, no meaning", r.status === 200 && j.status === "unresolved" && !j.contextual, `${r.status} ${j.status}`);
r = await save("reading", gp[1], undefined); check("VD-001 unresolved Save w/o meaning -> 422 needs_definition (no spelling sense)", r.status === 422 && (await body(r)).error === "needs_definition", String(r.status));
r = await save("reading", gp[1], undefined, { items: [{ term: "bank", definitionEn: `own-${tag} riverside` }] }); j = await body(r);
const own = await q("select l.definition_en d, l.id from user_vocabulary v join lexemes l on l.id=v.lexeme_id where v.user_id=$1 and l.definition_en=$2", [A, `own-${tag} riverside`]);
check("VD-001 learner's own meaning saved as its own entry (never the catalogue/financial sense)", r.status === 200 && own.length === 1 && own[0].id !== bankG1.lexeme_id, String(r.status));
r = await lookup("reading", gp[1], mweG1.id); j = await body(r); check("GR-11 MWE 'took the cost into account' -> take into account", j.status === "resolved" && /to consider/.test(j.contextual?.definitionEn ?? ""), "");
const runLex = new Set([runsG1?.lexeme_id, ranG1?.lexeme_id, runningG1?.lexeme_id]);
r = await lookup("reading", gp[1], ranG1.id); j = await body(r);
check("GR-12 inflections runs/ran/running -> one sense; bought -> buy", runLex.size === 1 && !runLex.has(undefined) && /move fast/.test(j.contextual?.definitionEn ?? "") && /get by paying/.test((await body(await lookup("reading", gp[2], boughtG2.id))).contextual?.definitionEn ?? ""), [...runLex].join(","));
check("FUNCTION-WORD standalone 'the' is not a target", theCount === 0, String(theCount));
r = await save("reading", gp[1], bankG1.id); const s1 = await body(r); check("GR save P1", r.status === 200 && s1.ok, String(r.status));
r = await save("reading", gp[3], bankG3.id); await body(r);
let it = await items(A, bankG1.lexeme_id); check("GR-16 P1+P3 same sense -> one item", it.length === 1, String(it.length));

// ================= LISTENING =================
r = await lookup("listening", lt.id, lMoney.id); check("L-02 Activity 1 open exam: lookup -> 403", r.status === 403, String(r.status));
r = await get(`/api/vocabulary/meaning?sourceId=${lt.id}&q=bank`); check("L-03 meaning endpoint -> 403 during exam", r.status === 403, String(r.status));
r = await save("listening", lt.id, lMoney.id); check("L-04 save during exam -> 403", r.status === 403, String(r.status));
r = await post("/api/vocabulary", { sourceType: "listening", sourceId: lt.id, sessionSenseId: sessionSense, items: [{ term: "bank" }] }); check("L-03b Activity 5 save during open exam -> 403", r.status === 403, String(r.status));
await q("update listening_attempts set status='completed', submitted_at=now() where id=$1", [lAttempt.id]);
r = await lookup("listening", lt.id, lMoney.id); j = await body(r); check("L-05/06 review: financial bank exact sense", r.status === 200 && j.status === "resolved" && j.contextual?.definitionEn === MONEY, String(r.status));
r = await lookup("listening", lt.id, lRiver?.id ?? randomUUID()); j = await body(r); check("L-07/08 one-meaning trap: river bank unresolved", lRiver && lRiver.lexeme_id === null && r.status === 200 && j.status === "unresolved", `${r.status} ${j.status}`);
check("L-11 timestamps null (no word timing in source)", lOcc.every((o) => o.start_ms === null && o.end_ms === null), "");
check("L-12 Activity 5 sense is the canonical one (same as Reading)", session[0]!.senseId === bankG1.lexeme_id, "");
r = await post("/api/vocabulary", { sourceType: "listening", sourceId: lt.id, sessionSenseId: riverLex.id, items: [{ term: "bank" }] }); check("VD-002 forged sessionSenseId (valid sense from another source) -> 404", r.status === 404, String(r.status));
check("VD-002 forged sense not saved", (await items(A, riverLex.id)).length === 0, "");
r = await save("listening", lt.id, lMoney.id); check("L save from review", r.status === 200, String(r.status));
r = await post("/api/vocabulary", { sourceType: "listening", sourceId: lt.id, sessionSenseId: sessionSense, items: [{ term: "bank" }] }); check("L-14 Activity 5 save same sense ok", r.status === 200, String(r.status));
r = await save("listening", lt.id, undefined); check("L-09 listening word w/o occurrence + no meaning -> 422", r.status === 422, String(r.status));
await q("insert into listening_attempts (user_id, test_id, status) values ($1,$2,'in_progress')", [A, lt.id]);
r = await lookup("listening", lt.id, lMoney.id); check("L-03c new open attempt re-locks review", r.status === 403, String(r.status));

// ================= CROSS-SOURCE / STATE =================
r = await save("reading", review.attemptId, review.money); await body(r);
it = await items(A, bankG1.lexeme_id);
const ctx = await q("select snapshot from user_vocabulary_contexts where user_vocabulary_id=$1", [it[0].id]);
check("CROSS one item for Academic review + General P1/P3 + Listening", it.length === 1, String(it.length));
const kinds = ctx.map((x) => x.snapshot.readingMode ?? x.snapshot.sourceType);
check("CROSS contexts: 2 General + 1 Academic + 1 Listening", kinds.filter((k) => k === "general_practice").length === 2 && kinds.filter((k) => k === "listening").length === 1 && ctx.some((x) => x.snapshot.attemptId === review.attemptId), JSON.stringify(kinds));
check("GR-13 General context truthful (set, passageNo, sentence, no attempt id)", ctx.filter((x) => x.snapshot.readingMode === "general_practice").every((x) => x.snapshot.generalSetId === set.setId && !x.snapshot.attemptId && x.snapshot.sentenceText), "");
r = await save("reading", review.attemptId, review.river); await body(r);
check("BANK-POLYSEMY river saved as a separate item", (await items(A, riverLex.id)).length === 1 && (await items(A, bankG1.lexeme_id)).length === 1, "");
const [{ cnt }] = await q("select count(*)::int cnt from user_vocabulary where user_id=$1 and lexeme_id=$2", [A, bankG1.lexeme_id]);
const dbl = await Promise.all([save("reading", gp[2], bankG2.id), save("reading", gp[2], bankG2.id), save("reading", gp[2], bankG2.id)]);
const [{ cnt2 }] = await q("select count(*)::int cnt2 from user_vocabulary where user_id=$1 and lexeme_id=$2", [A, bankG1.lexeme_id]);
const [{ c2 }] = await q("select count(*)::int c2 from user_vocabulary_contexts where user_vocabulary_id=$1 and occurrence_id=$2", [it[0].id, bankG2.id]);
check("CONCURRENT 3 parallel saves: no 500, one item, one context", dbl.every((x) => x.status === 200) && cnt === 1 && cnt2 === 1 && c2 === 1, dbl.map((x) => x.status).join(","));
r = await get(`/api/vocabulary/${it[0].id}/contexts`); j = await body(r); const hrefs: string[] = (j.contexts ?? []).map((x: { revisitHref: string }) => x.revisitHref);
check("REVISIT General ?passage=1/3, Academic attempt, Listening section", hrefs.includes(`/reading/general/${set.setId}?passage=1`) && hrefs.includes(`/reading/general/${set.setId}?passage=3`) && hrefs.includes(`/reading/attempts/${review.attemptId}`) && hrefs.some((h) => h.startsWith(`/listening/tests/${lt.id}/study`)), JSON.stringify(hrefs));
r = await get(`/api/vocabulary/${it[0].id}/contexts`, TB); check("SEC B cannot read A's contexts (IDOR)", r.status === 404, String(r.status));
r = await post(`/api/vocabulary/${it[0].id}/review`, { outcome: "correct" }, TB); check("SEC B cannot review A's item", r.status === 404, String(r.status));
const canonBefore = JSON.stringify(await q("select * from lexemes where id=$1", [bankG1.lexeme_id]));
r = await post(`/api/vocabulary/${it[0].id}/review`, { outcome: "correct" }); const rev = r.status;
const afterReview = (await items(A, bankG1.lexeme_id))[0];
r = await save("reading", gp[2], bankG2.id);
const afterReencounter = (await items(A, bankG1.lexeme_id))[0];
check("SRS review over HTTP ok; canonical sense unchanged", rev === 200 && JSON.stringify(await q("select * from lexemes where id=$1", [bankG1.lexeme_id])) === canonBefore, String(rev));
check("SRS re-encounter does not reset schedule", String(afterReview.next_review_at) === String(afterReencounter.next_review_at) && afterReview.srs_stage === afterReencounter.srs_stage && afterReview.interval_days === afterReencounter.interval_days, "");
check("SRS isolation: B has no item for the sense", (await items(B, bankG1.lexeme_id)).length === 0, "");
r = await get("/api/vocabulary?limit=200"); j = await body(r); check("REFRESH GET /api/vocabulary shows the sense once", r.status === 200 && (j.words ?? []).filter((w: { lexemeId?: string; definitionEn?: string }) => w.definitionEn === MONEY).length === 1, String(r.status));
const TA2 = await tokenFor(A, "E2E A"); r = await get("/api/vocabulary?limit=200", TA2); j = await body(r); check("RELOGIN (fresh session token) still one item", (j.words ?? []).filter((w: { definitionEn?: string }) => w.definitionEn === MONEY).length === 1, String(r.status));
r = await lookup("reading", gp[1], bankG1.id); j = await body(r); check("POPUP knows saved state after refresh", j.known?.id === it[0].id, JSON.stringify(j.known));
const [qq] = await q("select id from reading_questions where passage_id=$1", [gp[1]]);
r = await post("/api/reading/general/progress", { passageId: gp[1], answers: { [qq.id]: "true" }, check: true }); j = await body(r);
check("GR-15 progress Check grades + evidence quote; evidence created no sense", r.status === 200 && j.score === 1 && j.result?.[0]?.evidenceQuote === "They rested on the river bank." && riverG1.lexeme_id === null, String(r.status));
r = await post("/api/reading/general/progress", { passageId: gp[3], answers: {}, check: false }); await body(r);
r = await get(`/reading/general/${set.setId}?passage=1`); html = await r.text(); check("GR-15 reload shows saved score", html.includes("data-general-score"), "");
check("GR-15 per-passage rows", (await q("select count(*)::int n from general_reading_progress where user_id=$1", [A]))[0].n === 2, "");
r = await post("/api/reading/general/progress", { passageId: exam.passageId, answers: {}, check: true }); check("GR-07 progress API refuses Academic passage", r.status === 404, String(r.status));
r = await post("/api/vocabulary", "not json"); check("API malformed payload -> 400 (no stack)", r.status === 400 && !(await r.text()).includes("at "), String(r.status));
r = await post("/api/vocabulary", { sourceType: "reading", sourceId: gp[1], occurrenceId: "not-a-uuid", items: [{ term: "bank" }] }); check("API forged occurrence id -> 4xx", r.status >= 400 && r.status < 500, String(r.status));
await q("insert into reading_attempts (user_id, passage_id, status) values ($1,$2,'in_progress')", [A, review.passageId]);
r = await lookup("reading", review.attemptId, review.money); check("AR-09 retake re-locks the old review", r.status === 403, String(r.status));
r = await lookup("reading", gp[1], bankG1.id); check("GR unaffected by Academic retake", r.status === 200, String(r.status));

for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${x.id}${x.ok ? "" : `  <${x.info}>`}`);
console.log(`E2E ${results.filter((x) => x.ok).length}/${results.length}`);
await c.end(); process.exit(0);
