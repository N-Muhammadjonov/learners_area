import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { users, riwiAssessmentPolicyVersions, auditLog, evaluations } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import { AssessmentPolicyError, createAssessmentPolicyCandidate, createAssessmentPolicyRollbackCandidate, previewAssessmentPolicyCandidate, approveAssessmentPolicyCandidate, getApprovedOwnerPolicyForContract } from "../src/lib/services/coach/contracts/owner-policy";

const message = "Please show the three biggest weaknesses for Writing Task 2, quote the evidence from the submitted work, include a correction, and add a reusable rule.";
const denied = (code: string) => (error: unknown) => error instanceof AssessmentPolicyError && error.code === code;

test("rollback creates a fresh inert candidate with new preview/approval; old versions remain immutable and retries are scoped to activation", async () => {
  const d = await createTestDatabase(), owner = randomUUID(), student = randomUUID();
  const actor = { id: owner, role: "owner" as const, accountStatus: "active" as const };
  try {
    await d.db.insert(users).values([{ id: owner, name: "Owner", role: "owner", accountStatus: "active" }, { id: student, name: "Student", role: "student", accountStatus: "active" }]);
    await d.db.insert(evaluations).values({ userId: student, evaluationType: "writing", sourceType: "writing_submission", sourceId: randomUUID(), providerId: "riwi", providerDisplayName: "RIWI", providerType: "internal", providerVersion: "historical", promptVersion: "old-prompt", rubricVersion: "old-rubric", checkedByName: "RIWI", ownerPolicyScope: "writing.task2.*", ownerPolicyVersion: 1, overallEstimate: 6.5, criteria: [{ key: "grammar", label: "Grammar", band: 6.5 }] });
    const historicalEvaluations = await d.db.select().from(evaluations);
    const one = await createAssessmentPolicyCandidate(actor, message, d.db);
    await assert.rejects(createAssessmentPolicyRollbackCandidate(actor, one.candidate.id, d.db), denied("invalid_state"));
    const p1 = await previewAssessmentPolicyCandidate(actor, one.candidate.id, d.db);
    await approveAssessmentPolicyCandidate(actor, one.candidate.id, p1.regression.evidenceHash, d.db);
    const two = await createAssessmentPolicyCandidate(actor, message + " A second presentation change.", d.db);
    await d.db.update(riwiAssessmentPolicyVersions).set({ overlay: { feedbackStyle: "concise", maxWeaknesses: 2 } }).where(eq(riwiAssessmentPolicyVersions.id, two.candidate.id));
    const p2 = await previewAssessmentPolicyCandidate(actor, two.candidate.id, d.db);
    await approveAssessmentPolicyCandidate(actor, two.candidate.id, p2.regression.evidenceHash, d.db);
    const before = await d.db.select().from(riwiAssessmentPolicyVersions).where(eq(riwiAssessmentPolicyVersions.id, one.candidate.id));
    const rollback = await createAssessmentPolicyRollbackCandidate(actor, one.candidate.id, d.db);
    assert.equal(rollback.candidate.version, 3); assert.equal(rollback.candidate.state, "candidate"); assert.equal(rollback.candidate.active, false);
    assert.equal(rollback.candidate.regressionEvidenceHash, null); assert.equal(rollback.candidate.approvedAt, null);
    assert.deepEqual(rollback.candidate.overlay, one.candidate.overlay);
    assert.equal((await getApprovedOwnerPolicyForContract("writing.task2.opinion", d.db))?.version, 2);
    const retry = await createAssessmentPolicyRollbackCandidate(actor, one.candidate.id, d.db);
    assert.equal(retry.replay, true); assert.equal(retry.candidate.id, rollback.candidate.id);
    await assert.rejects(approveAssessmentPolicyCandidate(actor, rollback.candidate.id, p1.regression.evidenceHash, d.db), denied("regression_required"));
    await assert.rejects(createAssessmentPolicyRollbackCandidate({ ...actor, id: student }, one.candidate.id, d.db), denied("forbidden"));
    const p3 = await previewAssessmentPolicyCandidate(actor, rollback.candidate.id, d.db);
    await approveAssessmentPolicyCandidate(actor, rollback.candidate.id, p3.regression.evidenceHash, d.db);
    assert.equal((await getApprovedOwnerPolicyForContract("writing.task2.opinion", d.db))?.version, 3);
    assert.deepEqual(await d.db.select().from(riwiAssessmentPolicyVersions).where(eq(riwiAssessmentPolicyVersions.id, one.candidate.id)), before, "rollback never rewrites original approval history");
    assert.deepEqual(await d.db.select().from(evaluations), historicalEvaluations, "activation and rollback leave persisted historical scores and provenance unchanged");
    const logs = await d.db.select().from(auditLog);
    assert.ok(logs.some(row => JSON.stringify(row.metadata).includes('rollback_candidate')));
    assert.ok(!JSON.stringify(logs).includes(message));
    await d.db.update(riwiAssessmentPolicyVersions).set({ overlay: { feedbackStyle: "balanced" } }).where(eq(riwiAssessmentPolicyVersions.id, one.candidate.id));
    await assert.rejects(createAssessmentPolicyRollbackCandidate(actor, one.candidate.id, d.db), denied("regression_required"));
    await d.db.update(users).set({ accountStatus: "suspended" }).where(eq(users.id, owner));
    await assert.rejects(createAssessmentPolicyRollbackCandidate(actor, two.candidate.id, d.db), denied("forbidden"));
  } finally { await d.close(); }
});

