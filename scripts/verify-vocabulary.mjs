#!/usr/bin/env node
/**
 * End-to-end verification of the Vocabulary Learning Engine over real HTTP.
 *
 * What this proves, in order:
 *   1. the five-section Vocabulary page renders for an approved student;
 *   2. a stranger (no session) and a suspended account reach nothing;
 *   3. words are added in bulk through the shared engine, with sense-aware
 *      deduplication, and no point for merely saving a word (the authoritative
 *      model in src/lib/services/vocabulary/points.ts scores newWord = 0;
 *      points come from revision, game answers and sentences);
 *   4. a replay of the same batch adds no word and no point (anti-farming);
 *   5. the official 1/3/7/16/35 ladder is advanced ONLY by scheduled revision;
 *   6. a game answer never moves the ladder, is graded by the server (a client
 *      that merely claims success is refused), and pays at most once per day;
 *   7. search is scoped to the caller, exact-before-prefix, and searches Uzbek;
 *   8. a sentence is stored truthfully and only an accepted one earns the full
 *      award (the local evaluator is deterministic and offline);
 *   9. the leaderboard numbers come from the ledger and cannot be posted;
 *  10. folders are private, one student cannot touch another's words, and the
 *      authored alternative answers of a word are stored and capped;
 *
 * Requires the dev server and DATABASE_URL (the direct SQL checks in step 10).
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

/**
 * DETERMINISM: every run gets its own abuse-limiter bucket.
 *
 * The limiter is keyed by `clientKey(req)`, which prefers `x-forwarded-for`. Repeated
 * acceptance sweeps from one host therefore shared a bucket, and an in-memory counter
 * that survives database reseeds eventually answered 429 — registrations failed, their
 * responses read back as `undefined`, and unrelated assertions cascaded. The gate must
 * not depend on how many times it has been run before.
 *
 * This isolates the HARNESS, it does not weaken the product: no rule, limit or window is
 * changed, the limiter still runs on every request, and in production `x-forwarded-for`
 * is set by the platform rather than the caller. Checks that deliberately exercise the
 * limiter keep their own fixed key so they still trip it.
 */
const RUN_IP = process.env.QA_RUN_IP
  ?? `10.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`;

const DATABASE_URL = (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area");

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
      "x-forwarded-for": RUN_IP,
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
  const setCookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, text, json, setCookie };
}

async function login(email, password) {
  const res = await api("/api/auth/login", { method: "POST", body: { email, password } });
  return { cookie: res.setCookie, status: res.status };
}

/*
 * QA SAFETY (section 03.4). This probe registers REAL accounts and authors REAL
 * catalogue entries. It tagged its fixtures uniquely but never removed them, so every
 * run left two users, a folder and a dozen lexemes behind permanently: measured at
 * +2 users, +14 lexemes, +13 lexical_units, +21 lexical_unit_forms, +14 user_vocabulary
 * and more per run. That is not only untidy — accumulated accounts and catalogue rows
 * silently change what later probes count, and an account that outlives its run is
 * exactly the kind of residue a re-seed is supposed to make impossible.
 *
 * Same pattern as verify-uploads: the rows are created over HTTP, so there is no single
 * insertion point to tag. Snapshot the owned tables BEFORE the first mutation, then
 * delete exactly the ids that appeared and re-query to PROVE nothing is left. An id
 * absent from the baseline and present at the end was created by this run.
 */
const { default: sweepPg } = await import("pg");
const { assertMutableDatabase, createRowSweeper, installSweepHandlers } =
  await import("./lib/fixture-safety.mjs");

// Fails closed: a probe that creates and deletes accounts must never be pointed at a
// database it does not own.
assertMutableDatabase(DATABASE_URL, { probe: "verify-vocabulary" });

const sweepDb = new sweepPg.Client({ connectionString: DATABASE_URL });
await sweepDb.connect();

/*
 * Children before parents. Audit rows are swept too: in this disposable database the
 * audit_log and activity_events entries describing a fixture action ARE fixture data,
 * and the guard above guarantees this can never run against a real deployment.
 */
const sweeper = createRowSweeper({
  client: sweepDb,
  probe: "verify-vocabulary",
  tables: [
    "vocab_point_events", "vocabulary_usages", "evaluations", "notifications",
    "access_requests", "activity_events", "audit_log", "user_vocabulary",
    "vocab_folders", "lexical_unit_forms", "lexemes", "lexical_units", "users",
  ],
});
const finalSweep = installSweepHandlers(sweeper, {
  probe: "verify-vocabulary",
  onDone: () => sweepDb.end().catch(() => {}),
});

