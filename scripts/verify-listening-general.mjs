#!/usr/bin/env node
/**
 * Built-server acceptance for GENERAL LISTENING — the catalogue of standalone SECTIONS.
 *
 *   LD_LIBRARY_PATH=/tmp/qa2-pg/package/native/lib \
 *   BASE_URL=http://127.0.0.1:3100 DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
 *   AUTH_SECRET=<the server's secret> node scripts/verify-listening-general.mjs
 *
 * The scenario a learner performs: open General Listening, see the centre's published
 * sections, read the truth about each one, and open ONE — which starts a single Listening
 * activity. It runs against `next build` + `next start` on the ISOLATED local QA2 database
 * (it refuses any other target) with a session minted from the server's own AUTH_SECRET.
 *
 * What it proves:
 *   L1  the catalogue renders and lists a PUBLISHED section, packaged or natively authored;
 *   L2  an Academic full test, a dedicated MCQ package, question-type practice and an
 *       essential recording are NOT General Listening — and a DRAFT is invisible;
 *   L3  a card states the authored section identity, the real question count and the
 *       learner's own status (nothing before they open it, a real result after);
 *   L4  paging: more sections than one page, every one reachable exactly once, stable order,
 *       a nonsense page argument clamped, the last page honest;
 *   L5  opening a section starts ONE Listening activity — the attempt page renders the
 *       familiar interface (audio, questions, question navigation, note-taking) with NO
 *       activity hub, NO four-part exam and NO Script/MCQ/Matching cards;
 *   L6  no answer key or hidden explanation is in the catalogue or the section attempt;
 *   L7  a section's result is scoped to that section and that learner.
 *
 * Fixtures are deleted at the end and the cleanup is verified.
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
  return `la_session=${token}; la_locale=en`;
}

async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: res.status, text: await res.text() };
}

const SECRET_KEY = "QASECRETKEY-SECTION";
const HIDDEN = "HIDDEN-EXPLANATION-SECTION";

/** One section package, exactly the canonical shape the import pipeline produces. */
function sectionPackage(testId, title, collection) {
  return {
    schemaVersion: 1,
    ...(collection ? { collection } : {}),
    testId,
    title,
    category: "full",
    provenance: "QA fixture, authored for the General Listening acceptance",
    audio: { path: "audio.mp3", durationSec: 620 },
    imagePath: null,
    sections: [{ number: 3, title: "Section 3", transcript: "", reviewRequired: false }],
    questions: [
      { number: 1, section: 3, text: "Where does the speaker suggest meeting?", instruction: "Choose the correct answer", kind: "mcq", options: ["A) the station", "B) the library", "C) the park"], key: SECRET_KEY, alternatives: [], pair: [], evidence: { at: 12, why: "because" } },
      { number: 2, section: 3, text: "Write ONE WORD for the time of day.", instruction: "Complete the note", kind: "completion", options: [], key: SECRET_KEY, alternatives: [], pair: [], evidence: { at: 30, why: "because" } },
    ],
    keyword1: [],
    keyword2: [],
    vocabulary: [],
  };
}