test("approval binds the exact preview the owner reviewed even after another valid preview replaces it", async () => {
  const d = await createTestDatabase(), owner = randomUUID();
  const actor = { id: owner, role: "owner" as const, accountStatus: "active" as const };
  try {
    await d.db.insert(users).values({ id: owner, name: "Owner", role: "owner", accountStatus: "active" });
    const c = await createAssessmentPolicyCandidate(actor, message, d.db);
    const old = await previewAssessmentPolicyCandidate(actor, c.candidate.id, d.db);
    await d.db.update(riwiAssessmentPolicyVersions).set({ overlay: { feedbackStyle: "concise" } }).where(eq(riwiAssessmentPolicyVersions.id, c.candidate.id));
    const fresh = await previewAssessmentPolicyCandidate(actor, c.candidate.id, d.db);
    assert.notEqual(old.regression.evidenceHash, fresh.regression.evidenceHash);
    await assert.rejects(approveAssessmentPolicyCandidate(actor, c.candidate.id, old.regression.evidenceHash, d.db), denied("regression_required"));
    await assert.rejects(approveAssessmentPolicyCandidate(actor, c.candidate.id, "", d.db), denied("invalid_input"));
    assert.equal(await getApprovedOwnerPolicyForContract("writing.task2.opinion", d.db), null);
    await approveAssessmentPolicyCandidate(actor, c.candidate.id, fresh.regression.evidenceHash, d.db);
    await assert.rejects(approveAssessmentPolicyCandidate(actor, c.candidate.id, old.regression.evidenceHash, d.db), denied("regression_required"));
    assert.equal((await approveAssessmentPolicyCandidate(actor, c.candidate.id, fresh.regression.evidenceHash, d.db)).replay, true);
    await d.db.update(riwiAssessmentPolicyVersions).set({ overlay: { feedbackStyle: "balanced" } }).where(eq(riwiAssessmentPolicyVersions.id, c.candidate.id));
    assert.equal(await getApprovedOwnerPolicyForContract("writing.task2.opinion", d.db), null, "a changed approved row cannot silently supply runtime policy");
    await assert.rejects(approveAssessmentPolicyCandidate(actor, c.candidate.id, fresh.regression.evidenceHash, d.db), denied("regression_required"));
  } finally { await d.close(); }
});