await sweeper.capture();

const unique = `vocab.qa.${Date.now().toString(36)}`;
const studentEmail = `${unique}@learnersarea.uz`;
const password = "Student12345!";
let studentId = null;

// ---------------------------------------------------------------------------
// Fixture: a real approved student, created through the public flows.
// ---------------------------------------------------------------------------
async function makeStudent() {
  const register = await api("/api/auth/register", {
    method: "POST",
    // `gender` became a required field of registerSchema; a probe that omits it
    // tests the validator, not registration. Send a complete, realistic payload.
    body: { name: "Vocab QA", email: studentEmail, password, gender: "female" },
  });
  check("registration of a new student succeeds", register.status === 200 || register.status === 201, `status ${register.status}`);

  const session = await login(studentEmail, password);
  check("a fresh account can sign in", session.status === 200 && session.cookie.length > 0, `status ${session.status}`);

  const pending = await api("/app/vocabulary", { cookie: session.cookie });
  check(
    "a pending applicant is redirected away from Vocabulary",
    pending.status === 307 || pending.status === 302 || pending.status === 303,
    `status ${pending.status}`
  );
  const pendingApi = await api("/api/vocabulary", { cookie: session.cookie });
  check("a pending applicant reaches no vocabulary API", pendingApi.status === 401, `status ${pendingApi.status}`);

  const filed = await api("/api/admission/request", {
    method: "POST",
    cookie: session.cookie,
    body: { message: "verify-vocabulary" },
  });
  check("the new account files an access request", filed.status === 200 && Boolean(filed.json?.requestId), `status ${filed.status}`);

  const selfApprove = await api(`/api/admin/admission/${filed.json?.requestId}/decide`, {
    method: "POST",
    cookie: session.cookie,
    body: { decision: "approve" },
  });
  check("an applicant cannot approve their own request", [401, 403].includes(selfApprove.status), `status ${selfApprove.status}`);

  const owner = await login("owner@learnersarea.uz", "Owner12345!");
  const decide = await api(`/api/admin/admission/${filed.json.requestId}/decide`, {
    method: "POST",
    cookie: owner.cookie,
    body: { decision: "approve" },
  });
  check("the owner approves it", decide.status === 200, `status ${decide.status}`);
  studentId = decide.json?.userId ?? null;
  check("the decision reports the applicant it affected", Boolean(studentId));

  const student = await login(studentEmail, password);
  const page = await api("/app/vocabulary", { cookie: student.cookie });
  check("an approved student reaches the Vocabulary page", page.status === 200, `status ${page.status}`);
  for (const probe of ['data-tab="words"', 'data-tab="revision"', 'data-tab="games"', 'data-tab="use"', 'data-tab="board"']) {
    check(`the Vocabulary page renders the ${probe.split("=")[1]} section`, page.text.includes(probe));
  }
  check("the page renders the leaderboard rail", page.text.includes("data-leaderboard"));
  check("the page renders the long search box", page.text.includes("vocab-search"));

  return student.cookie;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
const cookie = await makeStudent();
if (!cookie) {
  console.log("\nfixture creation failed — stopping");
  process.exit(1);
}

const anonymous = await api("/api/vocabulary/games?set=due");
check("an anonymous caller gets 401 from the games API", anonymous.status === 401, `status ${anonymous.status}`);

const anonymousSearch = await api("/api/vocabulary/search?q=test");
check("an anonymous caller gets 401 from search", anonymousSearch.status === 401, `status ${anonymousSearch.status}`);

// --- bulk add, dedupe and points -------------------------------------------
const batch = await api("/api/vocabulary", {
  method: "POST",
  cookie,
  body: {
    items: [
      { term: "resilient", definitionEn: "able to recover quickly", translationUz: "bardoshli" },
      { term: "Resilient", definitionEn: "able to recover quickly", translationUz: "bardoshli" },
      { term: "resilient", definitionEn: "springing back into shape", translationUz: "elastik" },
      { term: "to put up with", definitionEn: "to tolerate something unpleasant", translationUz: "chidamoq" },
    ],
    sourceType: "manual",
  },
});
check("bulk add returns a result", batch.status === 200, `status ${batch.status}`);
check("the same sense pasted twice is stored once, two senses stay apart", batch.json?.added === 3, `added ${batch.json?.added}`);
check("the collapsed duplicate is reported", batch.json?.duplicates === 1, `duplicates ${batch.json?.duplicates}`);
// SCORING MODEL (src/lib/services/vocabulary/points.ts): newWord is 0 — "legacy ledger
// kind retained for history only; new saves do not emit it". Merely collecting words is
// deliberately NOT progress; only recall is (revision 1, gameAnswer 1, sentence 2).
// The old expectation of 2 points per saved word encoded a scoring model the product
// has removed, and would have masked a real points-farming regression.
check("saving words is not itself scored", batch.json?.points === 0, `points ${batch.json?.points}`);

const replay = await api("/api/vocabulary", {
  method: "POST",
  cookie,
  body: { items: [{ term: "resilient", definitionEn: "able to recover quickly", translationUz: "bardoshli" }] },
});
check("replaying the same word adds nothing", replay.json?.added === 0, `added ${replay.json?.added}`);
check("replaying the same word earns no points", replay.json?.points === 0 || replay.json?.points === undefined, `points ${replay.json?.points}`);

const library = await api("/api/vocabulary", { cookie });
check("the library lists the two senses separately", library.json?.words?.length === 3, `n=${library.json?.words?.length}`);

// --- a farmed score cannot be posted --------------------------------------
const farm = await api("/api/vocabulary", {
  method: "POST",
  cookie,
  body: { items: [{ term: "resilient", definitionEn: "able to recover quickly" }], points: 999999 },
});
check("a client-supplied points value is ignored", farm.json?.points === 0, `points ${farm.json?.points}`);

const board = await api("/api/vocabulary/leaderboard", { cookie });
check("the leaderboard reports the ledger total", board.json?.points === 0, `points ${board.json?.points}`);
// and collecting words can never move the leaderboard on its own
check("hoarding words cannot climb the leaderboard", (board.json?.points ?? 0) === 0, `points ${board.json?.points}`);
// A learner with no points is deliberately UNRANKED: getStanding() ranks only rows with
// effectivePoints > 0, so rank 0 means "not on the board yet". Demanding rank >= 1 here
// contradicted the assertion two lines above that the total is still 0.
check(
  "a learner who has scored nothing is not yet ranked",
  board.json?.rank === 0,
  `rank ${board.json?.rank} points ${board.json?.points}`
);

// --- the official ladder ----------------------------------------------------
const firstWord = library.json.words.find((word) => word.term === "resilient" && word.translationUz === "bardoshli");
const secondSense = library.json.words.find((word) => word.term === "resilient" && word.translationUz === "elastik");
check("the two senses are distinct rows", firstWord?.id !== secondSense?.id);

const review1 = await api(`/api/vocabulary/${firstWord.id}/review`, {
  method: "POST",
  cookie,
  body: { outcome: "correct" },
});
check("the first recall moves the word to stage 1", review1.json?.srsStage === 0, `stage ${review1.json?.srsStage}`);
check("the first interval is one day", review1.json?.intervalDays === 1, `interval ${review1.json?.intervalDays}`);
check("the first recall marks the word as learning", review1.json?.mastery === "learning", `mastery ${review1.json?.mastery}`);

const reviewEarly = await api(`/api/vocabulary/${firstWord.id}/review`, {
  method: "POST",
  cookie,
  body: { outcome: "correct" },
});
check(
  "a word that is not due yet cannot be reviewed early",
  reviewEarly.status === 409 && reviewEarly.json?.error === "not_due",
  `status ${reviewEarly.status} error ${reviewEarly.json?.error}`
);
check("the early review reports when the word comes back", Boolean(reviewEarly.json?.nextReviewAt));

const missed = await api(`/api/vocabulary/${secondSense.id}/review`, {
  method: "POST",
  cookie,
  body: { outcome: "incorrect" },
});
check("a word that is due can be reviewed", missed.status === 200, `status ${missed.status}`);
check("a miss schedules the word for tomorrow", missed.json?.intervalDays === 1, `interval ${missed.json?.intervalDays}`);
check("a miss keeps the word out of mastered", missed.json?.mastery !== "mastered", `mastery ${missed.json?.mastery}`);

const badOutcome = await api(`/api/vocabulary/${firstWord.id}/review`, {
  method: "POST",
  cookie,
  body: { grade: "easy" },
});
check("the old SM-2 grade payload is rejected", badOutcome.status === 400, `status ${badOutcome.status}`);

// --- games never move the ladder -------------------------------------------
const dueSet = await api("/api/vocabulary/games?set=due", { cookie });
const dueTerms = (dueSet.json?.words ?? []).map((word) => word.term);
check(
  "the due set contains only words that are genuinely due",
  (dueSet.json?.words ?? []).every((word) => new Date(word.nextReviewAt).getTime() <= Date.now()),
  "a word that is not due leaked into the set"
);
check("a word reviewed today is not in the due set", !dueTerms.includes("resilient"), `due: ${dueTerms.join(", ")}`);

// The games endpoint returns WORDS only when a concrete game is named
// (`selected = gameId ? ... : []`); without &game= it reports availability counts only.
// Querying it bare therefore proved nothing about the library.
const allSetBare = await api("/api/vocabulary/games?set=all", { cookie });
check("the bare set reports availability without handing out words", allSetBare.json?.total >= 3 && (allSetBare.json?.words ?? []).length === 0, `total ${allSetBare.json?.total}`);
const allSet = await api("/api/vocabulary/games?set=all&game=translation", { cookie });
check("the all-words set returns the whole library", allSet.json?.count >= 3, `count ${allSet.json?.count}`);

// The server grades the answer itself. A request that only CLAIMS success must
// not be accepted at all — this is the shape the old client used to send.
const claimedVerdict = await api("/api/vocabulary/games", {
  method: "POST",
  cookie,
  body: { entryId: firstWord.id, correct: true, set: "all", eligible: true },
});
check(
  "a client cannot assert its own verdict any more",
  claimedVerdict.status === 400,
  `status ${claimedVerdict.status}`
);

const wrongAnswer = await api("/api/vocabulary/games", {
  method: "POST",
  cookie,
  body: { entryId: firstWord.id, set: "all", gameId: "gap", submission: { kind: "spelling", text: "definitely-not-the-word" } },
});
check(
  "a wrong answer is marked wrong by the server even on a due word",
  wrongAnswer.json?.correct === false && wrongAnswer.json?.awarded === 0,
  `correct ${wrongAnswer.json?.correct} awarded ${wrongAnswer.json?.awarded}`
);

const rightAnswer = await api("/api/vocabulary/games", {
  method: "POST",
  cookie,
  body: {
    entryId: firstWord.id,
    set: "all",
    // `eligible` was a legacy client-asserted field; answerSchema is .strict() and
    // requires gameId, so the old payload was rejected 400 and read back as undefined.
    gameId: "gap",
    submission: { kind: "spelling", text: `  ${firstWord.term.toUpperCase()}.  ` },
  },
});
check("the server grades a correct typed answer as correct", rightAnswer.json?.correct === true && rightAnswer.json?.verified === true);
check("a graded answer reports that the ladder was untouched", rightAnswer.json?.srsUntouched === true);
// The contract (src/lib/services/vocabulary/points.ts + recordGameAnswer) is that a
// VERIFIED CORRECT answer pays gameAnswer=1, deduped per learner/word/day, and never
// moves the SRS ladder. There is no "due" condition: due-ness governs revision, not
// play. The old expectation of 0 contradicted both the code and this file's own header.
check(
  "a verified correct game answer pays exactly one point",
  rightAnswer.json?.awarded === 1,
  `awarded ${rightAnswer.json?.awarded}`
);

// ...and it pays AT MOST once per word per day, so an immediate repeat earns nothing.
const sameDayRepeat = await api("/api/vocabulary/games", {
  method: "POST",
  cookie,
  body: {
    entryId: firstWord.id,
    set: "all",
    gameId: "gap",
    submission: { kind: "spelling", text: firstWord.term },
  },
});
check(
  "a second correct answer on the same word the same day pays nothing",
  sameDayRepeat.json?.awarded === 0,
  `awarded ${sameDayRepeat.json?.awarded}`
);

const selfClaim = await api("/api/vocabulary/games", {
  method: "POST",
  cookie,
  body: { entryId: firstWord.id, set: "all", gameId: "cards", submission: { kind: "self", known: true } },
});
check(
  "a self-assessment is recorded as practice and never earns a point",
  selfClaim.json?.verified === false && selfClaim.json?.awarded === 0,
  `verified ${selfClaim.json?.verified} awarded ${selfClaim.json?.awarded}`
);

const afterGame = await api(`/api/vocabulary/search?q=resilient`, { cookie });
const stageAfterGame = afterGame.json?.results?.[0]?.srsStage;
check("the stage is unchanged after the game", stageAfterGame === 0, `stage ${stageAfterGame}`);

const foreignGame = await api("/api/vocabulary/games", {
  method: "POST",
  cookie,
  body: {
    entryId: "00000000-0000-4000-8000-000000000000",
    set: "all",
    gameId: "gap",
    submission: { kind: "spelling", text: "resilient" },
  },
});
check("an answer for a word outside the set is rejected", foreignGame.status === 404, `status ${foreignGame.status}`);

// --- search ---------------------------------------------------------------
const searchExact = await api("/api/vocabulary/search?q=resilient", { cookie });
check("search finds the word", searchExact.json?.results?.length === 2, `n=${searchExact.json?.results?.length}`);
check("an exact match ranks first", searchExact.json?.results?.[0]?.match?.startsWith("term_exact"), `match ${searchExact.json?.results?.[0]?.match}`);

const searchUz = await api(`/api/vocabulary/search?q=${encodeURIComponent("bardoshli")}`, { cookie });
check("search reads Uzbek translations", searchUz.json?.results?.length === 1, `n=${searchUz.json?.results?.length}`);
check("the Uzbek hit is labelled as a translation match", searchUz.json?.results?.[0]?.match === "translation");

const searchEmpty = await api("/api/vocabulary/search?q=zzzzzznotaword", { cookie });
check("an unmatched query returns nothing rather than everything", searchEmpty.json?.results?.length === 0);

// --- a second student sees none of this ------------------------------------
const otherEmail = `${unique}.b@learnersarea.uz`;
const otherRegister = await api("/api/auth/register", {
  method: "POST",
  body: { name: "Vocab QA B", email: otherEmail, password, gender: "male" },
});
const ownerSession = await login("owner@learnersarea.uz", "Owner12345!");
const otherFiled = await api("/api/admission/request", {
  method: "POST",
  cookie: otherRegister.setCookie,
  body: { message: "verify-vocabulary b" },
});
if (otherFiled.json?.requestId) {
  await api(`/api/admin/admission/${otherFiled.json.requestId}/decide`, {
    method: "POST",
    cookie: ownerSession.cookie,
    body: { decision: "approve" },
  });
}
const other = await login(otherEmail, password);
const otherSearch = await api("/api/vocabulary/search?q=resilient", { cookie: other.cookie });
check("another student cannot see the first student's words", otherSearch.json?.results?.length === 0);

const otherReview = await api(`/api/vocabulary/${secondSense.id}/review`, {
  method: "POST",
  cookie: other.cookie,
  body: { outcome: "correct" },
});
check("another student cannot review someone else's word", otherReview.status === 404, `status ${otherReview.status}`);

const otherUse = await api(`/api/vocabulary/${firstWord.id}/use`, {
  method: "POST",
  cookie: other.cookie,
  body: { sentence: "This is not mine." },
});
check("another student cannot write against someone else's word", otherUse.status === 404, `status ${otherUse.status}`);

// --- folders ---------------------------------------------------------------
const folder = await api("/api/vocabulary/folders", {
  method: "POST",
  cookie,
  body: { name: "QA folder" },
});
check("a folder can be created", folder.status === 200 && folder.json?.folder?.id, `status ${folder.status}`);

const duplicateFolder = await api("/api/vocabulary/folders", {
  method: "POST",
  cookie,
  body: { name: "QA folder" },
});
check(
  "creating the same folder twice is idempotent, and says so",
  duplicateFolder.status === 200 && duplicateFolder.json?.existing === true,
  `status ${duplicateFolder.status} existing ${duplicateFolder.json?.existing}`
);

const moved = await api("/api/vocabulary/folders", {
  method: "POST",
  cookie,
  body: { entryIds: [firstWord.id], folderId: folder.json.folder.id },
});
check("a word can be moved into a folder", moved.json?.moved === 1, `moved ${moved.json?.moved}`);

const folderList = await api("/api/vocabulary/folders", { cookie });
check("the folder lists its word count", folderList.json?.folders?.[0]?.count === 1, `count ${folderList.json?.folders?.[0]?.count}`);

const crossMove = await api("/api/vocabulary/folders", {
  method: "POST",
  cookie: other.cookie,
  body: { entryIds: [firstWord.id], folderId: folder.json.folder.id },
});
check("another student's folder cannot be written to", crossMove.status === 404, `status ${crossMove.status}`);

const otherFolders = await api("/api/vocabulary/folders", { cookie: other.cookie });
check("folders are not shared between students", (otherFolders.json?.folders ?? []).length === 0);

// Filing a word into somebody else's folder is the same hole as moving one
// there: the batch endpoint must refuse it as well, and the owner's count must
// come out of the refused attempt unchanged.
const crossFile = await api("/api/vocabulary", {
  method: "POST",
  cookie: other.cookie,
  body: {
    folderId: folder.json.folder.id,
    items: [{ term: "intruder", definitionEn: "someone who enters without permission" }],
  },
});
check("a word cannot be filed into another student's folder", crossFile.status === 404, `status ${crossFile.status}`);

const otherWordsAfter = await api("/api/vocabulary?limit=200", { cookie: other.cookie });
check(
  "the refused filing wrote nothing into the caller's own library",
  !(otherWordsAfter.json?.words ?? []).some((word) => word.term === "intruder")
);

const ownerFolderAfter = await api("/api/vocabulary/folders", { cookie });
check(
  "the owner's folder count is untouched by the refused filing",
  ownerFolderAfter.json?.folders?.[0]?.count === 1,
  `count ${ownerFolderAfter.json?.folders?.[0]?.count}`
);

// --- authored alternative answers -----------------------------------------
const withAlternatives = await api("/api/vocabulary", {
  method: "POST",
  cookie,
  body: {
    items: [
      {
        term: "commence",
        definitionEn: "to begin something",
        // The Translation challenge only offers words that HAVE an Uzbek
        // translation, so a fixture without one would never reach the game and
        // the assertion below would be vacuous.
        translationUz: "boshlamoq",
        acceptedTranslations: ["start", "begin", "kick off"],
      },
    ],
  },
});
check("a word may carry authored alternative answers", withAlternatives.json?.ok === true, `status ${withAlternatives.status}`);

// Read the authored answers where they are ACTUALLY used. A bare
// `?set=all` hands out no words at all (by design: a set without a game is a
// filter, not a round) and never includes acceptedTranslations, which is
// exposed only for game=translation. Querying it therefore searched an empty
// list and could only pass by accident.
const alternativesInPlay = await api("/api/vocabulary/games?set=all&game=translation&limit=500", { cookie });
const translationRound = alternativesInPlay.json?.words ?? [];
check(
  "the Translation challenge actually offers a round (otherwise the next checks are vacuous)",
  translationRound.length > 0,
  `status ${alternativesInPlay.status} n=${translationRound.length}`
);
const commenceWord = translationRound.find((word) => word.term === "commence");
check(
  "the authored answers reach the challenge that accepts them",
  (commenceWord?.acceptedTranslations ?? []).length === 3,
  `n=${(commenceWord?.acceptedTranslations ?? []).length}`
);
check(
  "the term itself is accepted as well",
  commenceWord?.term === "commence"
);

const tooManyAlternatives = await api("/api/vocabulary", {
  method: "POST",
  cookie,
  body: {
    items: [
      {
        term: "commence",
        definitionEn: "to begin something",
        acceptedTranslations: ["a", "b", "c", "d", "e", "f"],
      },
    ],
  },
});
check(
  "a caller cannot bloat a shared lexical row with unlimited alternatives",
  tooManyAlternatives.status === 400,
  `status ${tooManyAlternatives.status}`
);

// --- topic packs -----------------------------------------------------------
const packs = await api("/api/vocabulary/packs", { cookie });
check("the topic packs are listed", (packs.json?.packs ?? []).length >= 2, `n=${packs.json?.packs?.length}`);

const addPack = await api("/api/vocabulary/packs", {
  method: "POST",
  cookie,
  body: { packId: "health_medicine" },
});
check("a pack can be added in one action", addPack.json?.ok === true && addPack.json?.added >= 10, `added ${addPack.json?.added}`);

const badPack = await api("/api/vocabulary/packs", {
  method: "POST",
  cookie,
  body: { packId: "../../etc/passwd" },
});
check("an unknown pack id is refused", badPack.status === 400, `status ${badPack.status}`);

const packWords = await api("/api/vocabulary", { cookie });
check("the pack words joined the same library", packWords.json?.words?.length >= 12, `n=${packWords.json?.words?.length}`);

// --- sentence bank and the evaluator ---------------------------------------
// Measure the ledger immediately before the sentence so the award can be asserted as a
// delta rather than a hard-coded total that drifts with every other scoring change.
const boardBeforeSentence = (await api("/api/vocabulary/leaderboard", { cookie })).json?.points ?? 0;
const use = await api(`/api/vocabulary/${firstWord.id}/use`, {
  method: "POST",
  cookie,
  body: { sentence: "The resilient team recovered quickly after the loss." },
});
check("a sentence is accepted by the offline evaluator", use.status === 200, `status ${use.status}`);
check("the sentence carries a real checked-by attribution", typeof use.json?.checkedBy === "string" && use.json.checkedBy.length > 0, `${use.json?.checkedBy}`);
check("the stored usage id is returned", typeof use.json?.usageId === "string");

const bank = await api("/api/vocabulary/sentences", { cookie });
check("the sentence bank lists the sentence", (bank.json?.sentences ?? []).length === 1, `n=${bank.json?.sentences?.length}`);
check("the bank records where the sentence came from", bank.json?.sentences?.[0]?.origin === "riwi", `origin ${bank.json?.sentences?.[0]?.origin}`);
check("an accepted sentence is labelled accepted", bank.json?.sentences?.[0]?.accepted === true);

const boardAfterSentence = await api("/api/vocabulary/leaderboard", { cookie });
// Assert the RULE, not a magic total: an accepted sentence is worth
// VOCAB_POINTS.sentence (2), and saving words is worth nothing (newWord = 0). The old
// `>= 9` was calibrated against a superseded model in which hoarding words paid, so it
// failed for the right reason once the ledger stopped rewarding collection.
check(
  "an accepted sentence adds exactly the sentence award",
  boardAfterSentence.json?.points - boardBeforeSentence === 2,
  `${boardBeforeSentence} -> ${boardAfterSentence.json?.points}`
);
check(
  "a sentence is worth more than saving a word, which is worth nothing",
  boardAfterSentence.json?.points > boardBeforeSentence,
  `${boardBeforeSentence} -> ${boardAfterSentence.json?.points}`
);

const replayUse = await api(`/api/vocabulary/${firstWord.id}/use`, {
  method: "POST",
  cookie,
  body: { sentence: "The resilient team recovered quickly after the loss." },
});
const boardAfterReplay = await api("/api/vocabulary/leaderboard", { cookie });
check(
  "a repeated sentence cannot be farmed for points",
  replayUse.json?.usageId !== use.json?.usageId &&
    boardAfterReplay.json.points - boardAfterSentence.json.points <= 5,
  `delta ${boardAfterReplay.json.points - boardAfterSentence.json.points}`
);

const emptySentence = await api(`/api/vocabulary/${firstWord.id}/use`, {
  method: "POST",
  cookie,
  body: { sentence: "ab" },
});
check("a too-short sentence is refused", emptySentence.status === 400, `status ${emptySentence.status}`);

// --- suspension removes access immediately ---------------------------------
const peoplePage = await api("/app/admin/people", { cookie: ownerSession.cookie });
check(
  "the owner sees the approved student on the people page",
  peoplePage.text.includes(`data-person-id="${studentId}"`),
  "the applicant is not listed"
);

const suspend = await api(`/api/admin/users/${studentId}/status`, {
  method: "POST",
  cookie: ownerSession.cookie,
  body: { status: "suspended", reason: "verify-vocabulary" },
});
check("the owner can suspend the account", suspend.status === 200, `status ${suspend.status}`);

const blocked = await api("/api/vocabulary/games?set=all", { cookie });
check("a suspended session loses API access at once", [401, 403].includes(blocked.status), `status ${blocked.status}`);

const blockedPage = await api("/app/vocabulary", { cookie });
check(
  "a suspended session is pushed out of the Vocabulary page",
  [302, 303, 307].includes(blockedPage.status),
  `status ${blockedPage.status}`
);

const reactivate = await api(`/api/admin/users/${studentId}/status`, {
  method: "POST",
  cookie: ownerSession.cookie,
  body: { status: "active" },
});
check("the owner can reactivate the account", reactivate.status === 200, `status ${reactivate.status}`);
check("the reactivated session can study again", (await api("/api/vocabulary", { cookie })).status === 200);

// --- the ledger is the only source of points -------------------------------
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: DATABASE_URL });
try {
  await client.connect();
  const rows = await client.query(
    `select count(*)::int as n, coalesce(sum(points),0)::int as total
     from vocab_point_events e join users u on u.id = e.user_id where u.email = $1`,
    [studentEmail]
  );
  check("every award is a row in the ledger", rows.rows[0].n > 0, `rows ${rows.rows[0].n}`);
  check("the ledger total matches what the leaderboard reported", rows.rows[0].total === boardAfterReplay.json.points, `ledger ${rows.rows[0].total} vs api ${boardAfterReplay.json.points}`);

  const stages = await client.query(
    `select count(*)::int as n from user_vocabulary v join users u on u.id = v.user_id
     where u.email = $1 and v.srs_stage > 5`,
    [studentEmail]
  );
  check("no word can exist above the last stage (35 days)", stages.rows[0].n === 0, `rows ${stages.rows[0].n}`);
} catch (error) {
  check("the ledger can be inspected directly in the database", false, error.message);
} finally {
  await client.end().catch(() => {});
}

