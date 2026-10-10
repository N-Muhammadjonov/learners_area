#!/usr/bin/env node
/**
 * PRIORITY A — Who may evaluate a learner's writing?
 *
 *   node scripts/verify-teacher-feedback-authority.mjs [base]
 *
 * POST /api/teacher/feedback checked `isStaff(user.role)` and then wrote feedback for whichever
 * submission id it was handed. Staff is three roles wide — teacher, admin, owner — and a teacher's
 * reach is meant to stop at their own roster. The repository already states the rule and already
 * implements it once, in mayAssignTo() (src/lib/content/assignments.ts): "a TEACHER may only set
 * work for a student on their own roster (teacher_student_links — the same explicit roster the
 * Reporter uses, so nothing is inferred); an administrator may set work for any student". Grading a
 * learner's work is the same authority relationship as setting it, so this probe holds the feedback
 * route to the rule the rest of the product already enforces.
 *
 * WHAT MAKES THIS A SECURITY TEST RATHER THAN A STATUS TEST. Every row records the actor, the
 * expected permission, the actual response AND the actual PostgreSQL effect, because a route that
 * answers 403 while still writing the row is worse than one that answers 200. Identity is not
 * assumed: loginActor decodes the signed session cookie and compares its `sub` claim with the
 * database id for that email, so TEACHER_B cannot silently be holding TEACHER_A's cookie and turn
 * every denial into a false PASS.
 *
 * A 400 is not an authorization result, so the payload is validated first and a deliberately
 * malformed body is run as its own negative control — otherwise "denied" could just mean "the
 * request never reached the ownership check".
 */
import pg from "pg";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(2); }
const { assertMutableDatabase, createRowSweeper } = await import("./lib/fixture-safety.mjs");
assertMutableDatabase(DATABASE_URL, { probe: "verify-teacher-feedback-authority" });
const { loginActor, createActor } = await import("./lib/security-matrix.mjs");

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const n = async (sql, params = []) => Number((await client.query(sql, params)).rows[0].n);

const sweeper = createRowSweeper({
  client, probe: "feedback-authority",
  tables: ["writing_feedback", "activity_events", "writing_submissions"],
});
await sweeper.capture();

let pass = 0;
const failures = [];
const rows = [];
function row(actor, action, expected, res, dbEffect, control, result, detail = "") {
  rows.push({ actor, action, expected, response: res, db: dbEffect, control, result, detail });
  if (result === "PASS") pass++; else failures.push(`${actor} ${action}`);
  console.log(`  ${result === "PASS" ? "PASS" : "FAIL"}  ${actor.padEnd(11)} ${action.padEnd(38)} expected=${String(expected).padEnd(22)} actual=${String(res).padEnd(16)} db=${dbEffect}`);
}

const CREDENTIALS = {
  TEACHER_A: ["teacher@learnersarea.uz", "Teacher12345!"],
  TEACHER_B: ["teacher2@learnersarea.uz", "Teacher12345!"],
  STUDENT_A: ["demo.student@learnersarea.uz", "Student12345!"],
  STUDENT_B: ["new.student@learnersarea.uz", "Student12345!"],
  ADMIN: ["admin@learnersarea.uz", "Admin12345!"],
  OWNER: ["owner@learnersarea.uz", "Owner12345!"],
};

