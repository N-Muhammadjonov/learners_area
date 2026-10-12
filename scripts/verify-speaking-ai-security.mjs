/*
 * §05 — SECURITY ACCEPTANCE FOR THE SPEAKING APIs, OVER REAL HTTP.
 *
 * `GET /api/speaking/ai/script` is new and server-authoritative: it draws an exam from the whole
 * published corpus. That makes it a disclosure surface, not just a performance one — a draw that leaked
 * a draft, or a prompt the AI channel is not eligible for, would publish content no one decided to
 * publish. So every case here is judged on RESPONSE CONTENT, never on a status code alone.
 *
 * This also makes durable some evidence that previously existed only as a throwaway probe: the practice
 * endpoints' refusal of a forged cursor and an invalid channel. Searching the repository found
 * `invalid_cursor` in the route sources and in NO test file, so the earlier "9/9 HTTP" result was not
 * reproducible from anything committed. It is now.
 *
 * Anti-vacuity discipline: every "must not appear" assertion is paired with a positive control proving
 * the detector can see content that SHOULD appear. Without that, a marker never appearing is
 * indistinguishable from the probe never having looked.
 *
 * Usage: DATABASE_URL=... AUTH_SECRET=... BASE_URL=http://127.0.0.1:3000 node scripts/verify-speaking-ai-security.mjs
 */
import pg from "pg";

const { createActor, createMatrix, judgeDenial, loginActor } = await import("./lib/security-matrix.mjs");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || !/localhost|127\.0\.0\.1/.test(DATABASE_URL)) {
  console.error("refusing to run: DATABASE_URL must point at a LOCAL disposable database");
  process.exit(2);
}
const IP = "203.0.113.77";
const MARKER = "QA-SEC-";
const DRAFT = `${MARKER}DRAFT — an unpublished question that must never be asked`;
const WRONG_CHANNEL = `${MARKER}CHANNEL — published for live partner only, never for the AI examiner`;
const AI_ELIGIBLE = `${MARKER}ELIGIBLE — published for the AI examiner and must be reachable`;
/** How many draws to run before concluding a marker cannot appear. */
const TRIALS = 40;

const client = new pg.Client({ connectionString: DATABASE_URL });
client.on("error", () => {});
await client.connect();
const matrix = createMatrix("Speaking AI + practice API security (§05)");
const sink = [];
const failures = [];
const check = (id, condition, detail) => {
  if (!condition) failures.push(`${id}: ${detail}`);
  return condition;
};

const scriptTexts = (json) => (Array.isArray(json?.script) ? json.script.map((p) => p?.promptText ?? "") : []);

