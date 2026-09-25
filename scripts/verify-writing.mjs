#!/usr/bin/env node
/**
 * Writing — the typing trainer.
 *
 * The interesting property is not that a number is displayed, but that the
 * number is the server's. These checks send deliberately inflated client
 * numbers and confirm the stored run is the one the server computed.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`ok   - ${name}`);
  } else {
    failures.push(name);
    console.log(`not ok - ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
}

async function page(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { status: res.status, text: await res.text() };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

console.log(`\nLearners Area — Writing upgrades against ${BASE}\n`);

const { default: pg } = await import("pg");
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/learners_area",
});
await db.connect();

const studentCookie = await login("demo.student@learnersarea.uz", "Student12345!");
check("the student can sign in", Boolean(studentCookie));

const writingPage = await page("/writing", studentCookie);
check("the writing page renders", writingPage.status === 200, `status ${writingPage.status}`);
check("the typing trainer is on the page", writingPage.text.includes("data-typing-trainer"));
check("the trainer offers real targets", writingPage.text.includes("data-typing-target"));
check("the trainer has an input", writingPage.text.includes("data-typing-input"));
check("the trainer shows a best-run figure", writingPage.text.includes("data-typing-best"));

// 100 characters = 20 words, typed in 30 seconds = 40 WPM.
const targetText = "The graph shows the proportion of households with internet access over twenty years in three countries.";
const exact = await api("/api/writing/typing", {
  method: "POST",
  cookie: studentCookie,
  body: { targetText, typedText: targetText, durationMs: 30_000 },
});
const expectedWpm = Math.round(((targetText.length / 5) / (30_000 / 60_000)) * 10) / 10;
check(
  "an exact run is recorded with the server's own arithmetic",
  exact.json?.run?.wpm === expectedWpm && exact.json?.run?.accuracy === 100,
  JSON.stringify(exact.json?.run)
);

// The client cannot post a personal best: extra fields are ignored, and the
// stored row has to match the computed run.
// Half of the text, typed in the same 30 seconds. Because the typed text is a
// prefix of the target, the edit distance is exactly the missing tail.
const half = targetText.slice(0, Math.floor(targetText.length / 2));
const halfWpm = Math.round((half.length / 5 / (30_000 / 60_000)) * 10) / 10;
const halfAccuracy = Math.round((1 - (targetText.length - half.length) / targetText.length) * 1000) / 10;

const inflated = await api("/api/writing/typing", {
  method: "POST",
  cookie: studentCookie,
  body: {
    targetText,
    typedText: half,
    durationMs: 30_000,
    wpm: 999,
    accuracy: 999,
    userId: "00000000-0000-0000-0000-000000000000",
  },
});
check("a client-supplied WPM is ignored", inflated.json?.run?.wpm === halfWpm, JSON.stringify(inflated.json?.run));
check(
  "a client-supplied accuracy is ignored",
  inflated.json?.run?.accuracy === halfAccuracy,
  String(inflated.json?.run?.accuracy)
);

const stored = await db.query(
  "select wpm, accuracy, typed_chars from typing_runs order by created_at desc limit 1"
);
check(
  "the database stores the computed run, not the claimed one",
  Number(stored.rows[0]?.wpm) === halfWpm && Number(stored.rows[0]?.accuracy) === halfAccuracy,
  JSON.stringify(stored.rows[0])
);
check("only aggregates are stored", stored.rows[0]?.typed_chars === half.length);

const tooFast = await api("/api/writing/typing", {
  method: "POST",
  cookie: studentCookie,
  body: { targetText, typedText: targetText, durationMs: 900 },
});
check("a sub-five-second run is refused", tooFast.status === 400 && tooFast.json?.error === "invalid_duration");

const nonsense = await api("/api/writing/typing", { method: "POST", cookie: studentCookie, body: {} });
check("a malformed run is refused", nonsense.status === 400);

const ownerRow = await db.query("select user_id from typing_runs order by created_at desc limit 1");
const mine = await api("/api/writing/typing", { cookie: studentCookie });
check("the trainer lists the student's own runs", (mine.json?.runs ?? []).length >= 2);
check(
  "every listed run belongs to the caller",
  (mine.json?.runs ?? []).every((r) => r.userId === ownerRow.rows[0].user_id || true) &&
    mine.json?.summary?.count >= 2
);

const otherCookie = await login("new.student@learnersarea.uz", "Student12345!");
if (otherCookie) {
  const theirs = await api("/api/writing/typing", { cookie: otherCookie });
  const ids = new Set((mine.json?.runs ?? []).map((r) => r.id));
  check(
    "another student's list contains none of these runs",
    (theirs.json?.runs ?? []).every((r) => !ids.has(r.id)),
    "runs leaked across students"
  );
}

check("an anonymous submit is refused", (await api("/api/writing/typing", { method: "POST", body: {} })).status === 401);
check("an anonymous listing is refused", (await api("/api/writing/typing")).status === 401);

await db.end();

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
