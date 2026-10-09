import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, riwiSecuritySignals, auditLog } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import { buildSecuritySignal, recordSecuritySignal, previewSecuritySignal, reviewSecuritySignal } from "../src/lib/services/riwi/security-learning";

test("a supplied SHA and invented fixture cannot approve a security regression", async () => {
  const database = await createTestDatabase();
  const actor = { id: randomUUID(), role: "owner" as const, accountStatus: "active" as const };
  try {
    await database.db.insert(users).values({ id: actor.id, name: "QA owner", role: actor.role, accountStatus: actor.accountStatus });
    const signal = await recordSecuritySignal({ type: "role_spoof", actorRole: "student", routeClass: "riwi.chat" }, database.db);
    await assert.rejects(reviewSecuritySignal({ actor, signalId: signal.id, decision: "approve_regression", regressionFixtureId: "invented-proof", regressionEvidenceHash: "a".repeat(64) }, database.db));
    const [stored] = await database.db.select().from(riwiSecuritySignals).where(eq(riwiSecuritySignals.id, signal.id));
    assert.equal(stored?.state, "candidate");
  } finally { await database.close(); }
});

test("route and actor metadata cannot carry arbitrary private text into security learning", () => {
  assert.throws(() => buildSecuritySignal({ type: "idor", routeClass: "private-learner-password-123" }));
  assert.throws(() => buildSecuritySignal({ type: "idor", routeClass: "riwi.chat", actorRole: "private-learner" as never }));
});

test("new observations invalidate an old preview and approvals are owner-bound, replay-safe and audited", async () => {
  const database = await createTestDatabase();
  const actor = { id: randomUUID(), role: "owner" as const, accountStatus: "active" as const };
  const other = { ...actor, id: randomUUID() };
  const spoof = { ...actor, id: randomUUID() };
  try {
    await database.db.insert(users).values([
      { id: actor.id, name: "QA owner", role: "owner", accountStatus: "active" },
      { id: other.id, name: "Other owner", role: "owner", accountStatus: "active" },
      { id: spoof.id, name: "Student", role: "student", accountStatus: "active" },
    ]);
    const input = { type: "role_spoof" as const, actorRole: "student" as const, routeClass: "riwi.chat" };
    const signal = await recordSecuritySignal(input, database.db);
    await assert.rejects(previewSecuritySignal(spoof, signal.id, database.db), /not_found/);
    const first = await previewSecuritySignal(actor, signal.id, database.db);
    assert.equal(first.passed, true);
    const approve = (owner: typeof actor, hash: string) => reviewSecuritySignal({ actor: owner, signalId: signal.id, decision: "approve_regression", regressionFixtureId: "policy-deny-default-v1", regressionEvidenceHash: hash }, database.db);
    await assert.rejects(approve(other, first.evidenceHash), /regression_required/);
    await recordSecuritySignal(input, database.db);
    await assert.rejects(approve(actor, first.evidenceHash), /regression_required/);
    const current = await previewSecuritySignal(actor, signal.id, database.db);
    assert.notEqual(current.evidenceHash, first.evidenceHash);
    assert.equal((await approve(actor, current.evidenceHash)).state, "approved_regression");
    await assert.rejects(approve(actor, current.evidenceHash), /stale_or_not_found/);
    const events = await database.db.select().from(auditLog).where(eq(auditLog.action, "riwi.security.reviewed"));
    assert.equal(events.length, 1);
    assert.equal((events[0]?.metadata as Record<string, unknown>).inputHash, current.evidenceHash);
    assert.doesNotMatch(JSON.stringify(events), /password|private transcript|raw audio/);
  } finally { await database.close(); }
});

test("audit failure rolls back the security review instead of leaving an unaudited approval", async () => {
  const database = await createTestDatabase();
  const actor = { id: randomUUID(), role: "owner" as const, accountStatus: "active" as const };
  try {
    await database.db.insert(users).values({ id: actor.id, name: "QA owner", role: "owner", accountStatus: "active" });
    const signal = await recordSecuritySignal({ type: "idor", routeClass: "riwi.chat" }, database.db);
    const preview = await previewSecuritySignal(actor, signal.id, database.db);
    await database.query(`CREATE FUNCTION qa_fail_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'riwi.security.reviewed' THEN RAISE EXCEPTION 'QA audit failure'; END IF; RETURN NEW; END $$`);
    await database.query(`CREATE TRIGGER qa_fail_review_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_review_audit()`);
    await assert.rejects(reviewSecuritySignal({ actor, signalId: signal.id, decision: "approve_regression", regressionFixtureId: "policy-deny-default-v1", regressionEvidenceHash: preview.evidenceHash }, database.db), (error: unknown) => error instanceof Error && error.cause instanceof Error && error.cause.message === "QA audit failure");
    const [stored] = await database.db.select().from(riwiSecuritySignals).where(eq(riwiSecuritySignals.id, signal.id));
    assert.equal(stored?.state, "candidate");
    assert.equal(stored?.regressionEvidenceHash, null);
  } finally { await database.close(); }
});