test("published v2 policies remain readable and rollback copies them into v3 candidates with fresh behavior fixtures", async () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/riwi-owner-policy-v2-regression.json", import.meta.url), "utf8"));
  assert.equal(fixtures.sourceCommit, "7f805af85705906f6c37710a3030f3eb357e90c0");
  const d = await createTestDatabase(), owner = randomUUID();
  const actor = { id: owner, role: "owner" as const, accountStatus: "active" as const };
  try {
    await d.db.insert(users).values({ id: owner, name: "Owner", role: "owner", accountStatus: "active" });
    const messages = [message, "For Speaking Part 1, do not show per-answer scores; give a topic summary and list three weaknesses.", "For Grammar, give two mini-illustrations of the wrong form and explain why it sounds unnatural."];
    for (const [index, legacy] of fixtures.fixtures.entries()) {
      const c1 = await createAssessmentPolicyCandidate(actor, messages[index]!, d.db);
      const p1 = await previewAssessmentPolicyCandidate(actor, c1.candidate.id, d.db);
      assert.equal(p1.regression.checks.runtimeGoldenFixturesPassed, true);
      await approveAssessmentPolicyCandidate(actor, c1.candidate.id, p1.regression.evidenceHash, d.db);
      await d.db.update(riwiAssessmentPolicyVersions).set({ regressionFixtureId: legacy.regression.fixtureId, regressionEvidenceHash: legacy.regression.evidenceHash }).where(eq(riwiAssessmentPolicyVersions.id, c1.candidate.id));
      assert.ok(await getApprovedOwnerPolicyForContract(legacy.regression.affectedTaskKeys[0], d.db), "v2 source hash exactly matches the published algorithm");
      const c2 = await createAssessmentPolicyCandidate(actor, messages[index]! + " Second version.", d.db);
      const p2 = await previewAssessmentPolicyCandidate(actor, c2.candidate.id, d.db);
      await approveAssessmentPolicyCandidate(actor, c2.candidate.id, p2.regression.evidenceHash, d.db);
      const rollback = await createAssessmentPolicyRollbackCandidate(actor, c1.candidate.id, d.db);
      assert.equal(rollback.candidate.regressionFixtureId, null);
      const fresh = await previewAssessmentPolicyCandidate(actor, rollback.candidate.id, d.db);
      assert.equal(fresh.regression.fixtureId, "assessment-owner-overlay-invariants-v3");
      assert.equal(fresh.regression.checks.runtimeGoldenFixturesPassed, true);
      await approveAssessmentPolicyCandidate(actor, rollback.candidate.id, fresh.regression.evidenceHash, d.db);
    }
    for (const role of ["student", "teacher", "admin"] as const) {
      const id = randomUUID(); await d.db.insert(users).values({ id, name: role, role, accountStatus: "active" });
      await assert.rejects(createAssessmentPolicyCandidate({ ...actor, id }, message, d.db), denied("forbidden"));
      await assert.rejects(createAssessmentPolicyCandidate({ ...actor, id, role }, message, d.db), denied("forbidden"));
    }
  } finally { await d.close(); }
});

test("a still-pending older candidate cannot downgrade a newer activation using a previously valid preview", async () => {
  const d = await createTestDatabase(), owner = randomUUID();
  const actor = { id: owner, role: "owner" as const, accountStatus: "active" as const };
  try {
    await d.db.insert(users).values({ id: owner, name: "Owner", role: "owner", accountStatus: "active" });
    const older = await createAssessmentPolicyCandidate(actor, message, d.db);
    const oldPreview = await previewAssessmentPolicyCandidate(actor, older.candidate.id, d.db);
    const newer = await createAssessmentPolicyCandidate(actor, message + " Next version.", d.db);
    const newPreview = await previewAssessmentPolicyCandidate(actor, newer.candidate.id, d.db);
    await approveAssessmentPolicyCandidate(actor, newer.candidate.id, newPreview.regression.evidenceHash, d.db);
    await assert.rejects(approveAssessmentPolicyCandidate(actor, older.candidate.id, oldPreview.regression.evidenceHash, d.db), denied("invalid_state"));
    assert.equal((await getApprovedOwnerPolicyForContract("writing.task2.opinion", d.db))?.version, 2);
  } finally { await d.close(); }
});