try {
  /* ---------------------------------------------------- establish the roster */
  const actors = {};
  for (const [name, [email, password]] of Object.entries(CREDENTIALS)) {
    const session = await loginActor(name, BASE, email, password, { client });
    actors[name] = session.actor;
    if (session.identity?.id !== session.identity?.expectedId && session.identity?.expectedId) {
      throw new Error(`${name}: cookie sub ${session.identity.id} is not ${email}'s id ${session.identity.expectedId}`);
    }
  }
  /*
   * A genuinely unauthenticated actor. createActor's request() closes over the cookie it was
   * constructed with, so calling it with a re-bound `this` cannot strip the credential — the first
   * draft of this probe did exactly that and measured TEACHER_A while labelling the row ANONYMOUS,
   * reporting a 200 and a written row for an actor that was never anonymous. The empty cookie has to
   * be supplied at construction, and the row is only meaningful because the same payload succeeds
   * for a real teacher further down.
   */
  const anonymous = createActor("ANONYMOUS", "", BASE, { ip: "203.0.113.77" });

  const ids = Object.fromEntries(await q(`select email, id from users where email = any($1)`, [Object.values(CREDENTIALS).map((c) => c[0])])
    .then((rs) => rs.map((r) => [r.email, r.id])));
  const TEACHER_A_ID = ids["teacher@learnersarea.uz"];
  const TEACHER_B_ID = ids["teacher2@learnersarea.uz"];
  const STUDENT_A_ID = ids["demo.student@learnersarea.uz"];

  const linkAB = await n("select count(*)::int n from teacher_student_links where teacher_user_id=$1 and student_user_id=$2", [TEACHER_A_ID, STUDENT_A_ID]);
  const linkBB = await n("select count(*)::int n from teacher_student_links where teacher_user_id=$1 and student_user_id=$2", [TEACHER_B_ID, STUDENT_A_ID]);
  console.log(`\n  roster: TEACHER_A→STUDENT_A link=${linkAB} (must be 1) · TEACHER_B→STUDENT_A link=${linkBB} (must be 0)`);
  if (linkAB !== 1) throw new Error("POSITIVE FIXTURE MISSING: TEACHER_A is not on STUDENT_A's roster, so the authorized case would be vacuous");
  if (linkBB !== 0) throw new Error("TEACHER_B already has a roster link to STUDENT_A; the unrelated-teacher case would prove nothing");

  /* ------------------------------------------------- the fixture submission */
  const promptId = (await q("select id from writing_prompts order by created_at limit 1"))[0]?.id;
  if (!promptId) throw new Error("no writing prompt to attach a submission to");
  const statuses = (await q("select e.enumlabel l from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typname='writing_status'")).map((r) => r.l);
  const status = statuses.includes("submitted") ? "submitted" : statuses[0];
  const MARKER = `QA2 feedback authority ${Date.now().toString(36)}`;
  const [submission] = await q(
    `insert into writing_submissions (user_id, prompt_id, content, word_count, status, submitted_at)
     values ($1,$2,$3,$4,$5::writing_status, now()) returning id`,
    [STUDENT_A_ID, promptId, `${MARKER} — private learner text that must never reach an unauthorized teacher.`, 42, status],
  );
  const SUBMISSION_ID = submission.id;
  console.log(`  fixture submission ${SUBMISSION_ID.slice(0, 8)} owned by STUDENT_A, status=${status}\n`);

  const PAYLOAD = { submissionId: SUBMISSION_ID, comment: `${MARKER} feedback`, overallBand: 6.5 };
  const FORGED = "00000000-0000-4000-8000-000000000000";

  /*
   * Effects are measured as a DIFF of row identities, not as a count on the submission. Counting
   * every row attached to this submission is cumulative: by the fourth request the total includes
   * what the first three wrote, so a correct single-row write looks like three and an attribution
   * check cannot tell whose row is whose. Snapshotting the id set before each request and inspecting
   * only the ids that appeared makes every row order-independent.
   */
  const effects = async () => ({
    feedback: new Set((await q("select id from writing_feedback where submission_id=$1", [SUBMISSION_ID])).map((r) => r.id)),
    events: new Set((await q("select id from activity_events where type='TEACHER_FEEDBACK_RECEIVED' and payload->>'submissionId'=$1", [SUBMISSION_ID])).map((r) => r.id)),
  });
  const added = (before, after) => [...after].filter((id) => !before.has(id));
  /** The teacher_id on exactly the feedback rows this step created. */
  const attributionOf = async (ids) => ids.length === 0 ? []
    : (await q("select teacher_id from writing_feedback where id = any($1::uuid[])", [ids])).map((r) => r.teacher_id);

  /* ---------------------------------------------- 1. unauthenticated actor */
  let before = await effects();
  let res = await anonymous.post("/api/teacher/feedback", PAYLOAD);
  let after = await effects();
  let newFb = added(before.feedback, after.feedback);
  let newEv = added(before.events, after.events);
  row("ANONYMOUS", "POST feedback, valid payload", "401 + no writes", `${res.status}`,
    `feedback +${newFb.length}, events +${newEv.length}`,
    "same payload succeeds for TEACHER_A below",
    res.status === 401 && newFb.length === 0 && newEv.length === 0 ? "PASS" : "FAIL",
    newFb.length ? `UNAUTHENTICATED WRITE: ${newFb.length} feedback row(s) created with no session at all` : "");

  /* ------------------------------- 2/3. learners may not evaluate, even their own */
  for (const learner of ["STUDENT_B", "STUDENT_A"]) {
    before = await effects();
    res = await actors[learner].post("/api/teacher/feedback", PAYLOAD);
    after = await effects();
    newFb = added(before.feedback, after.feedback);
    newEv = added(before.events, after.events);
    const own = learner === "STUDENT_A" ? " (owns this submission)" : "";
    row(learner, `POST feedback${own}`, "403 + no writes", `${res.status}`,
      `feedback +${newFb.length}, events +${newEv.length}`,
      "the same submission is gradeable by staff",
      res.status === 403 && newFb.length === 0 && newEv.length === 0 ? "PASS" : "FAIL",
      "owning the work does not confer authority to grade it");
  }

  /* ------------- 4. THE DEFECT: an unrelated teacher, well-formed payload */
  before = await effects();
  const denied = await actors.TEACHER_B.post("/api/teacher/feedback", PAYLOAD);
  after = await effects();
  newFb = added(before.feedback, after.feedback);
  newEv = added(before.events, after.events);
  const wroteUnauthorized = newFb.length > 0 || newEv.length > 0;
  row("TEACHER_B", "POST feedback, no roster link", "denied + no writes", `${denied.status}`,
    `feedback +${newFb.length}, events +${newEv.length}`,
    "TEACHER_A (on the roster) is allowed the identical request",
    denied.status >= 400 && !wroteUnauthorized ? "PASS" : "FAIL",
    wroteUnauthorized
      ? `CROSS-ROSTER WRITE: an unrelated teacher created ${newFb.length} feedback row(s) and ${newEv.length} learner notification(s) with HTTP ${denied.status}`
      : `denied with ${denied.status}`);

  /* --------- 5. no private disclosure in the denial, and IDOR equivalence */
  const leaksContent = denied.body.includes(MARKER) || denied.body.includes("private learner text");
  const missing = await actors.TEACHER_B.post("/api/teacher/feedback", { submissionId: FORGED, comment: `${MARKER} probe` });
  row("TEACHER_B", "denial vs a forged submission id", "indistinguishable (no IDOR oracle)",
    `${denied.status} vs ${missing.status}`,
    `feedback ${await n("select count(*)::int n from writing_feedback where submission_id=$1", [FORGED])} rows for the forged id`,
    "a real id and a nonexistent id must answer alike",
    denied.status === missing.status && denied.body === missing.body && !leaksContent ? "PASS" : "FAIL",
    `bodies identical=${denied.body === missing.body}; leaked the learner's text=${leaksContent}`);

  /* ------------------- 6. negative control: a malformed body is not a denial */
  const malformed = await actors.TEACHER_B.post("/api/teacher/feedback", { submissionId: "not-a-uuid" });
  row("TEACHER_B", "POST malformed payload (control)", "400 invalid_input, not an authz result",
    `${malformed.status}`, "n/a", "proves 400 and denial are different outcomes",
    malformed.status === 400 ? "PASS" : "FAIL",
    `body "${malformed.body.slice(0, 60)}" — a 400 here would mean the request never reached the ownership check`);

  /* ------------------------- 7. POSITIVE CONTROL: the rostered teacher */
  before = await effects();
  const allowed = await actors.TEACHER_A.post("/api/teacher/feedback", PAYLOAD);
  after = await effects();
  newFb = added(before.feedback, after.feedback);
  newEv = added(before.events, after.events);
  const attributed = await attributionOf(newFb);
  row("TEACHER_A", "POST feedback, on the roster", "200 + exactly 1 feedback + 1 event",
    `${allowed.status}`, `feedback +${newFb.length}, events +${newEv.length}`,
    "this is the same payload TEACHER_B was refused",
    allowed.status < 300 && newFb.length === 1 && newEv.length === 1
      && attributed.length === 1 && attributed[0] === TEACHER_A_ID ? "PASS" : "FAIL",
    `teacher_id on the new row = ${String(attributed[0]).slice(0, 8)} (TEACHER_A is ${String(TEACHER_A_ID).slice(0, 8)})`);

  /* ------------------- 8/9. administrator and owner keep their authority */
  for (const name of ["ADMIN", "OWNER"]) {
    before = await effects();
    res = await actors[name].post("/api/teacher/feedback", { ...PAYLOAD, comment: `${MARKER} ${name}` });
    after = await effects();
    newFb = added(before.feedback, after.feedback);
    newEv = added(before.events, after.events);
    row(name, "POST feedback, centre-wide authority", "allowed + 1 feedback + 1 event", `${res.status}`,
      `feedback +${newFb.length}, events +${newEv.length}`,
      "policy: an administrator may act for any student",
      res.status < 300 && newFb.length === 1 && newEv.length === 1 ? "PASS" : "FAIL");
  }

  /* ---------------- 10. concurrency: denied and allowed requests at once */
  before = await effects();
  const concurrent = await Promise.all([
    actors.TEACHER_B.post("/api/teacher/feedback", { ...PAYLOAD, comment: `${MARKER} race-B` }),
    actors.TEACHER_A.post("/api/teacher/feedback", { ...PAYLOAD, comment: `${MARKER} race-A` }),
    actors.TEACHER_B.post("/api/teacher/feedback", { ...PAYLOAD, comment: `${MARKER} race-B2` }),
  ]);
  after = await effects();
  newFb = added(before.feedback, after.feedback);
  const raceTeachers = await attributionOf(newFb);
  const fromB = raceTeachers.filter((t) => t === TEACHER_B_ID).length;
  row("TEACHER_A+B", "3 concurrent requests (2 unauthorized)", "only TEACHER_A's lands",
    concurrent.map((r) => r.status).join("/"),
    `feedback +${newFb.length}, of which TEACHER_B's = ${fromB}`,
    "sequential denial does not prove the check holds under a race",
    concurrent[0].status >= 400 && concurrent[2].status >= 400 && concurrent[1].status < 300
      && newFb.length === 1 && fromB === 0 ? "PASS" : "FAIL",
    fromB > 0 ? `${fromB} feedback row(s) attributed to the unrelated teacher under concurrency` : "no unauthorized row survived the race");

  console.log(`\n  matrix: ${rows.length} rows · writing_feedback on this submission = ${await n("select count(*)::int n from writing_feedback where submission_id=$1", [SUBMISSION_ID])}`);
} catch (error) {
  console.error("\nABORTED:", error?.message ?? error);
  failures.push("aborted");
} finally {
  const { removed, residue } = await sweeper.sweep();
  console.log(`\n  sweeper removed: ${removed.join(", ") || "nothing"}`);
  console.log(`  residue: ${residue.length ? residue.join(", ") : "none"}`);
  if (residue.length) failures.push("residue");
  const orphaned = await n("select count(*)::int n from writing_feedback f where not exists (select 1 from writing_submissions s where s.id = f.submission_id)");
  console.log(`  orphaned feedback rows left: ${orphaned}`);
  if (orphaned) failures.push("orphaned feedback");
  await client.end().catch(() => {});
  console.log(`\n${pass}/${rows.length} matrix rows PASS · ${failures.length} failure(s)`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
