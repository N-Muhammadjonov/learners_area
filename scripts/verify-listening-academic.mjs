#!/usr/bin/env node
/**
 * Built-server acceptance for the ACADEMIC LISTENING catalogue and its TEST HUBS.
 *
 *   LD_LIBRARY_PATH=/tmp/qa2-pg/package/native/lib \
 *   BASE_URL=http://127.0.0.1:3100 DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
 *   AUTH_SECRET=<the server's secret> node scripts/verify-listening-academic.mjs
 *
 * This is the scenario a learner performs: open Academic Listening, see the centre's
 * published tests, open ONE, and get a hub whose cards match what that test really is.
 * It runs against `next build` + `next start` on the ISOLATED local QA2 database (it
 * refuses any other target) with a session minted from the server's own AUTH_SECRET, so
 * every request travels the real authorization path.
 *
 * What it proves:
 *   C1–C2 the catalogue lists the PUBLISHED academic tests, read from the canonical layer;
 *   C3    a DRAFT academic test is invisible to a learner;
 *   C4    a general-collection test is not academic material and does not appear;
 *   C5    the catalogue is ordered by the authored sequence, not by a title;
 *   H1    the rich fixture's hub shows the activities it supports — MCQ Mastery, Matching
 *         Mastery, Form & Note Completion, Script Completion — and no Retry before any attempt;
 *   H2    the completion-only fixture's hub is DIFFERENT and smaller: no MCQ, no Matching,
 *         no transcript work, no vocabulary — never padded to look alike;
 *   H3    after a submitted attempt with a real mistake, both hubs gain Review by Part and
 *         Retry Weak Areas — the cards exist because the learner's own result does;
 *   H4    no answer key reaches the hub before it may;
 *   H5    a draft hub and a non-academic hub are not found, leaking nothing.
 *
 * Every fixture it creates is deleted at the end, and the cleanup is verified.
 */
import pg from "pg";
import { SignJWT } from "jose";
import { assertIsolatedTarget } from "./qa2-seed-fixtures.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const SECRET = process.env.AUTH_SECRET ?? "";
if (SECRET.length < 16) throw new Error("AUTH_SECRET must be set (the server's own secret)");
assertIsolatedTarget(DATABASE_URL);

const STUDENT = "qa2-student@learners-qa.invalid";
const OWNER = "qa2-owner@learners-qa.invalid";

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "not ok"} - ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (ok) pass += 1;
  else failures.push(name);
};

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

async function cookieFor(user) {
  const token = await new SignJWT({ sub: user.id, role: user.role, name: user.name, locale: "en", onboarded: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  // The app's own locale cookie: without it the interface is Uzbek by default, and an
  // assertion written in English would be testing the wrong dictionary.
  return `la_session=${token}; la_locale=en`;
}

/**
 * The ids of the activity CARDS a hub rendered, in order. Structural markers cannot be
 * confused with shell navigation, which is where a whole-page text search goes wrong.
 */
function cardIds(html) {
  return [...html.matchAll(/data-listening-academic-activity="([a-z0-9]+)"/g)].map((match) => match[1]);
}

/** One card's markup, so a label is checked inside the card rather than anywhere on screen. */
function cardSlice(html, id) {
  const marker = `data-listening-academic-activity="${id}"`;
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const next = html.indexOf("data-listening-academic-activity=", at + marker.length);
  return html.slice(at, next < 0 ? html.length : next);
}

async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: res.status, text: await res.text() };
}

/** A distinct, searchable answer key: if it ever reaches a learner surface, H4 fails. */
const SECRET_KEY = "QASECRETKEY-MUSEUM";

const PARTS = [
  "Good morning and welcome to the museum. Today we are opening the new gallery, and the first room holds the oldest items in the collection.",
  "The second part looks at how the collection itself was gathered. A local family donated most of the pieces in nineteen fifty-two.",
  "Now let us turn to how the items were valued. An independent expert estimated the whole group at two million pounds.",
  "Finally, the panel answers questions from the audience. One visitor asked whether the museum lends objects to other cities.",
];

