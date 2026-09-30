import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The API contract the browser is NOT trusted with (§127–§132, §165).
 *
 * These are source-level assertions on purpose: they pin the shape of the
 * requests the routes accept, so a later change cannot quietly start reading a
 * user id, a text id, a deadline or a score from the request body. The runtime
 * behaviour behind them is covered by the data-layer and payload suites.
 */

const root = join(process.cwd());
const read = (path: string) => readFileSync(join(root, path), "utf8");
/** Comments explain history; they are not behaviour. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("Start reads only the level from the request; identity comes from the session", () => {
  const route = read("src/app/api/retention/attempts/route.ts");
  assert.match(route, /requireActiveUser\(\)/);
  assert.match(route, /startOrResumeAttempt\(\{\s*userId: user\.id,\s*level: body\.level\s*\}\)/);
  for (const forbidden of ["body.userId", "body.user_id", "body.textId", "body.versionId", "body.cycle", "body.score", "body.deadline"]) {
    assert.ok(!route.includes(forbidden), `the Start route must not read ${forbidden}`);
  }
});

test("draft and submit accept the learner's own text and nothing that decides anything", () => {
  const draft = read("src/app/api/retention/attempts/[id]/draft/route.ts");
  const submit = read("src/app/api/retention/attempts/[id]/submit/route.ts");
  assert.match(draft, /saveRecallDraft\(\{\s*attemptId: id,\s*userId: user\.id,\s*recallText/);
  assert.match(submit, /submitAttempt\(\{\s*attemptId: id,\s*userId: user\.id,\s*recallText/);
  for (const route of [draft, submit]) {
    for (const forbidden of ["body.score", "body.points", "body.readEndsAt", "body.writeEndsAt", "body.status", "body.evaluatorVersion"]) {
      assert.ok(!route.includes(forbidden), `a learner request must not carry ${forbidden}`);
    }
  }
});

test("the history and summary endpoints are scoped to the signed-in learner", () => {
  const history = read("src/app/api/retention/history/route.ts");
  const summary = read("src/app/api/retention/summary/route.ts");
  assert.match(history, /listRetentionHistory\(\{ userId: user\.id/);
  assert.match(summary, /getRetentionSummary\(user\.id/);
  for (const source of [history, summary]) {
    assert.ok(!source.includes("searchParams.get(\"userId\")"));
    assert.match(source, /requireActiveUser\(\)/);
  }
});

test("the learner payload module never imports the scorer, and the recall branch never touches the body", () => {
  const payload = read("src/lib/retention/payload.ts");
  assert.ok(!payload.includes("evaluateRecall"), "scoring belongs to the server-side submit path only");
  const recallBranch = payload.split('phase.phase === "recall"')[1]!.split("const payload: RetentionTerminalPayload")[0]!;
  assert.ok(!recallBranch.includes("bodyText"), "the recall payload must not carry the source");
  assert.match(payload, /export function assertLearnerSafe/);
});

test("the learner UI never renders the source outside the reading phase", () => {
  const session = read("src/components/reading/RetentionSession.tsx");
  // `bodyText` is referenced exactly once, inside the reading view's source panel.
  assert.equal(session.split("payload.bodyText").length - 1, 1);
  assert.match(session, /data-retention-source/);
  assert.match(session, /data-retention-answer/);
  // No localStorage/sessionStorage of the source or the draft: the draft lives in
  // the database, and the source never leaves the reading payload.
  assert.ok(!/localStorage|sessionStorage/.test(session));
});

test("every admin Retention route is behind the administrator gate", () => {
  const routes = [
    "src/app/api/admin/retention/texts/route.ts",
    "src/app/api/admin/retention/texts/[id]/route.ts",
    "src/app/api/admin/retention/texts/[id]/versions/route.ts",
    "src/app/api/admin/retention/validate/route.ts",
  ];
  for (const path of routes) {
    const source = read(path);
    assert.match(source, /requireRetentionAdmin\(\)/, `${path} must be gated`);
    assert.ok(!source.includes("requireActiveUser"), `${path} must use the shared admin gate`);
  }
  const gate = read("src/lib/retention/admin.ts");
  assert.match(gate, /isAdministrator\(user\.role\)/);
});

test("Change always posts a new version and carries the stale-editor guard", () => {
  const route = read("src/app/api/admin/retention/texts/[id]/versions/route.ts");
  assert.match(route, /createRetentionTextVersion\(/);
  assert.match(route, /expectedCurrentVersionId: parsed\.data\.expectedCurrentVersionId/);
});

test("the old passage-driven drill is gone: the route ignores any passage parameter", () => {
  const code = stripComments(read("src/app/(app)/reading/retention/page.tsx"));
  assert.ok(!/searchParams/.test(code), "the retention route must not read any query parameter");
  assert.ok(!/passage/i.test(code), "the old passage-driven path must be gone from the code");
  assert.ok(!code.includes("isUuid"), "no passage id may be validated and rendered any more");
  assert.ok(!code.includes("RetentionCheck"), "the unscored drill component must no longer be rendered");
  assert.match(code, /findAnyLiveAttempt/);
});

test("the Reading hub no longer carries the TED / PODCAST tab (Part 1 override)", () => {
  const hub = read("src/app/(app)/reading/page.tsx");
  const tabs = hub.match(/const TABS = \[([^\]]+)\]/)![1]!;
  assert.ok(!tabs.includes("videos"), `TABS still contains videos: ${tabs}`);
  assert.ok(!hub.includes("data-reading-videos"));
});

test("the Management page links to the Retention bank one step below Reading", () => {
  const reading = read("src/app/(app)/admin/reading/page.tsx");
  assert.match(reading, /href="\/admin\/reading\/retention"/);
  const page = read("src/app/(app)/admin/reading/retention/page.tsx");
  assert.match(page, /href="\/admin\/reading"/);
  assert.match(page, /requireAdministrator\(\)/);
  const routes = read("src/lib/nav/routes.ts");
  const retentionIndex = routes.indexOf('prefix: "/admin/reading/retention"');
  const readingIndex = routes.indexOf('prefix: "/admin/reading"');
  assert.ok(retentionIndex > -1 && readingIndex > -1 && retentionIndex < readingIndex, "the nested route must be matched before its parent");
});

test("the Retention bank panel offers Add, Change, Delete-as-archive and Restore", () => {
  const panel = read("src/components/admin/RetentionBankPanel.tsx");
  for (const marker of ["data-retention-add", "data-retention-change", "data-retention-archive", "data-retention-restore", "data-retention-editor"]) {
    assert.ok(panel.includes(marker), `the panel is missing ${marker}`);
  }
  // Two authoring fields, live validation, and the conflict path.
  assert.match(panel, /data-retention-editor-text/);
  assert.match(panel, /data-retention-editor-structure/);
  assert.match(panel, /api\/admin\/retention\/validate/);
  assert.match(panel, /response\.status === 409/);
  assert.match(panel, /window\.confirm/);
});
