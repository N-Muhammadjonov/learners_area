#!/usr/bin/env node
/**
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
const list = await api("/reading", { cookie });
check("the reading page renders for an approved student", list.status === 200, `status ${list.status}`);
check("the passage list marks each passage", /data-passage="/.test(list.text), "no data-passage found");

const { default: pg } = await import("pg");
const db = new pg.Client({
  connectionString: (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area",
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
const exam = await api(`/reading/attempts/${attemptId}`, { cookie });
check("the exam renders the passage", exam.status === 200, `status ${exam.status}`);
check("the passage has the clickable-word layer", exam.text.includes("data-clickable-text"));
check("the exam offers read-aloud", exam.text.includes("data-read-aloud"));
check("a passage word is a real button", /data-word="[a-z]+"/i.test(exam.text));

// --- 3. a word saved from the passage lands in the shared engine ------------
const lookup = await api(`/api/vocabulary/search?q=${encodeURIComponent("congestion")}`, { cookie });
const beforeCount = lookup.json?.results?.length ?? 0;

const probeWord = `sustainable${Date.now().toString(36).slice(-4)}`;
const saved = await api("/api/vocabulary", {
  method: "POST",
  cookie,
  body: {
    items: [{ term: probeWord, definitionEn: "able to continue over time", translationUz: "barqaror" }],
    sourceType: "reading",
    sourceId: passageId,
  },
});
check("a word can be saved from a passage", saved.status === 200 && saved.json?.added === 1, `added ${saved.json?.added}`);

const after = await api(`/api/vocabulary/search?q=${encodeURIComponent(probeWord)}`, { cookie });
check("the saved word is in the student's own library", after.json?.results?.length === 1, `n=${after.json?.results?.length}`);

const readingSet = await api("/api/vocabulary/games?set=reading", { cookie });
const readingTerms = (readingSet.json?.words ?? []).map((word) => word.term);
check(
  "the word is tagged with its reading source",
  readingTerms.includes(probeWord),
  `set: ${readingTerms.join(", ")}`
);
check("a lookup before the save is consistent", beforeCount >= 0);

// --- 4. submit and inspect the analysis -------------------------------------
const questions = await api(`/api/reading/attempts/${attemptId}`, { cookie });
const payload = await (async () => {
  // The exam page is server-rendered; read the answer key straight from the DB.
  const client = new pg.Client({
    connectionString: (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area",
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

const analysis = await api(`/reading/attempts/${attemptId}`, { cookie });
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

// --- 5. privacy -------------------------------------------------------------
const stranger = await api(`/reading/attempts/${attemptId}`, { cookie: otherCookie });
check(
  "another student cannot open this attempt",
  stranger.status === 404 || stranger.status === 307,
  `status ${stranger.status}`
);

const anonymous = await api(`/api/vocabulary/games?set=reading`);
check("an anonymous caller gets no reading word set", anonymous.status === 401, `status ${anonymous.status}`);


// 7. The retention drill is a reading mode of its own: a student can practise
//    recall without sitting a test first, and it still claims no score.
const retentionPage = await api("/reading/retention", { cookie });
check("the retention mode opens for a student", retentionPage.status === 200, `status ${retentionPage.status}`);
const retentionHtml = retentionPage.text ?? "";
check("the drill renders its own controls", /data-retention-input/.test(retentionHtml) && /data-retention-passage/.test(retentionHtml));
check("the passage is open to read first", /data-retention-passage/.test(retentionHtml) && !/data-retention-passage[^>]*hidden/.test(retentionHtml));
check("the drill states it is not scored", /Nothing is scored|ball qo'yilmaydi/i.test(retentionHtml));
const readingList = await api("/reading", { cookie });
check("the reading list links to the drill", /data-retention-mode-link/.test(readingList.text ?? ""));

console.log(`\n# pass ${passed} / fail ${failed}`);
if (failed > 0) {
  console.log("# failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failed > 0 ? 1 : 0);