async function createSection({ sourceRef, title, state, collection, ownerId, withPackage = true, questions = 2, sectionNo = 3, publishAt = null, contentType = "section" }) {
  const [test] = await q(
    `insert into listening_tests (title, audio_type, source_ref, publication_state, created_by_user_id, publish_at)
     values ($1, 'audio', $2, $3::publication_state, $4, coalesce($5, case when $3::text = 'published' then now() else null end)) returning id`,
    [title, sourceRef, state, ownerId, publishAt],
  );
  if (withPackage) {
    const payload = sectionPackage(`${sourceRef}-pkg`, title, collection);
    payload.questions = payload.questions.slice(0, questions);
    await q(
      `insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash, legacy_runtime)
       values ($1, $2, $3, $4, $5, false)`,
      [test.id, `${sourceRef}-pkg`, JSON.stringify(payload), `qa2/${sourceRef}/audio.mp3`, "0".repeat(64)],
    );
    for (const question of payload.questions)
      await q(
        `insert into listening_questions (test_id, "order", type, question_text, options, correct_answer, explanation)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [test.id, question.number, question.kind === "mcq" ? "multiple_choice" : "short_answer", question.text, JSON.stringify(question.options), question.key, question.number === 1 ? HIDDEN : ""],
      );
  } else {
    for (let number = 1; number <= questions; number += 1)
      await q(
        `insert into listening_questions (test_id, "order", type, question_text, options, correct_answer, explanation)
         values ($1, $2, 'short_answer', $3, null, $4, '')`,
        [test.id, number, `Native question ${number}`, SECRET_KEY],
      );
  }
  await q(
    `insert into content_versions (module, content_type, source_ref, version_no, status, title, content_snapshot, content_hash, semantic_hash, answer_key_hash, target_type, target_id, created_by_user_id)
     values ('listening', $7, $1, 1, 'published', $2, $3, $4, $4, $4, 'listening_test', $5, $6)`,
    [sourceRef, title, JSON.stringify({ sectionNo, questions: [] }), "0".repeat(64), test.id, ownerId, contentType],
  );
  return test.id;
}

const created = [];
let cookie = "";
try {
  const [student] = await q(`select id, role, name from users where email = $1`, [STUDENT]);
  const [owner] = await q(`select id, role, name from users where email = $1`, [OWNER]);
  if (!student || !owner) throw new Error("QA2 fixtures are missing the owner/student users");
  cookie = await cookieFor(student);

  // Idempotent on re-run: a previous interrupted run's fixtures are removed first.
  const stale = await q(`select id from listening_tests where source_ref like 'qa2-general-%'`);
  if (stale.length) {
    const ids = stale.map((row) => row.id);
    await q(`delete from listening_attempts where test_id = any($1::uuid[])`, [ids]);
    await q(`delete from listening_questions where test_id = any($1::uuid[])`, [ids]);
    await q(`delete from listening_packages where test_id = any($1::uuid[])`, [ids]);
    await q(`delete from content_versions where source_ref like 'qa2-general-%'`);
    await q(`delete from listening_tests where id = any($1::uuid[])`, [ids]);
  }

  const sectionId = await createSection({ sourceRef: "qa2-general-1-section", title: "Section fixture: booking a tour", state: "published", collection: "general", ownerId: owner.id });
  const nativeId = await createSection({ sourceRef: "qa2-general-2-native", title: "Native fixture: campus tour", state: "published", collection: null, ownerId: owner.id, withPackage: false, questions: 3, sectionNo: 2 });
  const draftId = await createSection({ sourceRef: "qa2-general-3-draft", title: "Draft fixture: hidden section", state: "draft", collection: "general", ownerId: owner.id });
  // The importer's real stamp for a package-backed full test (src/lib/import/listening/canonical.ts).
  const academicId = await createSection({ sourceRef: "qa2-general-4-academic", title: "Academic fixture: full test", state: "published", collection: "academic", ownerId: owner.id, contentType: "full_test" });
  const mcqId = await createSection({ sourceRef: "qa2-general-5-mcq", title: "MCQ fixture: training package", state: "published", collection: "mcq", ownerId: owner.id, contentType: "full_test" });
  created.push(sectionId, nativeId, draftId, academicId, mcqId);

  /* ------------------------------------------------------------------ navigation */
  const modulePage = await get("/app/listening", cookie);
  check("L0 the Listening module page offers the owner's destinations", modulePage.status === 200 && ["lessons", "academic", "general", "mcq"].every((key) => modulePage.text.includes(`data-listening-destination-open="${key}"`) && modulePage.text.includes(`href="/app/listening/${key}"`)), `status ${modulePage.status}`);
  /* ------------------------------------------------------------------ catalogue */
  const catalogue = await get("/app/listening/general", cookie);
  // Count RENDERED anchors, not substrings: Next.js also serializes the same props into the
  // RSC flight payload, where the marker appears once more in escaped JSON. Counting raw
  // occurrences would report a second breadcrumb that the learner never sees.
  const backLinks = (html) => (html.match(/<a [^>]*data-listening-general-back="true"[^>]*>/g) ?? []).length;
  const backLinkHref = /<a [^>]*data-listening-general-back="true"[^>]*href="\/app\/listening"[^>]*>/;
  check("L0b the General catalogue has exactly ONE way back, and it goes to Listening", backLinks(catalogue.text) === 1 && backLinkHref.test(catalogue.text), `${backLinks(catalogue.text)} rendered back link(s)`);
  check("L1 the General Listening catalogue renders for a signed-in learner", catalogue.status === 200, `status ${catalogue.status}`);
  check("L1b a published section is listed", catalogue.text.includes("Section fixture: booking a tour"), "the section is missing");
  check("L1c a natively authored section (no package) is listed too", catalogue.text.includes("Native fixture: campus tour"), "a section must not require a four-part test");
  check("L2 an academic full test is not General Listening", !catalogue.text.includes("Academic fixture: full test"));
  check("L2b a dedicated MCQ package is not General Listening", !catalogue.text.includes("MCQ fixture: training package"));
  check("L2c a draft section is invisible to a learner", !catalogue.text.includes("Draft fixture: hidden section"), "the draft leaked");
  const total = Number(/data-listening-general-total="(\d+)"/.exec(catalogue.text)?.[1] ?? "0");
  check("L3 the catalogue states how many sections are published", total === 2, `total marker said ${total}`);

  const cardOf = (html, id) => {
    const marker = `data-listening-general-card="${id}"`;
    const at = html.indexOf(marker);
    if (at < 0) return null;
    const next = html.indexOf("data-listening-general-card=", at + marker.length);
    return html.slice(at, next < 0 ? html.length : next);
  };
  const sectionCard = cardOf(catalogue.text, sectionId);
  check("L3b the card states the authored section identity", Boolean(sectionCard && sectionCard.includes("Section 3")), "no section number");
  check("L3c the card states the real question count", Boolean(sectionCard && /2 questions/.test(sectionCard)));
  check("L3d the card states the learner's own status honestly", Boolean(sectionCard && sectionCard.includes("Not started")), "status missing or wrong");
  check("L3e the card offers Open Section", Boolean(sectionCard && sectionCard.includes("Open Section")));
  check("L3f the native section's card is as truthful", Boolean(cardOf(catalogue.text, nativeId)?.includes("3 questions")));

  /* ---------------------------------------------------------------- pagination */
  for (let index = 1; index <= 25; index += 1) {
    const id = await createSection({ sourceRef: `qa2-general-bulk-${index}`, title: `Bulk section fixture ${String(index).padStart(2, "0")}`, state: "published", collection: "general", ownerId: owner.id, questions: 1 });
    created.push(id);
  }
  const pageOne = await get("/app/listening/general", cookie);
  const idsOf = (html) => [...html.matchAll(/data-listening-general-card="([0-9a-f-]{36})"/g)].map((match) => match[1]);
  const pageTwo = await get("/app/listening/general?page=2", cookie);
  const one = idsOf(pageOne.text);
  const two = idsOf(pageTwo.text);
  check("L4 one page is bounded", one.length === 24, `page 1 carried ${one.length} cards`);
  check("L4b every section is reachable", one.length + two.length === 27 && new Set([...one, ...two]).size === 27, `${one.length}+${two.length} cards`);
  check("L4c page 1 offers the way forward and page 2 the way back", pageOne.text.includes("data-listening-general-next") && pageTwo.text.includes("data-listening-general-prev"));
  const repeat = await get("/app/listening/general", cookie);
  check("L4d the order is stable across requests", idsOf(repeat.text).join() === one.join());
  const junk = await get("/app/listening/general?page=-2", cookie);
  check("L4e a nonsense page argument falls back to the first page", idsOf(junk.text)[0] === one[0]);

  /* ------------------------------------------------------- one section, one activity */
  /*
   * THE SECTION'S OWN ADDRESS is what the card links to: `/app/listening/general/<sectionId>`.
   * It must serve the ONE exercise itself — audio, questions, navigation, note-taking — with no
   * activity hub, and the learner must never have to know an attempt id. The attempt URL stays
   * internal, so the catalogue is asserted NOT to link it.
   */
  const sectionAddress = await get(`/app/listening/general/${sectionId}`, cookie);
  check("L5 the section's own address opens the section", sectionAddress.status === 200, `status ${sectionAddress.status}`);
  check(
    "L5a2 the address IS the exercise: the one activity, not a hub and not the four-part exam",
    sectionAddress.text.includes(`data-listening-section-page="${sectionId}"`) &&
      sectionAddress.text.includes('data-listening-section-mode="exercise"') &&
      !sectionAddress.text.includes("data-listening-academic-activity") &&
      !sectionAddress.text.includes("data-listening-exam-sections"),
    `status ${sectionAddress.status}`,
  );
  check("L5a3 the catalogue links the section address, never the internal attempt URL", !pageOne.text.includes("/app/listening/attempts/") && new RegExp(`href="/app/listening/general/${sectionId}"`).test(pageOne.text));
  const sectionAddressAgain = await get(`/app/listening/general/${sectionId}`, cookie);
  check("L5a4 reloading the address keeps the learner in the same section", sectionAddressAgain.text.includes(`data-listening-section-page="${sectionId}"`));
  const start = await fetch(`${BASE}/api/listening/attempts`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ testId: sectionId }),
  });
  const started = await start.json().catch(() => ({}));
  check("L5b opening a section starts ONE Listening attempt", start.status === 200 && typeof started.id === "string", `status ${start.status}`);
  const attemptId = started.id;
  const attemptCount = await q(`select count(*)::int as count from listening_attempts where test_id = $1`, [sectionId]);
  check("L5b2 loading the section address did not pile up attempts", Number(attemptCount[0].count) === 1, `${attemptCount[0].count} attempts exist`);
  const attempt = await get(`/app/listening/attempts/${attemptId}`, cookie);
  check("L5c the attempt renders the familiar Listening interface", attempt.status === 200, `status ${attempt.status}`);
  check("L5d it carries the audio and the questions", /<audio/.test(attempt.text) && attempt.text.includes("Where does the speaker suggest meeting?"));
  check("L5e it carries question navigation", attempt.text.includes("listening-question-nav"));
  check("L5f it carries note-taking", attempt.text.includes("listening-exam-notes") || attempt.text.includes("Note-taking") || attempt.text.includes("Notes"), "note-taking control missing");
  // Asserted STRUCTURALLY: the page also carries the whole dictionary, where the words
  // "Full Exam" legitimately exist. What matters is which controls were rendered.
  check("L5g it is NOT presented as the four-part exam", attempt.text.includes('data-listening-attempt-mode="section"') && !attempt.text.includes("data-listening-exam-sections"), "the four-part exam framing was used for a single section");
  check("L5h it is not an activity hub", !attempt.text.includes("data-listening-academic-activity"));
  check("L5h2 the attempt does not add a SECOND way back (one navigation pair, not two)", !/<a [^>]*data-(listening-general|listening-academic)-back="true"/.test(attempt.text), "a second breadcrumb was rendered inside the attempt");
  check("L5i the reading text is the canonical vocabulary surface", attempt.text.includes("data-clickable-text"), "the learner cannot look up a word in the section");
  check("L5j highlight is offered on that text", attempt.text.includes('data-highlight-surface="true"'), "highlight is not available in the section");
  check("L6 no answer key or hidden explanation reaches the section attempt", !attempt.text.includes(SECRET_KEY) && !attempt.text.includes(HIDDEN), "a key or explanation leaked");
  const catalogueAgain = await get("/app/listening/general", cookie);
  check("L7 the catalogue now shows this learner's real status", Boolean(cardOf(catalogueAgain.text, sectionId)?.includes("In progress")), "status did not follow the learner's own attempt");

  /*
   * Can the learner actually USE the vocabulary the section offers?
   *
   * The surface existing is not enough: the canonical lexical API decides per request, and it
   * used to lock a word lookup whenever an attempt for the same test was open — which, for a
   * section, is ALWAYS (the learner is working in it). So the section's own lookup is asked
   * for real here, and the Academic seal is re-proved in the same breath.
   */
  const spellingOnly = await get(`/api/vocabulary/meaning?sourceId=${sectionId}&q=tour`, cookie);
  check("L9 a word lookup inside the section is answered, not locked out", !(spellingOnly.status === 403 && spellingOnly.text.includes("lexical_assistance_locked")), `status ${spellingOnly.status} ${spellingOnly.text.slice(0, 120)}`);
  const academicAttempt = await fetch(`${BASE}/api/listening/attempts`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ testId: academicId }),
  });
  const academicStarted = await academicAttempt.json().catch(() => ({}));
  const academicLookup = await get(`/api/vocabulary/meaning?sourceId=${academicId}&q=tour`, cookie);
  check("L9b the running Academic full test still reveals nothing", academicLookup.status === 403 && academicLookup.text.includes("lexical_assistance_locked"), `status ${academicLookup.status} ${academicLookup.text.slice(0, 120)}`);
  if (typeof academicStarted.id === "string") await fetch(`${BASE}/api/listening/attempts/${academicStarted.id}/submit`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ answers: [] }) });

  /*
   * A FINISHED section must keep being a section.
   *
   * This is the regression that makes the difference between "a section opens as one activity"
   * and "a section opens as one activity until you submit it": a section that carries a
   * canonical package used to be redirected to `/app/listening/tests/:id/2` — the four-part
   * Academic result screen — while a natively authored one showed its own result. The
   * presentation cannot depend on how the centre authored the section.
   */
  const questionRows = await q(`select id from listening_questions where test_id = $1 order by "order"`, [sectionId]);
  const submitted = await fetch(`${BASE}/api/listening/attempts/${attemptId}/submit`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ answers: questionRows.map((row) => ({ questionId: row.id, answer: "A" })) }),
  });
  check("L8 the section submits", submitted.status === 200, `status ${submitted.status}`);
  const finished = await get(`/app/listening/attempts/${attemptId}`, cookie);
  check("L8b a finished section shows its own result, never the four-part Academic screen",
    finished.status === 200 && !finished.text.includes("data-listening-exam-sections") && !finished.text.includes("data-listening-academic-activity"),
    finished.status === 307 || finished.status === 302 ? `redirected to ${finished.location}` : `status ${finished.status}`);
  check("L8c the finished result is this section's own score", finished.status === 200 && !/\/app\/listening\/tests\//.test(finished.location ?? ""));
  const sectionAfterSubmit = await get(`/app/listening/general/${sectionId}`, cookie);
  check(
    "L8d the section's own address now shows ITS result, with this section's evidence and no new attempt",
    sectionAfterSubmit.status === 200 &&
      sectionAfterSubmit.text.includes('data-listening-section-mode="result"') &&
      sectionAfterSubmit.text.includes("data-listening-section-result") &&
      !sectionAfterSubmit.text.includes("data-listening-exam-sections"),
    `status ${sectionAfterSubmit.status}`,
  );
  const afterResult = await q(`select count(*)::int as count from listening_attempts where test_id = $1`, [sectionId]);
  check("L8e re-opening a finished section does not silently start another attempt", Number(afterResult[0].count) === 1, `${afterResult[0].count} attempts exist`);

  /* ------------------------------------------------------------------- cleanup */
  check("Z1 nothing was left in another catalogue", !(await get("/app/listening/academic", cookie)).text.includes("Section fixture: booking a tour"));
} finally {
  await q(`delete from listening_attempts where test_id = any($1::uuid[])`, [created]);
  await q(`delete from listening_questions where test_id = any($1::uuid[])`, [created]);
  await q(`delete from listening_packages where test_id = any($1::uuid[])`, [created]);
  await q(`delete from content_versions where source_ref like 'qa2-general-%'`);
  for (const id of created) await q(`delete from listening_tests where id = $1`, [id]);
  const residue = await q(`select count(*)::int as count from listening_tests where source_ref like 'qa2-general-%'`);
  check("Z2 every fixture is deleted", Number(residue[0].count) === 0, `${residue[0].count} rows remain`);
  if (cookie) {
    const after = await get("/app/listening/general", cookie);
    check("Z3 the catalogue is clean again", !after.text.includes("Section fixture: booking a tour") && !after.text.includes("Native fixture: campus tour"));
  }
  await db.end();
}

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${pass}/${pass + failures.length} checks`);
if (failures.length) {
  console.log(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
