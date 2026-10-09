#!/usr/bin/env node
/**
 * Writing — the typing trainer.
 *
 * The interesting property is not that a number is displayed, but that the
 * number is the server's. These checks send deliberately inflated client
 * numbers and confirm the stored run is the one the server computed.
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

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
  connectionString: (process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:5433/learners_area"),
});
await db.connect();

const studentCookie = await login("demo.student@learnersarea.uz", "Student12345!");
check("the student can sign in", Boolean(studentCookie));

// Writing is tabbed (WRITING_TABS, default "lessons"); the typing trainer lives on
// ?tab=typing. Requesting the bare page tested the default tab, not the trainer.
const writingPage = await page("/app/writing?tab=typing", studentCookie);
check("the writing page renders", writingPage.status === 200, `status ${writingPage.status}`);
check("the typing trainer is on the page", writingPage.text.includes("data-typing-trainer"));
// The trainer renders the text to type as staged words (data-typing-stage) and offers
// duration presets; there has never been a "data-typing-target" attribute.
check("the trainer offers real targets", writingPage.text.includes("data-typing-stage"));
check("the trainer has an input", writingPage.text.includes("data-typing-input"));
// The best-run figure is part of the summary payload, not a data attribute; assert the
// preset controls that actually gate a run instead.
check("the trainer offers duration presets", writingPage.text.includes("data-typing-preset"));

// The old probe POSTed a client-supplied `targetText` plus a client-supplied `wpm`
// and asserted the server "ignored" them. That API no longer exists: the route schema
// is z.object({modelTextId, typedText, durationMs, token}).strict(), so a client can no
// longer name its own target text OR smuggle metrics at all. Production is strictly
// SAFER than the old probe assumed; the probe, not the product, was stale.
// We now exercise the real prepare -> record contract and assert the true invariants.

const prepared = await api("/api/writing/typing/prepare", {
  method: "POST",
  cookie: studentCookie,
  body: { preset: 0 },
});
check("the trainer prepares a server-chosen model text", prepared.status === 200, JSON.stringify(prepared.json).slice(0, 160));
const modelTextId = prepared.json?.text?.id;
const words = prepared.json?.text?.words ?? [];
const runToken = prepared.json?.token;
check("the prepared text is server-issued, with a token the client cannot mint", Boolean(modelTextId && runToken && words.length > 0));

// INVARIANT 1 — a client cannot supply its own target text or its own metrics.
// .strict() must reject the extra keys outright.
for (const forged of [
  { modelTextId, typedText: words.join(" "), durationMs: 30_000, token: runToken, wpm: 999 },
  { modelTextId, typedText: words.join(" "), durationMs: 30_000, token: runToken, accuracy: 100 },
  { targetText: "I choose my own text", typedText: "I choose my own text", durationMs: 30_000, token: runToken },
]) {
  const res = await api("/api/writing/typing", { method: "POST", cookie: studentCookie, body: forged });
  check(
    `a client-supplied ${Object.keys(forged).find((k) => ["wpm", "accuracy", "targetText"].includes(k))} is rejected outright`,
    res.status === 400,
    `status ${res.status}`
  );
}

// INVARIANT 2 — a legitimate run goes prepare -> start -> finish, and EVERY metric is
// computed server-side. In this flow the client cannot even supply a duration: the
// server uses the preset it issued, so inflating a run is structurally impossible.
const prep = await api("/api/writing/typing/prepare", { method: "POST", cookie: studentCookie, body: { preset: 60 } });
const prepWords = prep.json?.text?.words ?? [];
const started = await api("/api/writing/typing/start", { method: "POST", cookie: studentCookie, body: { token: prep.json?.token } });
check("a prepared run can be started", started.status === 200 && Boolean(started.json?.runToken), `status ${started.status}`);
const liveToken = started.json?.runToken;

// a finish that tries to dictate its own metrics must be rejected by .strict()
const forgedFinish = await api("/api/writing/typing/finish", {
  method: "POST",
  cookie: studentCookie,
  body: { runToken: liveToken, typedWords: prepWords, samples: [], wpm: 999, durationMs: 1 },
});
check("a finish cannot dictate its own WPM or duration", forgedFinish.status === 400, `status ${forgedFinish.status}`);

// Wait long enough that submitting the WHOLE passage is physically plausible. The
// server now refuses a full-text submission that could not have been typed in the time
// it observed, so a 6 s sleep followed by 1000+ characters is indistinguishable from the
// forgery tested in INVARIANT 5 — and should be refused. This keeps the honest run a
// genuinely honest one rather than relaxing the rule to suit the probe.
const honestChars = prepWords.join(" ").length;
const MAX_HUMAN_WPM = 250; // mirrors the server-side forgery ceiling
const honestWaitMs = Math.ceil((honestChars / 5 / MAX_HUMAN_WPM) * 60_000) + 3_000;
await new Promise((r) => setTimeout(r, honestWaitMs));
const honest = await api("/api/writing/typing/finish", {
  method: "POST",
  cookie: studentCookie,
  body: { runToken: liveToken, typedWords: prepWords, samples: [] },
});
check("an honest run is accepted", honest.status === 200, JSON.stringify(honest.json).slice(0, 200));
const serverWpm = Number(honest.json?.run?.wpm);
const targetChars = Number(honest.json?.run?.targetChars);
const durationMs = Number(honest.json?.run?.durationMs);
const expectedWpm = Math.round(((targetChars / 5) / (durationMs / 60_000)) * 10) / 10;
check(
  "the server computes WPM itself from the canonical text",
  Number.isFinite(serverWpm) && Math.abs(serverWpm - expectedWpm) <= 1.5 && serverWpm !== 999,
  `server=${serverWpm} expected≈${expectedWpm}`
);
check(
  "the server, not the client, fixes the run duration to the issued preset",
  durationMs === 60_000,
  `durationMs=${durationMs}`
);
check(
  "a perfect transcription scores full accuracy",
  Math.round(Number(honest.json?.run?.accuracy)) === 100,
  `accuracy=${honest.json?.run?.accuracy}`
);

// INVARIANT 3 — the stored row matches what the server computed, not any client claim.
//
// Query the EXACT run the API returned. "order by created_at desc limit 1" could be
// satisfied by an unrelated row written by another fixture, another student or a
// parallel probe, so it proved nothing about this run and could even pass while this
// run was stored wrongly.
const honestRunId = honest.json?.run?.runId;
check("the finish response names the run it created", Boolean(honestRunId), `runId=${honestRunId}`);
const studentRow = await db.query("select id from users where email = 'demo.student@learnersarea.uz'");
const expectedUserId = studentRow.rows[0]?.id;
const stored = await db.query(
  `select id, user_id, wpm, accuracy, duration_ms, run_token_id, target_chars, typed_chars
     from typing_runs where id = $1`,
  [honestRunId]
);
const run = stored.rows[0];
check("the run the API returned exists in the database", Boolean(run), `id=${honestRunId}`);
check(
  "the stored run belongs to the student who typed it",
  run?.user_id === expectedUserId,
  `stored=${run?.user_id} expected=${expectedUserId}`
);
check(
  "the database stores the server's computed wpm",
  Math.abs(Number(run?.wpm) - serverWpm) < 0.05 && Number(run?.wpm) !== 999,
  JSON.stringify(run)
);
check(
  "the database stores the server's computed accuracy",
  Math.abs(Number(run?.accuracy) - Number(honest.json?.run?.accuracy)) < 0.05,
  `stored=${run?.accuracy} api=${honest.json?.run?.accuracy}`
);
check(
  "the database stores the server-fixed duration, not a client claim",
  Number(run?.duration_ms) === 60_000,
  `duration_ms=${run?.duration_ms}`
);
// The run-token identity is what makes replay protection a database guarantee rather
// than a bounded lookup, so its presence is part of the contract on this schema.
check(
  "the run carries its authoritative run-token identity",
  typeof run?.run_token_id === "string" && run.run_token_id.length > 0,
  `run_token_id=${run?.run_token_id}`
);

// INVARIANT 4 — replaying a finished run must not mint a SECOND run. The server is
// idempotent here: it returns the already-recorded run rather than erroring, which is
// correct and race-safe. The invariant is "no duplicate row", not "the replay errors".
const runsBeforeReplay = await db.query("select count(*)::int as n from typing_runs");
const replay = await api("/api/writing/typing/finish", {
  method: "POST",
  cookie: studentCookie,
  body: { runToken: liveToken, typedWords: prepWords, samples: [] },
});
const runsAfterReplay = await db.query("select count(*)::int as n from typing_runs");
check(
  "replaying a run token records no second run (idempotent)",
  runsAfterReplay.rows[0].n === runsBeforeReplay.rows[0].n &&
    (replay.status !== 200 || replay.json?.run?.runId === honest.json?.run?.runId),
  `rows ${runsBeforeReplay.rows[0].n}->${runsAfterReplay.rows[0].n}, status ${replay.status}`
);

// INVARIANT 5 — an instant forged submit is refused, COMPLETE OR NOT.
//
// /prepare hands the client the canonical words, so submitting all of them is not
// evidence of typing: a script can prepare, start and post the whole passage back in one
// tick. Scoring over the full preset caps the WPM such a run can claim but still lets it
// fabricate a completed performance, so completeness is no longer an exemption. The
// server requires the submission to have been physically typeable in the time it
// observed, which leaves the serverless latency tolerance for genuine runs intact.
for (const preset of [60, 0]) {
  const prepX = await api("/api/writing/typing/prepare", { method: "POST", cookie: studentCookie, body: { preset } });
  const startX = await api("/api/writing/typing/start", { method: "POST", cookie: studentCookie, body: { token: prepX.json?.token } });
  const instant = await api("/api/writing/typing/finish", {
    method: "POST",
    cookie: studentCookie,
    body: { runToken: startX.json?.runToken, typedWords: (prepX.json?.text?.words ?? []).slice(0, 8), samples: [] },
  });
  check(
    `an instant partial run is refused (preset ${preset || "untimed"})`,
    instant.status === 409 && instant.json?.error === "too_early",
    `status ${instant.status} ${JSON.stringify(instant.json)}`
  );

  // The forgery the old contract allowed: replay the canonical words immediately.
  const prepFull = await api("/api/writing/typing/prepare", { method: "POST", cookie: studentCookie, body: { preset } });
  const startFull = await api("/api/writing/typing/start", { method: "POST", cookie: studentCookie, body: { token: prepFull.json?.token } });
  const before = await db.query("select count(*)::int as n from typing_runs");
  const instantFull = await api("/api/writing/typing/finish", {
    method: "POST",
    cookie: studentCookie,
    body: { runToken: startFull.json?.runToken, typedWords: prepFull.json?.text?.words ?? [], samples: [] },
  });
  const after = await db.query("select count(*)::int as n from typing_runs");
  check(
    `an instant FULL-TEXT run is refused (preset ${preset || "untimed"})`,
    instantFull.status === 409 && instantFull.json?.error === "too_early",
    `status ${instantFull.status} ${JSON.stringify(instantFull.json)}`
  );
  check(
    `a refused instant full-text run persists nothing (preset ${preset || "untimed"})`,
    after.rows[0].n === before.rows[0].n,
    `rows ${before.rows[0].n}->${after.rows[0].n}`
  );
}

const nonsense = await api("/api/writing/typing", { method: "POST", cookie: studentCookie, body: {} });
check("a malformed run is refused", nonsense.status === 400);

// INVARIANT 6 — runs are private to the caller.
const mine = await api("/api/writing/typing", { cookie: studentCookie });
check("the trainer lists the student's own runs", (mine.json?.runs ?? []).length >= 1, `count=${(mine.json?.runs ?? []).length}`);
const otherCookie = await login("new.student@learnersarea.uz", "Student12345!");
const theirs = await api("/api/writing/typing", { cookie: otherCookie });
const myIds = new Set((mine.json?.runs ?? []).map((r) => r.id));
check(
  "no run leaks across students",
  (theirs.json?.runs ?? []).every((r) => !myIds.has(r.id)),
  "runs leaked across students"
);

check("an anonymous submit is refused", (await api("/api/writing/typing", { method: "POST", body: {} })).status === 401);
check("an anonymous listing is refused", (await api("/api/writing/typing")).status === 401);

await db.end();

console.log(`\n# pass ${pass} / fail ${failures.length}`);
if (failures.length) {
  console.log("# failures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
