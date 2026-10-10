#!/usr/bin/env node
/**
 * End-to-end verification of the publication workflow over real HTTP.
 *
 * Proves, in order:
 *   1. a draft passage is invisible in the student list AND cannot be started by
 *      id, so a withdrawn item cannot be reached through a bookmark;
 *   2. publishing makes it appear and startable;
 *   3. a schedule in the future stays invisible, and a schedule that has arrived
 *      becomes visible without anybody touching the row again;
 *   4. archiving removes it from students while the attempt the student already
 *      made stays fully readable — archiving is not a delete;
 *   5. a student and a teacher cannot publish anything; only ADMIN/OWNER can;
 *   6. an impossible transition and a schedule without a moment are refused;
 *   7. every accepted change is written to the audit log with its old and new
 *      state.
 *
 * Requires the dev server and DATABASE_URL (for the audit check).
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000");

/*
 * QA SAFETY (section 03.4). This probe mutates and, until now, never cleaned up.
 * It publishes a real reading passage through the authoring API. That passage, its
 * questions and the attempt made against it were never removed, so every run added a
 * learner-visible passage to the catalogue.
 *
 * Measured, not assumed: scripts/audit-probe-residue.mjs counts every row in every
 * table before and after a run. Cleanup is differential — snapshot the owned tables
 * before the first mutation, delete exactly the ids that appeared, then re-query to
 * prove they are gone. A pre-existing row is never touched.
 */
const SWEEP_DB_URL = process.env.DATABASE_URL;
const { assertMutableDatabase, createRowSweeper, installSweepHandlers } =
  await import("./lib/fixture-safety.mjs");
let finalSweep = async () => {};
if (SWEEP_DB_URL) {
  assertMutableDatabase(SWEEP_DB_URL, { probe: "verify-publication" });
  const sweepDb = new (await import("pg")).default.Client({ connectionString: SWEEP_DB_URL });
  await sweepDb.connect();
  const sweeper = createRowSweeper({
    client: sweepDb,
    probe: "verify-publication",
    tables: ["reading_answers", "reading_attempts", "reading_questions", "reading_passages", "activity_events", "audit_log"],
  });
  finalSweep = installSweepHandlers(sweeper, {
    probe: "verify-publication",
    onDone: () => sweepDb.end().catch(() => {}),
  });
  await sweeper.capture();
} else {
  // Honest about the gap rather than silently skipping it: without a connection this
  // run WILL leave rows behind, and the operator should know before it starts.
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
  const setCookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, text, json, setCookie };
}

async function login(email, password) {
  const res = await api("/api/auth/login", { method: "POST", body: { email, password } });
  return { cookie: res.setCookie, status: res.status };
}

async function session(email, password) {
  const res = await login(email, password);
  return res.cookie;
}

console.log(`\nLearners Area — publication states against ${BASE}\n`);

const owner = await session("owner@learnersarea.uz", "Owner12345!");
const student = await session("demo.student@learnersarea.uz", "Student12345!");
const teacher = await session("teacher@learnersarea.uz", "Teacher12345!");
check("the owner, a student and a teacher can sign in", Boolean(owner && student && teacher));

// ---------------------------------------------------------------------------
// Fixture: a passage created through the admin API, starting as published
// ---------------------------------------------------------------------------
const stamp = Date.now().toString(36);
const title = `Publication QA ${stamp}`;
const created = await api("/api/admin/reading/passages", {
  method: "POST",
  cookie: owner,
  body: {
    title,
    bodyText:
      "The publication check needs a real passage with real sentences so that a student can open it, answer one question and keep the result afterwards.",
    difficultyLevel: "B2",
    suggestedMinutes: 10,
  },
});
const passageId = created.json?.id;
check("an administrator can create a passage", Boolean(passageId), `status ${created.status}`);

if (!passageId) {
  console.log("\n# pass 0 / fail 1 — the fixture could not be created; nothing else can be checked");
  process.exit(1);
}

const question = await api(`/api/admin/reading/passages/${passageId}/questions`, {
  method: "POST",
  cookie: owner,
  body: {
    type: "true_false_not_given",
    questionText: "The passage exists so that its visibility can be checked.",
    correctAnswer: "true",
    evidenceQuote: "The publication check needs a real passage",
    explanation: "The first sentence says the passage exists for this check.",
  },
});
check("a question can be authored for it", question.status === 200, `status ${question.status}`);