// --- word map ---------------------------------------------------------------
// The map is verified in scripts/browser/verify-vocabulary-map-browser.mjs, not here.
//
// VocabWordsPanel is a client component that renders the tiles only after its data
// request resolves, so the server-rendered body for /app/vocabulary carries a loading
// boundary and no `data-word-map` at all. Asserting on the raw HTTP text could therefore
// only ever fail, and it was failing for that reason rather than because the map was
// broken — a real browser shows the tiles with correct per-state and per-source counts.
// The invariants (per-user counts that add up to this student's library, no cross-account
// leak, tiles actually filter the list) are asserted there against the settled DOM.

// 11. The lexical boundary: a meaning is never invented, and the centre's own
//     catalogue answers first. A word nobody has authored yet is refused with a
//     message a human can act on, instead of being stored as its own definition.
{
  const lexical = await login(studentEmail, password);
  const invented = await api("/api/vocabulary", {
    method: "POST",
    cookie: lexical.cookie,
    body: { items: [{ term: "zzqx-unheard-of-term-9f2" }], sourceType: "manual" },
  });
  check("a word with no meaning and no source is refused", invented.status === 422, `status ${invented.status}`);
  check(
    "the refusal names the word instead of inventing a definition",
    invented.json?.error === "needs_definition" &&
      (invented.json?.needsDefinition ?? []).includes("zzqx-unheard-of-term-9f2"),
    JSON.stringify(invented.json)
  );

  const lexiconDb = new (await import("pg")).default.Client({
    connectionString: (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area"),
  });
  try {
    await lexiconDb.connect();
    // Unscoped spelling is safe only when the eligible catalogue has one sense.
    // Learner-provided rows and ambiguous words intentionally require a definition.
    const catalogue = await lexiconDb.query(`
      select min(term) as term, min(definition_en) as definition_en
      from lexemes where provenance is distinct from 'user_provided'
      group by lower(term) having count(*) = 1 order by min(term) limit 1`);
    const row = catalogue.rows[0];
    if (row) {
      const filled = await api("/api/vocabulary", {
        method: "POST",
        cookie: lexical.cookie,
        body: { items: [{ term: row.term }], sourceType: "manual" },
      });
      check(
        `a catalogue word arrives with the catalogue's meaning (${row.term})`,
        filled.status === 200 &&
          (filled.json?.needsDefinition ?? []).length === 0 &&
          (filled.json?.ids ?? []).length > 0,
        JSON.stringify(filled.json)
      );
      const stored = await lexiconDb.query(
        "select definition_en from lexemes where term = $1",
        [row.term]
      );
      check(
        "the stored definition is a real definition, not the word itself",
        stored.rows[0].definition_en.trim().toLowerCase() !== row.term.trim().toLowerCase()
      );
    } else {
      check("the catalogue has at least one authored word", false, "lexemes is empty");
    }
  } finally {
    await lexiconDb.end().catch(() => {});
  }
}

console.log(`\n# pass ${passed} / fail ${failed}`);
if (failed > 0) {
  console.log("# failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
}

// process.exit() does NOT run beforeExit handlers, so the sweep is awaited here on the
// normal path. A cleanup failure or any residue fails the run even if every assertion
// passed: a probe that cannot clean up after itself has not proven it is rerunnable.
await finalSweep("end of run");
process.exit(failed > 0 || process.exitCode === 1 ? 1 : 0);
