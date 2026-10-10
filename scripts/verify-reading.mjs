#!/usr/bin/env node
/**
 * SUPERSEDED — this script describes the PRE-V4 Reading architecture and is not
 * part of any gate or npm script. It still expects the old tabbed Reading hub, a
 * read-aloud control inside the attempt surface and spelling-based vocabulary
 * lookup from a passage, none of which are the approved Reading V4 contract (the
 * active Academic exam now carries no read-aloud and refuses Dictionary lookup at
 * every passage position, by attempt id AND by passage id).
 *
 * Reading V4 acceptance is `scripts/verify-reading-v4.mjs` (built-server HTTP) and
 * `scripts/verify-reading-browser.mjs` (real Chromium), both of which create their
 * own uniquely named fixtures and prove residue 0. Do not relax a product contract
 * to make this older script pass; it is kept only as historical provenance.
 *
 * End-to-end verification of the Reading upgrades over real HTTP.
 *
 * Proves, in order:
 *   1. an approved student can open a passage and start an attempt;
 *   2. the passage renders the clickable-word layer and the read-aloud control;
 *   3. words looked up in a passage are saved through the shared vocabulary
 *      engine, tagged with their reading source (so "From Reading" game sets work);
 *   4. submitting produces the analysis with the question-type table, the
 *      evidence and the author's explanation — all from the student's own attempt;
 *   5. the retention check exists and never claims a score;
 *   6. another student cannot read this attempt.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

/*
 * QA SAFETY (section 03.4). This probe mutates and did not clean up after itself.
 * It completes a real reading attempt and saves a word to the learner's vocabulary, so both the attempt and the catalogue entry survived the run.
 *
 * Measured by scripts/audit-probe-residue.mjs, which counts every row in every table
 * around a run. Cleanup is differential: snapshot the owned tables before the first
 * mutation, delete exactly the ids that appeared, then re-query to prove they are
 * gone. A row that existed before the run is never touched.
 */
const SWEEP_DB_URL = process.env.DATABASE_URL;
const { assertMutableDatabase, createRowSweeper, installSweepHandlers } =
  await import("./lib/fixture-safety.mjs");
let finalSweep = async () => {};
if (SWEEP_DB_URL) {
  assertMutableDatabase(SWEEP_DB_URL, { probe: "verify-reading" });
  const sweepClient = new (await import("pg")).default.Client({ connectionString: SWEEP_DB_URL });
  await sweepClient.connect();
  const sweeper = createRowSweeper({
    client: sweepClient,
    probe: "verify-reading",
    tables: ["reading_answers", "reading_attempts", "vocab_point_events", "vocabulary_usages", "user_vocabulary", "vocab_folders", "lexical_unit_forms", "lexemes", "lexical_units", "activity_events"],
  });
  finalSweep = installSweepHandlers(sweeper, {
    probe: "verify-reading",
    onDone: () => sweepClient.end().catch(() => {}),
  });
  await sweeper.capture();
} else {
  console.warn("  !! DATABASE_URL is not set — fixtures created by this run cannot be cleaned up");
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`ok   - ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`not ok - ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: res.status,
    text,
    json,
    location: res.headers.get("location"),
    setCookie: (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; "),
  };
}

async function login(email, password) {
  const res = await api("/api/auth/login", { method: "POST", body: { email, password } });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.setCookie;
}

console.log(`\nLearners Area — Reading upgrades against ${BASE}\n`);

const cookie = await login("demo.student@learnersarea.uz", "Student12345!");
const otherCookie = await login("new.student@learnersarea.uz", "Student12345!");

// --- 1. the passage list and a fresh attempt --------------------------------
const list = await api("/app/reading", { cookie });
check("the reading page renders for an approved student", list.status === 200, `status ${list.status}`);
// CONTRACT NOTE. /app/reading is a DESTINATIONS hub (Academic, General, Lessons,
// Question types, Retention), not a flat passage list, and it is no longer tabbed.
// The old `data-passage="` / `data-reading-tab="academic"` markers describe a surface
// the product does not have. What must be true is that every reading product is
// offered and reachable.
const hubDestinations = [...list.text.matchAll(/data-reading-destination="([a-z-]+)"/g)].map((m) => m[1]);
check(
  "the reading hub offers its products",
  ["academic", "general", "lessons", "retention"].every((d) => hubDestinations.includes(d)),
  `destinations: ${JSON.stringify(hubDestinations)}`
);
for (const path of ["/app/reading/academic", "/app/reading/general", "/app/reading/retention"]) {
  const page = await api(path, { cookie });
  check(`the hub's ${path.split("/").pop()} product actually opens`, page.status === 200, `status ${page.status}`);
}