try {
  // ── fixtures: one draft, one wrong-channel, one genuinely eligible ─────────────────────────────
  await client.query("delete from speaking_prompts where prompt_text like $1", [`${MARKER}%`]);
  await client.query(
    `insert into speaking_prompts (part, category, prompt_text, topic, available_in, publication_state) values
      ('part1'::speaking_part,'part1'::speaking_category,$1,'${MARKER}topic','["ai","practice_alone"]'::jsonb,'draft'),
      ('part1'::speaking_part,'part1'::speaking_category,$2,'${MARKER}topic','["live_partner"]'::jsonb,'published'),
      ('part1'::speaking_part,'part1'::speaking_category,$3,'${MARKER}topic','["ai","practice_alone"]'::jsonb,'published')`,
    [DRAFT, WRONG_CHANNEL, AI_ELIGIBLE],
  );
  const fixture = await client.query(
    "select id, prompt_text, publication_state::text state, available_in::text channels from speaking_prompts where prompt_text like $1",
    [`${MARKER}%`],
  );
  check("fixture", fixture.rows.length === 3, `expected 3 fixture rows, got ${fixture.rows.length}`);
  const draftId = fixture.rows.find((r) => r.state === "draft")?.id;
  check("fixture", Boolean(draftId), "the draft fixture must exist, or its exclusion proves nothing");

  // ── actors ────────────────────────────────────────────────────────────────────────────────────
  const STUDENT = await loginActor("STUDENT_A", BASE, "demo.student@learnersarea.uz", "Student12345!", { ip: IP, client, sink });
  const PENDING = await loginActor("PENDING", BASE, "pending.student@learnersarea.uz", "Student12345!", { ip: IP, client, sink });
  const ANON = createActor("ANONYMOUS", "", BASE, { ip: IP, sink });
  const FORGED = createActor("FORGED_COOKIE", "la_session=forged.notatoken.atall", BASE, { ip: IP, sink });
  console.log(`# actors: STUDENT_A sub=${STUDENT.identity.sub} role=${STUDENT.identity.role}; PENDING sub=${PENDING.identity.sub}`);

  // ══ S1 anonymous ══════════════════════════════════════════════════════════════════════════════
  {
    const res = await ANON.get("/api/speaking/ai/script?mode=full");
    const judged = judgeDenial(res, [AI_ELIGIBLE, DRAFT, WRONG_CHANNEL, "promptText"]);
    matrix.row({
      section: "S05", id: "S1", route: "GET /api/speaking/ai/script", action: "anonymous caller asks for an exam script",
      authorized: "n/a", unauthorized: "ANONYMOUS, no cookie", positiveControl: "S3 (active student gets 200 + a real script)",
      negativeControl: "no session cookie at all",
      actual: `HTTP ${res.status}; privacy=${judged.leaked ? "LEAK " + judged.leakedMarkers : "OK"}; verdict=${judged.verdict}`,
      verdict: res.status === 401 && !judged.leaked ? "PASS" : "FAIL",
    });
    check("S1", res.status === 401, `anonymous must get 401, got ${res.status}`);
    check("S1", !judged.leaked, `anonymous response leaked ${judged.leakedMarkers}`);
  }

  // ══ S2 pending / inactive account holding a genuinely valid cookie ════════════════════════════
  {
    const res = await PENDING.actor.get("/api/speaking/ai/script?mode=full");
    const judged = judgeDenial(res, [AI_ELIGIBLE, DRAFT, WRONG_CHANNEL, "promptText"]);
    matrix.row({
      section: "S05", id: "S2", route: "GET /api/speaking/ai/script", action: "a PENDING account with a valid signed cookie",
      authorized: "n/a", unauthorized: "PENDING (account_status=pending), cookie verified by sub claim",
      positiveControl: "S3", negativeControl: "the same cookie authenticated at login (HTTP 200)",
      actual: `HTTP ${res.status}; privacy=${judged.leaked ? "LEAK " + judged.leakedMarkers : "OK"}; verdict=${judged.verdict}`,
      verdict: judged.statusCorrect && !judged.leaked ? "PASS" : "FAIL",
    });
    check("S2", judged.statusCorrect, `a pending account must be denied, got HTTP ${res.status}`);
    check("S2", !judged.leaked, `pending account response leaked ${judged.leakedMarkers}`);
  }

  // ══ S2b forged cookie ═════════════════════════════════════════════════════════════════════════
  {
    const res = await FORGED.get("/api/speaking/ai/script?mode=full");
    const judged = judgeDenial(res, [AI_ELIGIBLE, "promptText"]);
    matrix.row({
      section: "S05", id: "S2b", route: "GET /api/speaking/ai/script", action: "a forged session cookie",
      authorized: "n/a", unauthorized: "FORGED_COOKIE (invalid signature)", positiveControl: "S3",
      negativeControl: "cookie present but unsigned by AUTH_SECRET",
      actual: `HTTP ${res.status}; verdict=${judged.verdict}`,
      verdict: res.status === 401 && !judged.leaked ? "PASS" : "FAIL",
    });
    check("S2b", res.status === 401 && !judged.leaked, `forged cookie must be refused, got ${res.status}`);
  }

  // ══ S3 active authorized user is permitted, and the script is real ════════════════════════════
  {
    const res = await STUDENT.actor.get("/api/speaking/ai/script?mode=full");
    const script = res.json?.script;
    const ok = res.status === 200 && Array.isArray(script) && script.length > 0 &&
      script.every((p) => typeof p?.id === "string" && typeof p?.promptText === "string" &&
        typeof p?.prepSeconds === "number" && typeof p?.answerSeconds === "number");
    matrix.row({
      section: "S05", id: "S3", route: "GET /api/speaking/ai/script", action: "an active student draws a full exam",
      authorized: "STUDENT_A (active)", unauthorized: "n/a",
      positiveControl: "script is non-empty and every row carries the §5.1 recorder timings",
      negativeControl: "S1/S2 denied on the same route",
      actual: `HTTP ${res.status}; mode=${res.json?.mode}; script rows=${Array.isArray(script) ? script.length : "n/a"}; contract=${ok ? "complete" : "INCOMPLETE"}`,
      verdict: ok ? "PASS" : "FAIL",
    });
    check("S3", ok, `active student must receive a complete script, got HTTP ${res.status} rows=${Array.isArray(script) ? script.length : "none"}`);
    check("S3", res.json?.mode === "full", `the response must echo the mode, got ${res.json?.mode}`);
    check("S3", /no-store/.test(res.headers.get("cache-control") ?? ""), "an exam script must never be cached");
  }

  // ══ S4 invalid mode ═══════════════════════════════════════════════════════════════════════════
  {
    const cases = ["part9", "", "FULL", "part1;drop", "%3Cscript%3E", "part1,part2"];
    const results = [];
    for (const mode of cases) {
      const res = await STUDENT.actor.get(`/api/speaking/ai/script?mode=${mode}`);
      results.push(`${mode === "" ? "(empty)" : mode}→${res.status}${res.json?.error ? `/${res.json.error}` : ""}`);
      check("S4", res.status === 400, `mode=${mode || "(empty)"} must be 400, got ${res.status}`);
      check("S4", !Array.isArray(res.json?.script) || res.json.script.length === 0, `mode=${mode} must not return a script`);
    }
    // A missing mode defaults to full rather than erroring — that is the documented contract.
    const defaulted = await STUDENT.actor.get("/api/speaking/ai/script");
    matrix.row({
      section: "S05", id: "S4", route: "GET /api/speaking/ai/script?mode=", action: "invalid / injected mode values",
      authorized: "STUDENT_A", unauthorized: "n/a",
      positiveControl: `omitting mode entirely defaults to a full script (HTTP ${defaulted.status})`,
      negativeControl: "each invalid value refused with 400 and no script body",
      actual: results.join(" "),
      verdict: failures.some((f) => f.startsWith("S4")) ? "FAIL" : "PASS",
    });
    check("S4", defaulted.status === 200, `a missing mode should default to full, got ${defaulted.status}`);
  }

  // ══ S5/S6 draft and wrong-channel content must never be disclosed ═════════════════════════════
  {
    let sawEligible = 0, sawDraft = 0, sawWrongChannel = 0;
    const modes = ["full", "part1", "part2", "part3"];
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const res = await STUDENT.actor.get(`/api/speaking/ai/script?mode=${modes[trial % modes.length]}`);
      const texts = scriptTexts(res.json);
      if (texts.some((text) => text.includes(MARKER + "ELIGIBLE"))) sawEligible += 1;
      if (texts.some((text) => text.includes("DRAFT — an unpublished"))) sawDraft += 1;
      if (texts.some((text) => text.includes("CHANNEL — published for live partner"))) sawWrongChannel += 1;
    }
    /*
     * The positive control is the whole point: the eligible marker MUST be seen, which proves the probe
     * is really reading script contents and that the fixture is reachable at all. Only then does "the
     * draft was never seen" mean something.
     */
    matrix.row({
      section: "S05", id: "S5", route: "GET /api/speaking/ai/script", action: "a DRAFT prompt must never be drawn",
      authorized: "STUDENT_A", unauthorized: "n/a",
      positiveControl: `the AI-eligible marker appeared in ${sawEligible}/${TRIALS} draws, so the probe can see fixture content`,
      negativeControl: `the draft marker appeared in ${sawDraft}/${TRIALS} draws`,
      actual: `eligible seen ${sawEligible}, draft seen ${sawDraft} over ${TRIALS} draws across all four modes`,
      verdict: sawEligible > 0 && sawDraft === 0 ? "PASS" : "FAIL",
    });
    check("S5", sawEligible > 0, `POSITIVE CONTROL FAILED: the eligible fixture never appeared in ${TRIALS} draws, so the draft check is vacuous`);
    check("S5", sawDraft === 0, `a DRAFT prompt was disclosed in ${sawDraft} of ${TRIALS} draws`);

    matrix.row({
      section: "S05", id: "S6", route: "GET /api/speaking/ai/script", action: "a prompt ineligible for the ai channel must never be drawn",
      authorized: "STUDENT_A", unauthorized: "n/a",
      positiveControl: `the AI-eligible marker appeared in ${sawEligible}/${TRIALS} draws`,
      negativeControl: `the live-partner-only marker appeared in ${sawWrongChannel}/${TRIALS} draws`,
      actual: `wrong-channel seen ${sawWrongChannel} over ${TRIALS} draws; fixture available_in=["live_partner"]`,
      verdict: sawEligible > 0 && sawWrongChannel === 0 ? "PASS" : "FAIL",
    });
    check("S6", sawWrongChannel === 0, `a prompt published only for live_partner was disclosed to the AI examiner in ${sawWrongChannel} draws`);
  }

  // ══ S7 a known draft UUID must not expose protected content ═══════════════════════════════════
  {
    const res = await STUDENT.actor.get(`/api/speaking/prompts/${draftId}/support?channel=practice_alone`);
    const judged = judgeDenial(res, ["vocabularyHtml", "modelAnswerHtml", DRAFT]);
    matrix.row({
      section: "S05", id: "S7", route: "GET /api/speaking/prompts/:id/support", action: "a KNOWN draft UUID asks for study support",
      authorized: "n/a", unauthorized: "STUDENT_A, holding the real draft id from the database",
      positiveControl: "S8 (the same route returns support for a PUBLISHED prompt)",
      negativeControl: "the id is a valid, existing UUID — this is not a 404 for a malformed id",
      actual: `HTTP ${res.status}; privacy=${judged.leaked ? "LEAK " + judged.leakedMarkers : "OK"}`,
      verdict: res.status === 404 && !judged.leaked ? "PASS" : "FAIL",
    });
    check("S7", res.status === 404, `study support for a draft must be 404, got ${res.status}`);
    check("S7", !judged.leaked, `draft support leaked ${judged.leakedMarkers}`);
  }

  // ══ S8 positive control: published support IS returned, and anonymous is refused ══════════════
  {
    const published = await client.query(
      "select id from speaking_prompts where publication_state='published' and available_in @> '[\"practice_alone\"]'::jsonb limit 1",
    );
    const id = published.rows[0]?.id;
    check("S8", Boolean(id), "a published practice prompt must exist for the positive control");
    const ok = await STUDENT.actor.get(`/api/speaking/prompts/${id}/support?channel=practice_alone`);
    const anon = await ANON.get(`/api/speaking/prompts/${id}/support?channel=practice_alone`);
    const anonJudged = judgeDenial(anon, ["vocabularyHtml", "modelAnswerHtml"]);
    matrix.row({
      section: "S05", id: "S8", route: "GET /api/speaking/prompts/:id/support", action: "published support is returned to a student, refused to anonymous",
      authorized: `STUDENT_A on a published id (HTTP ${ok.status})`, unauthorized: `ANONYMOUS on the same id (HTTP ${anon.status})`,
      positiveControl: "the authorized call really returns a support payload, so S7's 404 is a decision not an outage",
      negativeControl: "anonymous refused with no payload",
      actual: `authorized ${ok.status} hasSupport=${Boolean(ok.json && "support" in ok.json)}; anonymous ${anon.status} privacy=${anonJudged.leaked ? "LEAK" : "OK"}`,
      verdict: ok.status === 200 && ok.json && "support" in ok.json && anon.status === 401 && !anonJudged.leaked ? "PASS" : "FAIL",
    });
    check("S8", ok.status === 200 && ok.json && "support" in ok.json, `published support must be returned to a student, got ${ok.status}`);
    check("S8", anon.status === 401 && !anonJudged.leaked, `anonymous support must be 401 with no payload, got ${anon.status}`);
  }

  // ══ S9 forged cursor and invalid channel on the practice endpoints ════════════════════════════
  {
    const forgedCursors = [
      "not-a-cursor", "AAAA", "1", "%7B%22k%22%3A1%7D",
      Buffer.from(JSON.stringify({ key: "zzz", ts: "2000-01-01" })).toString("base64url"),
    ];
    const observed = [];
    for (const cursor of forgedCursors) {
      const facetsRes = await STUDENT.actor.get(`/api/speaking/practice/facets?channel=practice_alone&part=part1&topicCursor=${cursor}`);
      const questionsRes = await STUDENT.actor.get(`/api/speaking/practice/questions?channel=practice_alone&part=part1&cursor=${cursor}`);
      observed.push(`facets→${facetsRes.status}${facetsRes.json?.error ? `/${facetsRes.json.error}` : ""}`);
      observed.push(`questions→${questionsRes.status}${questionsRes.json?.error ? `/${questionsRes.json.error}` : ""}`);
      check("S9", facetsRes.status === 400, `a forged topic cursor must be refused with 400, got ${facetsRes.status}`);
      check("S9", questionsRes.status === 400, `a forged prompt cursor must be refused with 400, got ${questionsRes.status}`);
      check("S9", !Array.isArray(facetsRes.json?.topics) || facetsRes.json.topics.length === 0, "a forged cursor must not return topics");
      check("S9", !Array.isArray(questionsRes.json?.prompts) || questionsRes.json.prompts.length === 0, "a forged cursor must not return prompts");
    }
    // A genuine cursor must still be accepted, or "everything is 400" would pass vacuously.
    const first = await STUDENT.actor.get("/api/speaking/practice/questions?channel=practice_alone&part=part1");
    const realCursor = first.json?.nextCursor;
    const continued = realCursor
      ? await STUDENT.actor.get(`/api/speaking/practice/questions?channel=practice_alone&part=part1&cursor=${encodeURIComponent(realCursor)}`)
      : null;
    /*
     * `SpeakingChannel` is exactly "practice_alone" | "ai" — live_partner is NOT valid on these routes,
     * which the first draft of this probe wrongly assumed. Both sibling endpoints must refuse an invalid
     * channel identically: `questions` validates against CHANNELS, while `facets` was silently coercing
     * anything unknown to practice_alone and answering 200. Silently accepting a channel the caller did
     * not ask for is not a disclosure here, but it is inconsistent input validation on two routes that
     * are meant to be one contract, and §05 asks for incorrect channel eligibility to be denied.
     */
    const allowed = new Set(["practice_alone", "ai"]);
    for (const channel of ["ai", "practice_alone", "live_partner", "nonsense", "", "%22%3E%3Cscript%3E"]) {
      const label = channel === "" ? "(empty)" : channel;
      const res = await STUDENT.actor.get(`/api/speaking/practice/questions?channel=${channel}&part=part1`);
      const facetsRes = await STUDENT.actor.get(`/api/speaking/practice/facets?channel=${channel}&part=part1`);
      if (allowed.has(channel)) {
        check("S9", res.status === 200, `questions channel=${label} is legitimate, got ${res.status}`);
        check("S9", facetsRes.status === 200, `facets channel=${label} is legitimate, got ${facetsRes.status}`);
      } else {
        check("S9", res.status === 400, `questions channel=${label} must be 400, got ${res.status}`);
        check("S9", facetsRes.status === 400, `facets channel=${label} must be 400, got ${facetsRes.status}`);
      }
      observed.push(`ch:${label}→q${res.status}/f${facetsRes.status}`);
    }
    matrix.row({
      section: "S05", id: "S9", route: "GET /api/speaking/practice/{facets,questions}", action: "forged cursors and invalid channels",
      authorized: `a genuine cursor is accepted (HTTP ${continued ? continued.status : "n/a — first page had no continuation"})`,
      unauthorized: `${forgedCursors.length} forged cursors and 4 invalid channels`,
      positiveControl: realCursor ? `the server's own cursor ${realCursor.slice(0, 12)}… returns HTTP ${continued?.status}` : "first page returned no cursor, so only refusals were exercised",
      negativeControl: "every forged value refused with 400 and an empty body",
      actual: observed.join(" "),
      verdict: failures.some((f) => f.startsWith("S9")) ? "FAIL" : "PASS",
    });
  }

  // ══ S10 empty published bank: documented behaviour ════════════════════════════════════════════
  {
    /*
     * An empty ai-eligible bank cannot be produced over HTTP without deleting or mutating the seeded
     * rows, which §06 forbids. So this row records the CONTRACT that was verified, and the empty case
     * itself is proven at the data layer in tests/speaking-ai-script-qa2.test.ts ("an empty part is
     * simply absent, exactly as the reference behaved"), where an injected connection can be scoped.
     * It is reported as verified-elsewhere rather than claimed here.
     */
    const res = await STUDENT.actor.get("/api/speaking/ai/script?mode=full");
    const shapeOk = res.status === 200 && res.json && typeof res.json.mode === "string" && Array.isArray(res.json.script);
    matrix.row({
      section: "S05", id: "S10", route: "GET /api/speaking/ai/script", action: "empty published bank → documented empty behaviour",
      authorized: "STUDENT_A", unauthorized: "n/a",
      positiveControl: "the response contract is always {mode, script[]}, so an empty bank yields script:[] at HTTP 200",
      negativeControl: "no question is invented to fill an empty part",
      actual: `HTTP contract ${shapeOk ? "holds" : "BROKEN"}; empty-part behaviour proven at the data layer, NOT over HTTP (would require mutating seeded rows)`,
      verdict: shapeOk ? "PASS" : "FAIL",
    });
    check("S10", shapeOk, "the script response contract must be {mode, script[]}");
  }

  // ══ S11 secret sweep over every response the probe actually saw ═══════════════════════════════
  {
    const needles = [process.env.AUTH_SECRET, "postgres://", "BEGIN PRIVATE KEY", "password_hash", "passwordHash", "la_session="].filter(Boolean);
    const leaked = [];
    for (const record of sink) {
      for (const needle of needles) {
        if (needle && record.body.includes(needle)) leaked.push(`${record.route} contains ${needle.slice(0, 12)}…`);
      }
    }
    matrix.row({
      section: "S05", id: "S11", route: "(all probed routes)", action: "secret leakage sweep over real traffic",
      authorized: "n/a", unauthorized: "n/a",
      positiveControl: `${sink.length} real responses swept, not a hand-picked sample`,
      negativeControl: `${needles.length} needles including AUTH_SECRET and the DSN`,
      actual: leaked.length ? `LEAK: ${leaked.slice(0, 3).join("; ")}` : `no needle found in ${sink.length} responses`,
      verdict: leaked.length === 0 && sink.length > 0 ? "PASS" : "FAIL",
    });
    check("S11", sink.length > 0, "the sweep saw no traffic, so it proves nothing");
    check("S11", leaked.length === 0, `secret leakage: ${leaked.slice(0, 3).join("; ")}`);
  }
} finally {
  const removed = await client.query("delete from speaking_prompts where prompt_text like $1 returning id", [`${MARKER}%`]);
  const left = await client.query("select count(*)::int n from speaking_prompts where prompt_text like $1", [`${MARKER}%`]);
  console.log(`# cleanup: deleted ${removed.rows.length} fixture row(s), ${left.rows[0].n} remain`);
  check("cleanup", left.rows[0].n === 0, "fixture rows must not survive the probe");
  await client.end().catch(() => {});
}

console.log(`\n${matrix.report()}`);
const total = matrix.rows.length;
console.log(`\n# §05 speaking security: ${matrix.pass}/${total} PASS, ${matrix.fail} FAIL`);
if (failures.length) {
  console.log(`\n# ASSERTION FAILURES (${failures.length}):`);
  for (const f of failures) console.log(`#   - ${f}`);
}
process.exit(matrix.fail === 0 && failures.length === 0 ? 0 : 1);