function packageFor(kind) {
  const gaps = PARTS.map((_, index) => ({ part: index + 1, transcript: PARTS[index], gaps: [{ q: index + 1, match: index === 0 ? "museum" : "the", answer: "the" }] }));
  const rich = {
    schemaVersion: 1,
    collection: "academic",
    testId: kind === "rich" ? "qa2-academic-rich" : "qa2-academic-completion-only",
    title: kind === "rich" ? "Academic rich fixture" : "Academic completion fixture",
    category: "full",
    provenance: "QA2 built-server fixture (Academic Listening acceptance)",
    audio: { path: "audio.mp3", durationSec: 1800 },
    imagePath: null,
    sections: PARTS.map((transcript, index) => ({ number: index + 1, title: `Part ${index + 1}`, transcript, reviewRequired: false })),
    questions:
      kind === "rich"
        ? [
            { number: 1, section: 1, text: "Where does the talk begin?", instruction: "Choose the correct answer", kind: "mcq", options: ["A) a museum", "B) a library", "C) a theatre"], key: SECRET_KEY, alternatives: [], pair: [], evidence: { at: 10, why: "The speaker says so" } },
            { number: 2, section: 2, text: "Match the source", instruction: "Choose the correct answer", kind: "matching", options: ["A) donated", "B) bought", "C) lent"], key: "A", alternatives: [], pair: [], evidence: { at: 30, why: "The speaker says so" } },
            { number: 3, section: 3, text: "The whole group was valued at…", instruction: "Write ONE WORD", kind: "completion", options: [], key: "pounds", alternatives: [], pair: [], evidence: { at: 60, why: "The speaker says so" } },
          ]
        : [{ number: 1, section: 3, text: "The whole group was valued at…", instruction: "Write ONE WORD", kind: "completion", options: [], key: "pounds", alternatives: [], pair: [], evidence: { at: 60, why: "The speaker says so" } }],
    keyword1: [],
    keyword2: [],
    vocabulary: kind === "rich" ? [{ word: "collection", pos: "noun", uz: "to'plam", def: "a group of gathered items", ex: "The collection grew.", also: [] }] : [],
    studyPack: {
      kind: "research-practice",
      activities: kind === "rich" ? ["exam", "review", "script", "mcq", "matching", "completion", "vocab", "retry"] : ["exam", "review", "completion", "retry"],
      partRanges: { "1": [0, 400], "2": [400, 800], "3": [800, 1200], "4": [1200, 1700] },
      scriptParts: kind === "rich" ? gaps : [],
      recall: [],
    },
  };
  return rich;
}

/**
 * A minimal published Academic test, used only to build a catalogue larger than one page.
 * `collection: academic` is authored classification, so its product is an academic full test.
 */
async function createBulkTest(index, ownerId) {
  const title = `Academic bulk fixture ${String(index).padStart(3, "0")}`;
  const payload = {
    schemaVersion: 1,
    testId: `qa2-academic-bulk-${index}`,
    title,
    collection: "academic",
    sections: [{ sectionNo: 1, title: "Part 1" }],
    questions: [{ number: 1, kind: "completion", text: "Write one word", options: [], key: "form" }],
    studyPack: { keywords: [], script: [] },
  };
  return createTest(payload, { sourceRef: `qa2-academic-bulk-${String(index).padStart(3, "0")}`, state: "published", ownerId, sourceId: `qa2-academic-bulk-${index}` });
}

async function createTest(payload, { sourceRef, state, ownerId, sourceId }) {
  const [test] = await q(
    `insert into listening_tests (title, audio_type, source_ref, publication_state, created_by_user_id, publish_at)
     values ($1, 'audio', $2, $3::publication_state, $4, case when $3::text = 'published' then now() else null end) returning id`,
    [payload.title, sourceRef, state, ownerId],
  );
  await q(
    `insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash, legacy_runtime)
     values ($1, $2, $3, $4, $5, false)`,
    [test.id, sourceId, JSON.stringify(payload), `qa2/${sourceId}/audio.mp3`, "0".repeat(64)],
  );
  for (const question of payload.questions) {
    await q(
      `insert into listening_questions (test_id, "order", type, question_text, options, correct_answer, explanation)
       values ($1, $2, $3, $4, $5, $6, '')`,
      [test.id, question.number, question.kind === "mcq" ? "multiple_choice" : "short_answer", question.text, JSON.stringify(question.options), question.key],
    );
  }
  return test.id;
}

