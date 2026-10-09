#!/usr/bin/env node
/**
 * GENERAL LISTENING — ROLE BOUNDARIES and the end-to-end HUMAN JOURNEY.
 *
 *   AUTH_SECRET=<the server's own secret> BASE_URL=http://127.0.0.1:3100 \
 *   DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
 *   node scripts/verify-listening-general-human.mjs
 *
 * Run against a BUILT server (`npx next start`) and real PostgreSQL (QA2).
 *
 * PART 1 — role boundaries. The same fixtures are requested as ANONYMOUS, STUDENT,
 * TEACHER, ADMIN and OWNER, and what each role may see and do is checked explicitly,
 * including what must NOT happen. The teacher/admin identities are created for this run
 * only (reserved `.invalid` addresses) and deleted with the rest of the fixtures.
 *
 * PART 2 — the owner's human journey, step by step, over real HTTP: sign in, walk from
 * Listening to General Listening, read a card, open the section, answer, take a note,
 * highlight, look a word up, submit, read the section's own result, see the catalogue
 * follow, and confirm Academic Listening is untouched. Then the fixtures are deleted and
 * the cleanup is proven.
 *
 * What this script CANNOT prove, and therefore does not claim: pointer gestures (drawing a
 * text selection, dragging the audio scrubber) and visual paint. Those are exercised in
 * tests/ui/listening-section-highlight.test.tsx (jsdom, i.e. a DOM but not a browser) and
 * remain EXTERNALLY UNVERIFIED here.
 */
import pg from "pg";
import { SignJWT } from "jose";
import { assertIsolatedTarget } from "./qa2-seed-fixtures.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2";
const SECRET = process.env.AUTH_SECRET ?? "";
if (SECRET.length < 16) throw new Error("AUTH_SECRET must be set to the server's own secret");
assertIsolatedTarget(DATABASE_URL);

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "not ok"} - ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (ok) pass += 1;
  else failures.push(name);
};
const step = (n, text) => console.log(`\n— step ${n}: ${text}`);

// This probe writes fixtures. Refuse any database that is not disposable QA.

const { assertMutableDatabase: __assertMutableDb } = await import("./lib/fixture-safety.mjs");

__assertMutableDb(DATABASE_URL);

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;

const PREFIX = "qa2-grole-";
const SECRET_KEY = "QASECRETKEY-GROLE";
const HIDDEN = "HIDDEN-EXPLANATION-GROLE";