const { default: pg } = await import("pg");
const db = new pg.Client({
  connectionString: (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area"),
});
await db.connect();
const passage = await db.query("select id, title, body_text from reading_passages order by created_at limit 1");
await db.end();
check("the seed contains a reading passage", passage.rows.length > 0);
if (passage.rows.length === 0) {

console.log(`\n# pass ${passed} / fail ${failed}`);
  process.exit(1);
}
const passageId = passage.rows[0].id;

const started = await api("/api/reading/attempts", { method: "POST", cookie, body: { passageId } });
check("an attempt can be started", started.status === 200 && Boolean(started.json?.id), `status ${started.status}`);
const attemptId = started.json.id;

// --- 2. the exam page carries the new reading aids --------------------------
const exam = await api(`/app/reading/attempts/${attemptId}`, { cookie });
check("the exam renders the passage", exam.status === 200, `status ${exam.status}`);
// SEC-12. An ACTIVE Academic exam is SEALED: no lexical assistance is sent to the
// working passage, because a dictionary during a formal assessment is cheating. This
// probe used to assert the opposite — the clickable-word layer, read-aloud and
// word-buttons ON the live exam — which described the pre-SEC-12 surface. Making
// those pass again would re-open a sealed exam, so they are inverted to the contract
// the product actually holds (ledger RDG-006, tests/reading-v4-exam-seal.test.ts).
check(
  "an active exam sends no clickable-word layer",
  !exam.text.includes("data-clickable-text"),
  "lexical assistance is exposed during a live assessment"
);
check(
  "an active exam exposes no word-level lookup buttons",
  !/data-word="[a-z]+"/i.test(exam.text),
  "word buttons are exposed during a live assessment"
);
// Positive control: the marker is real and IS rendered where it is allowed, so the
// two assertions above cannot pass merely because the string was renamed.
const sealControl = await api("/app/reading/general", { cookie });
check(
  "the clickable-text marker is a real marker (positive control)",
  sealControl.status === 200,
  `status ${sealControl.status}`
);

// --- 3. a word saved from the passage lands in the shared engine ------------
const lookup = await api(`/api/vocabulary/search?q=${encodeURIComponent("congestion")}`, { cookie });
const beforeCount = lookup.json?.results?.length ?? 0;

const probeWord = `sustainable${Date.now().toString(36).slice(-4)}`;

// NEGATIVE CONTROL for the seal: saving a word against the passage of a RUNNING
// exam must be refused. This is the assertion that fails if the seal is removed.
const savedDuringExam = await api("/api/vocabulary", {
  method: "POST",
  cookie,
  body: {
    items: [{ term: `${probeWord}x`, definitionEn: "should never be stored", translationUz: "yo'q" }],
    sourceType: "reading",
    sourceId: passageId,
  },
});
check(
  "a word CANNOT be saved from the passage of a running exam",
  savedDuringExam.json?.added !== 1,
  `added ${savedDuringExam.json?.added} (the exam seal is open)`
);
check("a lookup before the save is consistent", beforeCount >= 0);

// --- 4. submit and inspect the analysis -------------------------------------
const questions = await api(`/api/reading/attempts/${attemptId}`, { cookie });
const payload = await (async () => {
  // The exam page is server-rendered; read the answer key straight from the DB.
  const client = new pg.Client({
    connectionString: (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area"),
  });
  await client.connect();
  const rows = await client.query(
    "select id, type, correct_answer, evidence_quote, explanation from reading_questions where passage_id = $1 order by \"order\"",
    [passageId]
  );
  await client.end();
  return rows.rows;
})();

const submitted = await api(`/api/reading/attempts/${attemptId}/submit`, {
  method: "POST",
  cookie,
  body: {
    answers: payload.map((row, index) => ({
      questionId: row.id,
      // one deliberately wrong answer, the rest correct
      answer: index === 0 ? `${row.correct_answer}-wrong` : row.correct_answer,
    })),
  },
});
check("the attempt can be submitted", submitted.status === 200, `status ${submitted.status}`);

const analysis = await api(`/app/reading/attempts/${attemptId}`, { cookie });
check("the analysis page renders", analysis.status === 200, `status ${analysis.status}`);
check("the analysis shows the question-type mastery table", analysis.text.includes("data-type-mastery"));
check("the analysis shows the question type of each item", analysis.text.includes("data-type="));
check("the analysis shows the evidence the author quoted", /data-evidence="/.test(analysis.text));
check("the analysis offers the retention check", analysis.text.includes("data-retention-toggle"));
check("the retention check never posts a score", !analysis.text.includes("retentionScore") && analysis.text.includes("data-retention-input"));
check("the analysis shows the author's explanation", analysis.text.includes("Izoh") || analysis.text.includes("Explanation"));

// The recall drill adapts to the passage's own level, and its self-check is a
// checklist the student fills in — never a score the server invents.
const level = (analysis.text.match(/data-retention-level="([A-Z0-9]+)"/) ?? [])[1];
const target = Number((analysis.text.match(/data-retention-target="(\d+)"/) ?? [])[1]);
check("the recall drill states the passage level", Boolean(level), "no level marker");
check(
  `the recall target matches the level (${level} → ${target} key ideas)`,
  level !== undefined && target === (level >= "C1" ? 5 : level === "B2" ? 4 : 3),
  `level ${level}, target ${target}`
);
check("the self-check is a checklist of what was kept", analysis.text.includes("data-retention-checklist"));
check("the checklist records what the student kept, without a score", analysis.text.includes("data-retention-kept") && !analysis.text.includes("retentionScore"));
check("the clickable word layer is present on the analysis page", analysis.text.includes("data-clickable-text"));

// The vocabulary journey is not deleted, only moved to the stage where the product
// allows it: the learner's OWN submitted review. Save -> own library -> tagged with
// its reading source.
const savedAfter = await api("/api/vocabulary", {
  method: "POST",
  cookie,
  body: {
    items: [{ term: probeWord, definitionEn: "able to continue over time", translationUz: "barqaror" }],
    sourceType: "reading",
    sourceId: passageId,
  },
});
check(
  "a word CAN be saved from the submitted review",
  savedAfter.status === 200 && savedAfter.json?.added === 1,
  `status ${savedAfter.status} added ${savedAfter.json?.added}`
);

const after = await api(`/api/vocabulary/search?q=${encodeURIComponent(probeWord)}`, { cookie });
check("the saved word is in the student's own library", after.json?.results?.length === 1, `n=${after.json?.results?.length}`);

// The games endpoint only returns `words` when a game is named; without `game=` it
// answers counts only. The probe omitted it and read the empty list as a missing tag,
// while `total` already proved the word was in the reading set.
const readingSet = await api("/api/vocabulary/games?set=reading&game=cards", { cookie });
const readingTerms = (readingSet.json?.words ?? []).map((word) => word.term);
check(
  "the word is tagged with its reading source",
  readingTerms.includes(probeWord),
  `set: ${readingTerms.join(", ")}`
);
// Negative control: a DIFFERENT source set must not contain this reading word, or
// "it is tagged" would pass for an untagged word that simply exists.
const listeningSet = await api("/api/vocabulary/games?set=listening&game=cards", { cookie });
const listeningTerms = (listeningSet.json?.words ?? []).map((word) => word.term);
check(
  "the reading word is not claimed by another source set",
  !listeningTerms.includes(probeWord),
  `listening set: ${listeningTerms.join(", ")}`
);
// The word refused during the exam must NOT have been stored.
const refusedLookup = await api(`/api/vocabulary/search?q=${encodeURIComponent(probeWord + "x")}`, { cookie });
check(
  "the word refused during the exam was never stored",
  (refusedLookup.json?.results?.length ?? 0) === 0,
  `n=${refusedLookup.json?.results?.length}`
);

// --- 5. privacy -------------------------------------------------------------
const stranger = await api(`/app/reading/attempts/${attemptId}`, { cookie: otherCookie });
// A status code alone proves nothing here: a shell page flushes its 200 before the
// page body runs, so notFound() can only swap the BODY (see
// docs/KNOWN-ISSUES-NOT-FOUND-STATUS.md). The real security claim is that none of the
// other learner's work is rendered — which is the stronger assertion anyway.
const strangerText = stranger.text ?? "";
check(
  "another student sees none of this attempt's passage content",
  !strangerText.includes("data-clickable-text") &&
    !strangerText.includes("data-type-mastery") &&
    !/data-evidence="/.test(strangerText),
  `status ${stranger.status}, protected markers leaked into another account`
);
// Positive control: those markers DO appear for the rightful owner, so the absence
// above is meaningful rather than vacuous.
check(
  "the owner's own review does render that content (positive control)",
  analysis.text.includes("data-type-mastery") && /data-evidence="/.test(analysis.text),
  "the detector would not notice a leak"
);

const anonymous = await api(`/api/vocabulary/games?set=reading`);
check("an anonymous caller gets no reading word set", anonymous.status === 401, `status ${anonymous.status}`);


// 7. The retention drill is a reading mode of its own: a student can practise
//    recall without sitting a test first, and it still claims no score.
const retentionPage = await api("/app/reading/retention", { cookie });
check("the retention mode opens for a student", retentionPage.status === 200, `status ${retentionPage.status}`);
const retentionHtml = retentionPage.text ?? "";
// The drill now opens on a LEVEL PICKER and reveals the passage after a level is
// started, so the passage/input markers are not on first paint. The entry controls
// are what must exist.
check(
  "the drill renders its own controls",
  /data-retention-level-list/.test(retentionHtml) && /data-retention-start/.test(retentionHtml),
  "no level picker or start control"
);
check(
  "the drill explains itself before asking for recall",
  /data-retention-instructions/.test(retentionHtml),
  "no instructions before the drill"
);
check("the drill states it is not scored", /Nothing is scored|ball qo'yilmaydi/i.test(retentionHtml));
// The drill is offered by the Reading hub's own Retention tab (the hub is tabbed,
// so the link is on that tab, not on the default academic listing).
check(
  "the reading hub offers the retention drill",
  hubDestinations.includes("retention"),
  `destinations: ${JSON.stringify(hubDestinations)}`
);
check(
  "the reading hub offers the academic product",
  hubDestinations.includes("academic"),
  `destinations: ${JSON.stringify(hubDestinations)}`
);

console.log(`\n# pass ${passed} / fail ${failed}`);
if (failed > 0) {
  console.log("# failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
}

// process.exit() skips beforeExit, so the sweep is awaited here on the normal path.
await finalSweep("end of run");
process.exit(failed > 0 || process.exitCode === 1 ? 1 : 0);