const created = [];
let cookie = "";
try {
  const [student] = await q(`select id, role, name from users where email = $1`, [STUDENT]);
  const [owner] = await q(`select id, role, name from users where email = $1`, [OWNER]);
  if (!student || !owner) throw new Error("QA2 fixtures are missing the owner/student users");
  cookie = await cookieFor(student);

  // Idempotent on re-run: any fixture a previous, interrupted run left behind is removed
  // before this one starts, so the acceptance can be executed twice in a row.
  const stale = await q(`select id from listening_tests where source_ref like 'qa2-academic-%'`);
  if (stale.length) {
    const ids = stale.map((row) => row.id);
    await q(`delete from listening_attempts where test_id = any($1::uuid[])`, [ids]);
    await q(`delete from listening_mcq_sessions where test_id = any($1::uuid[])`, [ids]).catch(() => {});
    await q(`delete from listening_tests where id = any($1::uuid[])`, [ids]);
  }

  const rich = packageFor("rich");
  const completion = packageFor("completion");
  const draftPayload = { ...packageFor("rich"), title: "Academic draft fixture" };
  const generalPayload = { ...packageFor("rich"), collection: "general", title: "General listening fixture" };

  const richId = await createTest(rich, { sourceRef: "qa2-academic-1-rich", state: "published", ownerId: owner.id, sourceId: rich.testId });
  const completionId = await createTest(completion, { sourceRef: "qa2-academic-2-completion", state: "published", ownerId: owner.id, sourceId: completion.testId });
  const draftId = await createTest(draftPayload, { sourceRef: "qa2-academic-3-draft", state: "draft", ownerId: owner.id, sourceId: "qa2-academic-draft" });
  const generalId = await createTest(generalPayload, { sourceRef: "qa2-academic-4-general", state: "published", ownerId: owner.id, sourceId: "qa2-academic-general" });
  created.push(richId, completionId, draftId, generalId);

  /* ---------------------------------------------------------------- catalogue */
  const catalogue = await get("/app/listening/academic", cookie);
  check("C1 the catalogue renders for a signed-in learner", catalogue.status === 200, `status ${catalogue.status}`);
  check("C2 a published academic test is listed", catalogue.text.includes(rich.title), "rich fixture missing from the catalogue");
  check("C2b the second published academic test is listed too", catalogue.text.includes(completion.title));
  check("C3 a draft academic test never appears", !catalogue.text.includes(draftPayload.title), "the draft leaked into the learner catalogue");
  check("C4 a general-collection test is not academic material", !catalogue.text.includes(generalPayload.title), "a general test leaked into the academic catalogue");
  const firstTitle = catalogue.text.indexOf(rich.title);
  const secondTitle = catalogue.text.indexOf(completion.title);
  check("C5 the catalogue follows the authored sequence", firstTitle >= 0 && secondTitle > firstTitle, "fixture A must precede fixture B (authored first)");
  check("C5b the catalogue is read from content, not hard-coded", !catalogue.text.includes("qa2-academic-1-rich"), "the page embeds a fixture reference");

  /* ------------------------------------------------- pagination (no 60-test cap) */
  // 61 more published Academic tests: with the two rich fixtures that is 63 — more than the
  // old hard cap, so a learner reaching the end can PROVE the catalogue does not stop at 60.
  for (let index = 1; index <= 61; index += 1) created.push(await createBulkTest(index, owner.id));
  const pageOne = await get("/app/listening/academic", cookie);
  const pageOneIds = [...pageOne.text.matchAll(/data-listening-academic-card="([0-9a-f-]{36})"/g)].map((match) => match[1]);
  const total = Number(/data-listening-academic-total="(\d+)"/.exec(pageOne.text)?.[1] ?? "0");
  check("P1 the learner-visible catalogue knows every published test", total === 63, `total marker said ${total}`);
  check("P2 one page is bounded and does not download the catalogue", pageOneIds.length === 24, `page 1 carried ${pageOneIds.length} cards`);
  check("P3 page 1 offers the way forward", pageOne.text.includes("data-listening-academic-next"), "no Next link");
  check("P4 there is no Previous link on the first page", !pageOne.text.includes("data-listening-academic-prev"));
  const pageTwo = await get("/app/listening/academic?page=2", cookie);
  const pageTwoIds = [...pageTwo.text.matchAll(/data-listening-academic-card="([0-9a-f-]{36})"/g)].map((match) => match[1]);
  const pageThree = await get("/app/listening/academic?page=3", cookie);
  const pageThreeIds = [...pageThree.text.matchAll(/data-listening-academic-card="([0-9a-f-]{36})"/g)].map((match) => match[1]);
  check("P5 the second page carries the next 24", pageTwoIds.length === 24, `page 2 carried ${pageTwoIds.length} cards`);
  check("P6 the third page carries the remainder", pageThreeIds.length === 15, `page 3 carried ${pageThreeIds.length} cards`);
  check("P7 the last page offers the way back", pageThree.text.includes("data-listening-academic-prev") && !pageThree.text.includes("data-listening-academic-next"));
  const allIds = [...pageOneIds, ...pageTwoIds, ...pageThreeIds];
  check("P8 every published test is reachable exactly once", allIds.length === 63 && new Set(allIds).size === 63, `${allIds.length} cards, ${new Set(allIds).size} distinct`);
  const repeat = await get("/app/listening/academic", cookie);
  const repeatIds = [...repeat.text.matchAll(/data-listening-academic-card="([0-9a-f-]{36})"/g)].map((match) => match[1]);
  check("P9 the order is stable across requests", repeatIds.join() === pageOneIds.join());
  const beyondPage = await get("/app/listening/academic?page=99", cookie);
  const beyondIds = [...beyondPage.text.matchAll(/data-listening-academic-card="([0-9a-f-]{36})"/g)].map((match) => match[1]);
  check("P10 an empty page is honest, not an error", beyondPage.status === 200 && beyondIds.length === 0, `status ${beyondPage.status}`);
  const junkPage = await get("/app/listening/academic?page=-3", cookie);
  check("P11 a nonsense page argument falls back to the first page", junkPage.text.includes(pageOneIds[0]), "clamping is not applied");

  /* --------------------------------------------------------------------- hubs */
  const hubRich = await get(`/app/listening/academic/${richId}`, cookie);
  check("H1 the rich test's hub renders", hubRich.status === 200, `status ${hubRich.status}`);
  check(
    "H1b the rich hub offers exactly the activities this test supports",
    cardIds(hubRich.text).join(",") === "exam,script,mcq,matching,completion,vocab",
    `cards: ${cardIds(hubRich.text).join(",")}`,
  );
  for (const [id, label, name] of [
    ["exam", "Full IELTS Test", "Full IELTS Test"],
    ["script", "Script Completion", "Script Completion"],
    ["mcq", "MCQ Mastery", "MCQ Mastery"],
    ["matching", "Matching Mastery", "Matching Mastery"],
    ["completion", "Form &amp; Note Completion", "Form & Note Completion"],
    ["vocab", "Vocabulary &amp; Collocations", "Vocabulary &amp; Collocations"],
  ]) {
    check(`H1c the ${name} card is titled truthfully`, (cardSlice(hubRich.text, id) ?? "").includes(label), `${name} label missing`);
  }
  check("H1d no Retry card before the learner has an attempt", cardSlice(hubRich.text, "retry") === null, "Retry appeared with no prior attempt");
  check("H1e no Review card before the learner has a result", cardSlice(hubRich.text, "review") === null, "Review appeared with no submitted attempt");
  check("H4 no answer key reaches the hub", !hubRich.text.includes(SECRET_KEY), "a correct answer leaked to the learner surface");

  const hubCompletion = await get(`/app/listening/academic/${completionId}`, cookie);
  check("H2 the completion-only hub renders", hubCompletion.status === 200, `status ${hubCompletion.status}`);
  check(
    "H2b the completion-only hub offers exactly what that test supports",
    cardIds(hubCompletion.text).join(",") === "exam,completion",
    `cards: ${cardIds(hubCompletion.text).join(",")}`,
  );
  check("H2c the Completion card is titled truthfully", (cardSlice(hubCompletion.text, "completion") ?? "").includes("Form &amp; Note Completion"));
  for (const [id, name] of [["mcq", "MCQ Mastery"], ["matching", "Matching Mastery"], ["script", "Script Completion"], ["vocab", "Vocabulary"]]) {
    check(`H2d it does NOT offer ${name}`, cardSlice(hubCompletion.text, id) === null, `${name} was faked for a test that has none`);
  }

  /* ------------------------------------------- a real attempt changes the hub, truthfully */
  const [attempt] = await q(
    `insert into listening_attempts (user_id, test_id, status, score, total_questions, submitted_at)
     values ($1, $2, 'completed', 1, 3, now()) returning id`,
    [student.id, richId],
  );
  const questions = await q(`select id, "order", correct_answer from listening_questions where test_id = $1 order by "order"`, [richId]);
  for (const question of questions) {
    const wrong = question.order === 1;
    await q(
      `insert into listening_answers (attempt_id, question_id, user_answer, is_correct) values ($1, $2, $3, $4)`,
      [attempt.id, question.id, wrong ? "B" : question.correct_answer, !wrong],
    );
  }
  const hubAfter = await get(`/app/listening/academic/${richId}`, cookie);
  check("H3 a submitted result turns Review on", cardSlice(hubAfter.text, "review") !== null, "Review missing after a submitted attempt");
  check("H3b a real mistake turns Retry Weak Areas on", cardSlice(hubAfter.text, "retry") !== null, "Retry missing after a real wrong answer");
  check("H3c the Review card is titled truthfully", (cardSlice(hubAfter.text, "review") ?? "").includes("Review by Part"));
  check("H3d the hub states the learner's real exam result", /Exam result: 1 \/ 3/.test(hubAfter.text), "the exam result is not shown");
  check("H3e the completed exam card says so", (cardSlice(hubAfter.text, "exam") ?? "").includes("Completed"));
  check("H4b the hub still carries no answer key", !hubAfter.text.includes(SECRET_KEY));
  check("H3f the catalogue now reflects this learner's progress", /\d+ \/ \d+ activities completed/.test((await get("/app/listening/academic", cookie)).text));

  /* --------------------------------------------------------- nothing leaks for a learner */
  const draftHub = await get(`/app/listening/academic/${draftId}`, cookie);
  check("H5 a draft hub is not found", !draftHub.text.includes(draftPayload.title), "the draft hub leaked its title");
  check("H5b the draft hub answers through the app's not-found boundary", draftHub.text.includes("NEXT_HTTP_ERROR_FALLBACK") || draftHub.status === 404, `status ${draftHub.status}`);
  const generalHub = await get(`/app/listening/academic/${generalId}`, cookie);
  check("H5c a non-academic test is not a hub of this catalogue", !generalHub.text.includes(generalPayload.title), "a general test rendered as an academic hub");
  const unknownHub = await get(`/app/listening/academic/not-a-uuid`, cookie);
  check("H5d a malformed id answers with the not-found boundary", unknownHub.text.includes("NEXT_HTTP_ERROR_FALLBACK") || unknownHub.status === 404);
} finally {
  /* ---------------------------------------------------------------- cleanup verified */
  // `listening_attempts` references the test without a cascade, so the learner's own rows are
  // removed first (their answers cascade); then the test takes its package and questions with it.
  await q(`delete from listening_attempts where test_id = any($1::uuid[])`, [created]);
  await q(`delete from listening_mcq_sessions where test_id = any($1::uuid[])`, [created]).catch(() => {});
  for (const id of created) await q(`delete from listening_tests where id = $1`, [id]);
  const remaining = await q(`select count(*)::int as count from listening_tests where source_ref like 'qa2-academic-%'`);
  const orphans = await q(`select count(*)::int as count from listening_packages where test_id = any($1::uuid[])`, [created]);
  const questions = await q(`select count(*)::int as count from listening_questions where test_id = any($1::uuid[])`, [created]);
  const attempts = await q(`select count(*)::int as count from listening_attempts where test_id = any($1::uuid[])`, [created]);
  check("Z1 every fixture is deleted", Number(remaining[0].count) === 0, `${remaining[0].count} rows remain`);
  check("Z2 no package, question or attempt is left behind", Number(orphans[0].count) + Number(questions[0].count) + Number(attempts[0].count) === 0);
  const after = await get("/app/listening/academic", cookie);
  check("Z3 the catalogue is clean again", !after.text.includes("Academic rich fixture") && !after.text.includes("Academic completion fixture"));
  await db.end();
}

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${pass}/${pass + failures.length} checks`);
if (failures.length) {
  console.log(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