/**
 * Is the passage live for the student right now?
 *
 * Two honest ways to answer, because the library is a paginated list ordered
 * oldest-first while this fixture is the newest passage in the database: the
 * passage is on the first page of the library, OR the student can actually start
 * it. Both go through the same `liveWhere` rule, so this stays a single rule with
 * one observable answer — it is the fixture's position on page one that is not
 * meaningful, not the publication state.
 */
const listedForStudent = async () => (await api("/app/reading", { cookie: student })).text.includes(title);
const startableForStudent = async () =>
  (await api("/api/reading/attempts", { method: "POST", cookie: student, body: { passageId } })).status === 200;
const listForStudent = async () => (await listedForStudent()) || (await startableForStudent());
const studentStart = async () =>
  api("/api/reading/attempts", { method: "POST", cookie: student, body: { passageId } });

// ---------------------------------------------------------------------------
// 1. Draft
// ---------------------------------------------------------------------------
const toDraft = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "draft" },
});
check("an owner can move a passage to draft", toDraft.status === 200 && toDraft.json?.state === "draft", `status ${toDraft.status}`);
const studentListPage = await api("/app/reading", { cookie: student });
check("the student reading page renders", studentListPage.status === 200, `status ${studentListPage.status}`);
check("a draft is not listed to students", (await listForStudent()) === false);
const draftStart = await studentStart();
check("a draft cannot be started by id", draftStart.status === 404, `status ${draftStart.status}`);

// ---------------------------------------------------------------------------
// 2. Scheduled in the future, then a schedule that has already arrived
// ---------------------------------------------------------------------------
const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const scheduled = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "scheduled", publishAt: future },
});
check("a passage can be scheduled", scheduled.status === 200 && scheduled.json?.state === "scheduled", `status ${scheduled.status}`);
check("a future schedule is still invisible", (await listForStudent()) === false);
const scheduledStart = await studentStart();
check("a future schedule cannot be started", scheduledStart.status === 404, `status ${scheduledStart.status}`);

const past = new Date(Date.now() - 60 * 1000).toISOString();
const rescheduled = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "published" },
});
check("a scheduled item can be published", rescheduled.status === 200 && rescheduled.json?.state === "published");

const backToSchedule = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "scheduled", publishAt: past },
});
check("a schedule whose moment has passed is accepted", backToSchedule.status === 200);
check("a schedule whose moment has passed is live without further action", (await listForStudent()) === true);

// ---------------------------------------------------------------------------
// 3. A real student attempt against live content
// ---------------------------------------------------------------------------
const startAttempt = await studentStart();
const attemptId = startAttempt.json?.id;
check("live content can be started", Boolean(attemptId), `status ${startAttempt.status}`);

if (attemptId) {
  // The question ids are not needed to prove the point: an empty answer set is a
  // legitimate (wrong) submission and still produces a finished attempt.
  const submit = await api(`/api/reading/attempts/${attemptId}/submit`, {
    method: "POST",
    cookie: student,
    body: { answers: [] },
  });
  check("the attempt can be submitted", submit.status === 200, `status ${submit.status}`);
}

// ---------------------------------------------------------------------------
// 4. Archive: invisible to students, but history survives
// ---------------------------------------------------------------------------
const archived = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "archived" },
});
check("an owner can archive", archived.status === 200 && archived.json?.state === "archived", `status ${archived.status}`);
check("an archived passage is not listed to students", (await listForStudent()) === false);
const archivedStart = await studentStart();
check("an archived passage cannot be started", archivedStart.status === 404, `status ${archivedStart.status}`);

if (attemptId) {
  const history = await api(`/app/reading/attempts/${attemptId}`, { cookie: student });
  check(
    "the student's own attempt is still readable after archiving",
    history.status === 200,
    `status ${history.status}`
  );
  check(
    "the archived passage is still named in that attempt's analysis",
    history.text.includes(title) || history.text.includes("publication check needs a real passage"),
    "the history lost its passage"
  );

  // Hiding content from new students must not hide it from the student who
  // already sat it: the attempt stays on their own history list, so a student
  // can always re-read work the centre later took down.
  const historyList = await api("/app/reading/history", { cookie: student });
  check(
    "the attempt is still on the student's history list after archiving",
    historyList.status === 200 && historyList.text.includes(`/app/reading/attempts/${attemptId}`),
    `status ${historyList.status}`
  );
}