async function cookieFor(user) {
  const token = await new SignJWT({ sub: user.id, role: user.role, name: user.name, locale: "en", onboarded: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  return `la_session=${token}; la_locale=en`;
}
const get = async (path, cookie) => {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
};
const send = async (method, path, body, cookie) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const cardOf = (html, id) => {
  const start = html.indexOf(`data-listening-general-card="${id}"`);
  return start === -1 ? null : html.slice(start, start + 1200);
};

/** One section, written the way the product writes them: a revision plus canonical rows. */
async function createSection({ key, title, state = "published", ownerId, packageCollection = null, questions, audio = true, sectionNo = 4 }) {
  const [test] = await q(
    `insert into listening_tests (title, audio_type, audio_url, source_ref, publication_state, created_by_user_id)
     values ($1, 'audio', $2, $3, $4::publication_state, $5) returning id`,
    [title, audio ? `qa2/${key}.mp3` : null, `${PREFIX}${key}`, state, ownerId],
  );
  await q(
    `insert into listening_questions (test_id, "order", type, question_text, options, correct_answer, explanation)
     select $1, (q->>'order')::int,
            (case when q->>'kind' = 'mcq' then 'multiple_choice' else 'short_answer' end)::listening_question_type,
            q->>'text', q->'options', answers.value, $4
       from jsonb_array_elements($2::jsonb) as q
       join jsonb_array_elements_text($3::jsonb) with ordinality as answers(value, ord) on answers.ord = (q->>'order')::int`,
    [test.id, JSON.stringify(questions.map((question, index) => ({ ...question, order: index + 1 }))), JSON.stringify(questions.map((question) => question.answer ?? SECRET_KEY)), HIDDEN],
  );
  await q(
    `insert into content_versions (module, content_type, source_ref, version_no, status, title, content_snapshot, content_hash, semantic_hash, answer_key_hash, target_type, target_id, created_by_user_id)
     values ('listening', 'section', $1, 1, 'published', $2, $3, $4, $4, $4, 'listening_test', $5, $6)`,
    [`${PREFIX}${key}`, title, JSON.stringify({ sectionNo }), "0".repeat(64), test.id, ownerId],
  );
  if (packageCollection) {
    const payload = {
      schemaVersion: 1,
      collection: packageCollection,
      testId: `${PREFIX}${key}`,
      title,
      category: "full",
      provenance: "QA fixture, role-boundary acceptance",
      audio: { path: "audio.mp3", durationSec: 600 },
      imagePath: null,
      sections: [{ number: sectionNo, title: `Section ${sectionNo}`, transcript: "", reviewRequired: false }],
      questions: questions.map((question, index) => ({
        number: index + 1, section: sectionNo, text: question.text, instruction: "Choose the correct answer",
        kind: question.kind, options: question.options ?? [], key: question.answer ?? SECRET_KEY, alternatives: [], pair: [],
        evidence: { at: 5, why: "authored" },
      })),
      keyword1: [], keyword2: [], vocabulary: [],
    };
    await q(
      `insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash, legacy_runtime)
       values ($1, $2, $3, $4, $5, false)`,
      [test.id, `${PREFIX}${key}`, JSON.stringify(payload), `qa2/${key}.mp3`, "0".repeat(64)],
    );
  }
  return test.id;
}

async function cleanup() {
  const ids = (await q(`select id from listening_tests where source_ref like $1`, [`${PREFIX}%`])).map((row) => row.id);
  if (ids.length) {
    await q(`delete from activity_events where payload->>'attemptId' in (select id::text from listening_attempts where test_id = any($1::uuid[]))`, [ids]);
    await q(`delete from listening_answers where attempt_id in (select id from listening_attempts where test_id = any($1::uuid[]))`, [ids]);
    await q(`delete from listening_drafts where attempt_id in (select id from listening_attempts where test_id = any($1::uuid[]))`, [ids]);
    await q(`delete from listening_attempts where test_id = any($1::uuid[])`, [ids]);
    await q(`delete from listening_questions where test_id = any($1::uuid[])`, [ids]);
    await q(`delete from listening_packages where test_id = any($1::uuid[])`, [ids]);
    await q(`delete from content_versions where source_ref like $1`, [`${PREFIX}%`]);
    await q(`delete from listening_tests where id = any($1::uuid[])`, [ids]);
  }
  await q(`delete from users where email like $1`, [`${PREFIX}%@learners-qa.invalid`]);
}

let studentCookie = "";
try {
  const [student] = await q(`select id, name, role from users where email = $1`, ["qa2-student@learners-qa.invalid"]);
  const [owner] = await q(`select id, name, role, is_owner from users where email = $1`, ["qa2-owner@learners-qa.invalid"]);
  if (!student || !owner) throw new Error("QA2 is missing the owner/student fixtures (npm run -s qa:pg)");
  await cleanup();
  const [teacher] = await q(
    `insert into users (name, email, role, account_status) values ('QA2 teacher', $1, 'teacher', 'active')
     on conflict (email) do update set role = 'teacher', account_status = 'active' returning id, name, role`,
    [`${PREFIX}teacher@learners-qa.invalid`],
  );
  const [admin] = await q(
    `insert into users (name, email, role, account_status) values ('QA2 admin', $1, 'admin', 'active')
     on conflict (email) do update set role = 'admin', account_status = 'active' returning id, name, role`,
    [`${PREFIX}admin@learners-qa.invalid`],
  );
  studentCookie = await cookieFor(student);
  const teacherCookie = await cookieFor(teacher);
  const adminCookie = await cookieFor(admin);
  const ownerCookie = await cookieFor(owner);

  /* -------------------------------------------------------------------- fixtures */
  const g1 = await createSection({
    key: "g1", title: "G1 section: MCQ + completion + audio", ownerId: owner.id, packageCollection: "general",
    questions: [
      { kind: "mcq", text: "Which platform does the train leave from?", options: ["A) one", "B) two", "C) three"], answer: "B" },
      { kind: "completion", text: "Write ONE WORD: the tour lasts ____ minutes.", options: null, answer: "forty" },
    ],
  });
  const g2 = await createSection({
    key: "g2", title: "G2 section: matching", ownerId: owner.id, packageCollection: "general",
    questions: [{ kind: "matching", text: "Match the speaker to the room: A) hall B) studio", options: ["A) hall", "B) studio"], answer: "A" }],
  });
  const g1n = await createSection({
    key: "g1n", title: "G1n section: authored natively, no package", ownerId: owner.id, audio: false,
    questions: [{ kind: "mcq", text: "Which answer is right for the native section?", options: ["A) first", "B) second"], answer: "A" }],
  });
  const a1 = await createSection({
    key: "a1", title: "A1 academic full test", ownerId: owner.id, packageCollection: "academic",
    questions: [{ kind: "mcq", text: "Academic question one?", options: ["A) y", "B) n"], answer: "A" }],
  });
  const d1 = await createSection({
    key: "d1", title: "D1 section: still a draft", ownerId: owner.id, state: "draft",
    questions: [{ kind: "mcq", text: "Draft question?", options: ["A) y", "B) n"], answer: "A" }],
  });

  console.log("=== PART 1 — role boundaries (G1, G2, G1n, A1) ===");

  /* ------------------------------------------------------------------ anonymous */
  step(1, "anonymous — sent to sign in, and the API refuses without leaking");
  const anon = await get("/app/listening/general", "");
  check("anon1 the catalogue is not served to a signed-out visitor", anon.status === 307 || anon.status === 302 || Boolean(anon.location?.includes("login")), `status ${anon.status}`);
  check("anon2 nothing about any section leaked", !anon.text.includes("G1 section") && !anon.text.includes(SECRET_KEY));
  const anonStart = await send("POST", "/api/listening/attempts", { testId: g1 }, "");
  check("anon3 starting an attempt is refused (401)", anonStart.status === 401, `status ${anonStart.status}`);
  check("anon4 the refusal carries no attempt id", anonStart.body?.id === undefined);
  const anonDraft = await send("PUT", `/api/listening/attempts/00000000-0000-0000-0000-000000000001/draft`, { answers: {}, audioPosition: 0 }, "");
  check("anon5 writing a draft is refused (401)", anonDraft.status === 401, `status ${anonDraft.status}`);

  /* -------------------------------------------------------------------- student */
  step(2, "student — the published sections, one activity, and no way into a draft");
  const studentCatalogue = await get("/app/listening/general", studentCookie);
  check("student1 the catalogue renders", studentCatalogue.status === 200, `status ${studentCatalogue.status}`);
  check("student2 every published section is listed, packaged or natively authored", ["G1 section", "G2 section", "G1n section"].every((title) => studentCatalogue.text.includes(title)));
  check("student3 the academic full test is not General Listening", !studentCatalogue.text.includes("A1 academic full test"));
  check("student4 a draft section is invisible", !studentCatalogue.text.includes("D1 section"));
  check("student5 no answer key or explanation reaches the catalogue", !studentCatalogue.text.includes(SECRET_KEY) && !studentCatalogue.text.includes(HIDDEN));
  const studentStart = await send("POST", "/api/listening/attempts", { testId: g1 }, studentCookie);
  check("student6 opening the section starts ONE attempt", studentStart.status === 200 && typeof studentStart.body?.id === "string", `status ${studentStart.status}`);
  const attemptId = studentStart.body?.id;
  const studentAttempt = await get(`/app/listening/attempts/${attemptId}`, studentCookie);
  check("student7 the section is ONE activity, not the four-part exam", studentAttempt.text.includes('data-listening-attempt-mode="section"') && !studentAttempt.text.includes("data-listening-exam-sections"), "four-part framing used for a single section");
  check("student8 it offers note-taking", studentAttempt.text.includes("listening-exam-notes"));
  check("student9 no key or explanation reaches the attempt", !studentAttempt.text.includes(SECRET_KEY) && !studentAttempt.text.includes(HIDDEN), "a key leaked to the learner");
  const studentDraftStart = await send("POST", "/api/listening/attempts", { testId: d1 }, studentCookie);
  check("student10 a draft section cannot be started (404)", studentDraftStart.status === 404, `status ${studentDraftStart.status}`);
  const someoneElse = await get(`/app/listening/attempts/${attemptId}`, ownerCookie);
  check("student11 another account cannot open this learner's attempt", someoneElse.status === 404 || someoneElse.status === 403, `status ${someoneElse.status}`);

  /* -------------------------------------------------------------------- teacher */
  step(3, "teacher — the learner surface, and their own capability boundary");
  const teacherCatalogue = await get("/app/listening/general", teacherCookie);
  check("teacher1 the catalogue renders for staff as well", teacherCatalogue.status === 200, `status ${teacherCatalogue.status}`);
  check("teacher2 an unpublished draft is invisible to a teacher too", !teacherCatalogue.text.includes("D1 section"));
  const teacherDraft = await send("POST", "/api/admin/content/drafts", {
    module: "listening", contentType: "section", sourceRef: `${PREFIX}teacher-section`, title: "Teacher authored section",
    payload: { audioType: "audio", questions: [{ type: "multiple_choice", questionText: "Pick one answer here", options: ["A", "B"], correctAnswer: "A", explanation: "because" }] },
  }, teacherCookie);
  check("teacher3 a teacher cannot author a Listening section", teacherDraft.status === 403, `status ${teacherDraft.status}`);
  const teacherPublish = await send("POST", `/api/admin/content/versions/00000000-0000-0000-0000-000000000002/publication`, { to: "published" }, teacherCookie);
  check("teacher4 a teacher cannot publish anything", teacherPublish.status === 403 || teacherPublish.status === 404, `status ${teacherPublish.status}`);

  /* ---------------------------------------------------------------- admin/owner */
  step(4, "admin/owner — authoring a section through the one Content OS, and the full-test gate");
  const ownerDraft = await send("POST", "/api/admin/content/drafts", {
    module: "listening", contentType: "section", sourceRef: `${PREFIX}owner-section`, title: "Owner authored section",
    payload: { sectionNo: 2, audioType: "audio", questions: [{ type: "multiple_choice", questionText: "Which answer is right?", options: ["A", "B"], correctAnswer: "A", explanation: "because" }] },
  }, ownerCookie);
  check("owner1 the owner may author a Listening section", ownerDraft.status === 201 && typeof ownerDraft.body?.versionId === "string", `status ${ownerDraft.status} ${JSON.stringify(ownerDraft.body).slice(0, 140)}`);
  const authoredSectionId = ownerDraft.body?.targetId;
  const publish = await send("POST", `/api/admin/content/versions/${ownerDraft.body?.versionId}/publication`, { to: "published" }, ownerCookie);
  check("owner2 the authored section publishes", publish.status === 200 && publish.body?.publicationState === "published", `status ${publish.status} ${JSON.stringify(publish.body)}`);
  const catalogueAfterAuthoring = await get("/app/listening/general", studentCookie);
  check("owner3 the newly published section reaches the learner catalogue", catalogueAfterAuthoring.text.includes("Owner authored section"));
  const academicAfterAuthoring = await get("/app/listening/academic", studentCookie);
  check("owner4 it is not filed as an academic test", !academicAfterAuthoring.text.includes("Owner authored section"));
  const authoredStart = await send("POST", "/api/listening/attempts", { testId: authoredSectionId }, studentCookie);
  check("owner5 a learner can open it as ONE activity", authoredStart.status === 200 && typeof authoredStart.body?.id === "string", `status ${authoredStart.status}`);
  const authoredAttemptId = authoredStart.body?.id;
  const authoredQuestions = await q(`select id from listening_questions where test_id = $1 order by "order"`, [authoredSectionId]);
  const authoredSave = await send("PUT", `/api/listening/attempts/${authoredAttemptId}/draft`, { answers: { [authoredQuestions[0].id]: "A" }, audioPosition: 3, startAudio: true }, studentCookie);
  check("owner6 a natively authored section persists the learner's answer in progress", authoredSave.status === 200, `status ${authoredSave.status} ${JSON.stringify(authoredSave.body)}`);
  const authoredStored = await q(`select answers from listening_drafts where attempt_id = $1`, [authoredAttemptId]);
  check("owner7 the answer is stored on the server, not only in the learner's browser", authoredStored[0]?.answers?.[authoredQuestions[0].id] === "A", JSON.stringify(authoredStored[0]?.answers ?? null));
  const authoredReload = await get(`/app/listening/attempts/${authoredAttemptId}`, studentCookie);
  check("owner7b the page comes back with the saved choice marked", /selected/.test(authoredReload.text), "the saved answer did not come back");
  check("owner8 the authored section renders as a section", authoredReload.text.includes('data-listening-attempt-mode="section"'));

  const adminDrill = await send("POST", "/api/admin/content/drafts", {
    module: "listening", contentType: "full_test", sourceRef: `${PREFIX}admin-drill`, title: "Admin five-question drill",
    payload: { audioType: "audio", questions: [{ type: "multiple_choice", questionText: "Only one question?", options: ["A", "B"], correctAnswer: "A", explanation: "because" }] },
  }, adminCookie);
  check("admin1 an administrator may author a draft", adminDrill.status === 201 && typeof adminDrill.body?.versionId === "string", `status ${adminDrill.status} ${JSON.stringify(adminDrill.body).slice(0, 140)}`);
  const drillPublish = await send("POST", `/api/admin/content/versions/${adminDrill.body?.versionId}/publication`, { to: "published" }, adminCookie);
  const drillIssues = JSON.stringify(drillPublish.body ?? {});
  check("admin2 a one-question item cannot be published as a formal full test", drillPublish.status === 422 && drillIssues.includes("incomplete_full_test"), `status ${drillPublish.status} ${drillIssues.slice(0, 160)}`);
  check("admin3 the refusal tells the author what a full test is, and what to do instead", /40 questions/.test(drillIssues) && /Publish it as a Listening section instead/.test(drillIssues), drillIssues.slice(0, 220));
  const drillState = await q(`select publication_state from listening_tests where source_ref = $1`, [`${PREFIX}admin-drill`]);
  check("admin4 the refusal changed nothing (the row is still a draft)", drillState[0]?.publication_state === "draft", `state ${drillState[0]?.publication_state}`);
  check("admin5 the refused drill is not in any catalogue", !(await get("/app/listening/academic", studentCookie)).text.includes("Admin five-question drill"));

  console.log("\n=== PART 2 — the human journey, on the built server ===");

  step(5, "walk from Listening to General Listening");
  const listening = await get("/app/listening", studentCookie);
  check("J1 the Listening module page offers both catalogues", listening.status === 200 && ["general", "academic"].every((key) => listening.text.includes(`data-listening-destination-open="${key}"`) && listening.text.includes(`href="/app/listening/${key}"`)), `status ${listening.status}`);

  step(6, "read the catalogue card");
  const catalogue = await get("/app/listening/general", studentCookie);
  const card = cardOf(catalogue.text, g1);
  check("J2 the card states the section identity", Boolean(card?.includes("Section 4")), "the authored section number is not on the card");
  check("J3 the card states the real question count", Boolean(card && /2 questions/.test(card)), "the question count is not on the card");
  const untouchedCard = cardOf(catalogue.text, g2);
  check("J4 a section nobody has opened is honestly 'Not started'", Boolean(untouchedCard?.includes("Not started")), "the card guesses a status");

  step(7, "open the section — one Listening activity");
  const activity = await get(`/app/listening/attempts/${attemptId}`, studentCookie);
  check("J5 the activity carries the recording and its questions", activity.text.includes("<audio") && activity.text.includes("Which platform does the train leave from?"));

  step(8, "answer the multiple-choice and the completion question");
  const questionRows = await q(`select id from listening_questions where test_id = $1 order by "order"`, [g1]);
  const save = await send("PUT", `/api/listening/attempts/${attemptId}/draft`, { answers: { [questionRows[0].id]: "B", [questionRows[1].id]: "forty" }, audioPosition: 12, startAudio: true }, studentCookie);
  check("J6 the answers persist in progress", save.status === 200, `status ${save.status}`);
  const stored = await q(`select answers, audio_position from listening_drafts where attempt_id = $1`, [attemptId]);
  check("J7 the answers and the position are stored on the server", stored[0]?.answers?.[questionRows[0].id] === "B" && stored[0]?.answers?.[questionRows[1].id] === "forty" && Number(stored[0]?.audio_position) === 12, JSON.stringify(stored[0] ?? null));
  const reload = await get(`/app/listening/attempts/${attemptId}`, studentCookie);
  check("J7b the completed-answer field comes back with the learner's text", /value="forty"/.test(reload.text), "the learner would type their answers twice");

  step(9, "take a note");
  check("J8 note-taking is the Listening attempt's own control", reload.text.includes("listening-exam-notes"));
  check("J9 the lesson's Xulosangiz panel is not used for a Listening section", !reload.text.includes("data-lesson-notes"), "the lesson notes panel was rendered in a Listening attempt");

  step(10, "highlight the visible text");
  check("J10 the reading text offers highlight to the learner", reload.text.includes('data-highlight-surface="true"'));
  console.log("     NOT CHECKED HERE: drawing the selection with a pointer and the popover's paint are browser-only; the DOM test covers the range logic and is not browser evidence. EXTERNALLY UNVERIFIED.");

  step(11, "look a word up");
  check("J12 the text is the canonical vocabulary surface", reload.text.includes("data-clickable-text"), "the dictionary is not reachable from the section");

  step(12, "submit");
  const submit = await send("POST", `/api/listening/attempts/${attemptId}/submit`, { answers: questionRows.map((row, index) => ({ questionId: row.id, answer: index === 0 ? "B" : "forty" })) }, studentCookie);
  check("J13 the section submits", submit.status === 200, `status ${submit.status}`);
  check("J14 the score is real, not invented", submit.body?.score === 2 && submit.body?.totalQuestions === 2, JSON.stringify(submit.body));

  step(13, "read the result");
  const result = await get(`/app/listening/attempts/${attemptId}`, studentCookie);
  check("J15 the learner reads their own section result", result.status === 200 && !result.text.includes("data-listening-exam-sections"), `status ${result.status}`);
  check("J16 the result is the section's own page, not an academic hub", !result.text.includes("data-listening-academic-activity") && !result.text.includes("data-listening-exam-sections"), "the finished section was presented as the four-part exam");

  step(14, "the catalogue follows the learner");
  const after = await get("/app/listening/general", studentCookie);
  const afterCard = cardOf(after.text, g1);
  check("J17 the card now states this learner's own result", Boolean(afterCard && /Last result/.test(afterCard)), "the card did not follow the attempt");
  const otherLearner = await get("/app/listening/general", ownerCookie);
  check("J18 another account sees its own truth, not this learner's", !/Last result: 2\/2/.test(cardOf(otherLearner.text, g1) ?? ""));

  step(15, "Academic Listening is untouched");
  const academic = await get("/app/listening/academic", studentCookie);
  check("J19 the academic catalogue still offers its own test", academic.status === 200 && academic.text.includes("A1 academic full test"));
  check("J20 a section is not offered as an academic hub", !academic.text.includes("G1 section"));

  step(16, "delete the fixtures and prove the cleanup");
  console.log("     (the cleanup runs after this step and asserts zero residue)");
} finally {
  await cleanup();
  const residue = await q(`select count(*)::int as count from listening_tests where source_ref like $1`, [`${PREFIX}%`]);
  check("Z1 every fixture row is deleted", Number(residue[0].count) === 0, `${residue[0].count} rows remain`);
  const residueRevisions = await q(`select count(*)::int as count from content_versions where source_ref like $1`, [`${PREFIX}%`]);
  check("Z2 every fixture revision is deleted", Number(residueRevisions[0].count) === 0, `${residueRevisions[0].count} revisions remain`);
  const residueUsers = await q(`select count(*)::int as count from users where email like $1`, [`${PREFIX}%@learners-qa.invalid`]);
  check("Z3 the scenario's own identities are deleted", Number(residueUsers[0].count) === 0, `${residueUsers[0].count} accounts remain`);
  if (studentCookie) {
    const clean = await get("/app/listening/general", studentCookie);
    check("Z4 the catalogue is clean again", !clean.text.includes("G1 section") && !clean.text.includes("Owner authored section"));
    const academicClean = await get("/app/listening/academic", studentCookie);
    check("Z5 the academic catalogue is clean again", !academicClean.text.includes("A1 academic full test"));
  }
  await db.end();
}

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${pass}/${pass + failures.length} checks`);
if (failures.length) {
  console.log(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
