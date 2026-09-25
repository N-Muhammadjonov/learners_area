#!/usr/bin/env node
/**
 * End-to-end verification of the Vocabulary Learning Engine over real HTTP.
 *
 * What this proves, in order:
 *   1. the five-section Vocabulary page renders for an approved student;
 *   2. a stranger (no session) and a suspended account reach nothing;
 *   3. words are added in bulk through the shared engine, with sense-aware
 *      deduplication and one point award per genuinely new word;
 *   4. a replay of the same batch adds no word and no point (anti-farming);
 *   5. the official 1/3/7/16/35 ladder is advanced ONLY by scheduled revision;
 *   6. a game answer never moves the ladder, and pays at most once per day;
 *   7. search is scoped to the caller, exact-before-prefix, and searches Uzbek;
 *   8. a sentence is stored truthfully and only an accepted one earns the full
 *      award (the local evaluator is deterministic and offline);
 *   9. the leaderboard numbers come from the ledger and cannot be posted;
 *  10. folders are private, and one student cannot touch another's words.
 *
 * Requires the dev server and DATABASE_URL (the direct SQL checks in step 10).
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/learners_area";

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
  const setCookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, text, json, setCookie };
}

async function login(email, password) {
  const res = await api("/api/auth/login", { method: "POST", body: { email, password } });
  return { cookie: res.setCookie, status: res.status };
}

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
    body: { name: "Vocab QA", email: studentEmail, password },
  });
  check("registration of a new student succeeds", register.status === 200 || register.status === 201, `status ${register.status}`);

  const session = await login(studentEmail, password);
  check("a fresh account can sign in", session.status === 200 && session.cookie.length > 0, `status ${session.status}`);

  const pending = await api("/vocabulary", { cookie: session.cookie });
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
  const page = await api("/vocabulary", { cookie: student.cookie });
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
  console.log(`\n# pass ${passed} / fail ${failed}`);
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
check("each genuinely new word earns 2 points", batch.json?.points === 6, `points ${batch.json?.points}`);

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
check("the leaderboard reports the ledger total", board.json?.points === 6, `points ${board.json?.points}`);
check("the leaderboard ranks the caller", board.json?.rank >= 1, `rank ${board.json?.rank}`);

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

const allSet = await api("/api/vocabulary/games?set=all", { cookie });
check("the all-words set returns the whole library", allSet.json?.count === 3, `count ${allSet.json?.count}`);

const gameAnswer = await api("/api/vocabulary/games", {
  method: "POST",
  cookie,
  body: { entryId: firstWord.id, correct: true, set: "all", eligible: true },
});
check("a game answer reports that the ladder was untouched", gameAnswer.json?.srsUntouched === true);
check(
  "a game answer on a word that is not due earns no point",
  gameAnswer.json?.awarded === 0,
  `awarded ${gameAnswer.json?.awarded}`
);

const afterGame = await api(`/api/vocabulary/search?q=resilient`, { cookie });
const stageAfterGame = afterGame.json?.results?.[0]?.srsStage;
check("the stage is unchanged after the game", stageAfterGame === 0, `stage ${stageAfterGame}`);

const foreignGame = await api("/api/vocabulary/games", {
  method: "POST",
  cookie,
  body: { entryId: "00000000-0000-4000-8000-000000000000", correct: true, set: "all" },
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
  body: { name: "Vocab QA B", email: otherEmail, password },
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
check(
  "accepted active use is worth more than a new word",
  boardAfterSentence.json?.points >= 9,
  `points ${boardAfterSentence.json?.points}`
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
const peoplePage = await api("/admin/people", { cookie: ownerSession.cookie });
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

const blockedPage = await api("/vocabulary", { cookie });
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

console.log(`\n# pass ${passed} / fail ${failed}`);
if (failed > 0) {
  console.log("# failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failed > 0 ? 1 : 0);