// ---------------------------------------------------------------------------
// 5. Who may publish
// ---------------------------------------------------------------------------
const studentTry = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: student,
  body: { state: "published" },
});
check("a student cannot publish", studentTry.status === 403 || studentTry.status === 401, `status ${studentTry.status}`);

const teacherTry = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: teacher,
  body: { state: "published" },
});
check("a teacher cannot publish either", teacherTry.status === 403 || teacherTry.status === 401, `status ${teacherTry.status}`);

const anonymousTry = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  body: { state: "published" },
});
check("an anonymous caller cannot publish", anonymousTry.status === 403 || anonymousTry.status === 401, `status ${anonymousTry.status}`);

const unknownType = await api(`/api/admin/content/nonsense/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "published" },
});
check("an unknown content type is a 404", unknownType.status === 404, `status ${unknownType.status}`);

const badId = await api(`/api/admin/content/reading/not-a-uuid/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "published" },
});
check("a malformed id is a 404, not a crash", badId.status === 404, `status ${badId.status}`);

// ---------------------------------------------------------------------------
// 6. Refused transitions and malformed schedules
// ---------------------------------------------------------------------------
const archivedToScheduled = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "scheduled", publishAt: future },
});
check(
  "an archived item cannot be put straight on a schedule",
  archivedToScheduled.status === 409,
  `status ${archivedToScheduled.status}`
);

const missingMoment = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "scheduled" },
});
check("a schedule without a moment is refused", missingMoment.status === 409 || missingMoment.status === 400, `status ${missingMoment.status}`);

const restore = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "draft" },
});
check("an archived item can be restored to draft", restore.status === 200);

const leftoverMoment = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "published", publishAt: future },
});
check("a moment attached to a published state is refused", leftoverMoment.status === 400, `status ${leftoverMoment.status}`);

const sameState = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "draft" },
});
check(
  "moving to the state it already has is a no-op, not an error",
  sameState.status === 200 && sameState.json?.changed === false,
  `status ${sameState.status} changed ${sameState.json?.changed}`
);

const unknownState = await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "invisible" },
});
check("an unknown state is refused", unknownState.status === 400, `status ${unknownState.status}`);

// ---------------------------------------------------------------------------
// 7. The audit trail explains what happened
// ---------------------------------------------------------------------------
if (process.env.DATABASE_URL || process.env.CHECK_AUDIT) {
  const { readFileSync } = await import("node:fs");
  const pg = (await import("pg")).default;
  const url =
    process.env.DATABASE_URL ??
    readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)?.[1];
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const rows = await client.query(
    `select action, target_type, metadata from audit_log
     where target_id = $1 and target_type = 'reading_passage'
     order by created_at`,
    [passageId]
  );
  await client.end();
  check("every state change was audited", rows.rows.length >= 4, `${rows.rows.length} audit rows`);
  check(
    "the audit rows carry the previous and the new state",
    rows.rows.every((row) => row.metadata && typeof row.metadata.from === "string" && typeof row.metadata.to === "string"),
    JSON.stringify(rows.rows[0]?.metadata ?? {})
  );
} else {
  check("DATABASE_URL is available for the audit check", false, "set DATABASE_URL to check the audit trail");
}

// ---------------------------------------------------------------------------
// Cleanup: leave the fixture archived rather than deleted, as the product does.
// ---------------------------------------------------------------------------
await api(`/api/admin/content/reading/${passageId}/publication`, {
  method: "POST",
  cookie: owner,
  body: { state: "archived" },
});

console.log(`\n# pass ${passed} / fail ${failed}`);
if (failed > 0) {
  console.log("# failures:");
  for (const failure of failures) console.log(`  - ${failure}`);
}

// process.exit() skips beforeExit, so the sweep is awaited here on the normal path.
await finalSweep("end of run");
process.exit(failed > 0 || process.exitCode === 1 ? 1 : 0);
