import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { riwiSecuritySignals, users } from "../src/db/schema";
import { buildSecuritySignal, listSecuritySignals, recordSecuritySignal, previewSecuritySignal, reviewSecuritySignal, RIWI_SECURITY_SIGNAL_TYPES } from "../src/lib/services/riwi/security-learning";
import { createTestDatabase } from "./support/pglite";

test("security learning creates stable bounded fingerprints without raw attack/audio/transcript", () => {
  const first = buildSecuritySignal({ type: "prompt_injection", actorRole: "student", routeClass: "speaking.submit", tags: ["speaking", "direct"] });
  const second = buildSecuritySignal({ type: "prompt_injection", actorRole: "student", routeClass: "speaking.submit", tags: ["direct", "speaking"] });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.sanitizedEvidence, "prompt_injection; route=speaking.submit; traits=direct,speaking");
  assert.doesNotMatch(first.sanitizedEvidence, /ignore system|raw audio|transcript text|database_url/i);
});

test("security learning rejects arbitrary types, route payloads and tags", () => {
  assert.throws(() => buildSecuritySignal({ type: "shell" as never, routeClass: "riwi.chat" }), /Invalid enum value/);
  assert.throws(() => buildSecuritySignal({ type: "idor", routeClass: "https://attacker.test/?secret=value" }), /Invalid/);
  assert.throws(() => buildSecuritySignal({ type: "idor", routeClass: "riwi.chat", tags: ["raw-payload" as never] }), /Invalid enum value/);
  assert.equal(new Set(RIWI_SECURITY_SIGNAL_TYPES).size, RIWI_SECURITY_SIGNAL_TYPES.length);
});

test("blocked signals deduplicate and only an active persisted owner can review with regression evidence", async () => {
  const database = await createTestDatabase();
  const ownerId = randomUUID(); const studentId = randomUUID();
  const owner = { id: ownerId, role: "owner" as const, accountStatus: "active" as const };
  try {
    await database.db.insert(users).values([
      { id: ownerId, name: "Security owner", role: "owner", accountStatus: "active" },
      { id: studentId, name: "Security student", role: "student", accountStatus: "active" },
    ]);
    const first = await recordSecuritySignal({ type: "prompt_injection", actorRole: "student", routeClass: "riwi.chat", tags: ["direct"] }, database.db as never);
    const second = await recordSecuritySignal({ type: "prompt_injection", actorRole: "student", routeClass: "riwi.chat", tags: ["direct"] }, database.db as never);
    assert.equal(second.id, first.id); assert.equal(second.occurrenceCount, 2);
    const [stored] = await database.db.select().from(riwiSecuritySignals).where(eq(riwiSecuritySignals.id, first.id));
    assert.equal(stored?.sanitizedEvidence, "prompt_injection; route=riwi.chat; traits=direct");
    assert.doesNotMatch(JSON.stringify(stored), /ignore previous|database_url|private transcript/i);
    await assert.rejects(listSecuritySignals({ id: studentId, role: "student", accountStatus: "active" }, database.db as never), /not_found/);
    await assert.rejects(reviewSecuritySignal({ actor: owner, signalId: first.id, decision: "approve_regression" }, database.db as never));
    await assert.rejects(reviewSecuritySignal({ actor: owner, signalId: first.id, decision: "approve_regression", regressionFixtureId: "fixture-1", regressionEvidenceHash: "bad" }, database.db as never));
    const preview = await previewSecuritySignal(owner, first.id, database.db);
    const approved = await reviewSecuritySignal({ actor: owner, signalId: first.id, decision: "approve_regression", regressionFixtureId: "policy-deny-default-v1", regressionEvidenceHash: preview.evidenceHash }, database.db);
    assert.equal(approved.state, "approved_regression");
    await assert.rejects(reviewSecuritySignal({ actor: owner, signalId: first.id, decision: "reject" }, database.db as never), /stale_or_not_found/);
    assert.equal((await listSecuritySignals(owner, database.db as never))[0]?.count, 2);
  } finally { await database.close(); }
});

test("database independently rejects approved regression rows without complete evidence", async () => {
  const database = await createTestDatabase();
  try {
    await assert.rejects(database.db.insert(riwiSecuritySignals).values({
      signalType: "idor", state: "approved_regression", fingerprint: "b".repeat(64), routeClass: "riwi.chat", sanitizedEvidence: "idor; route=riwi.chat; traits=none",
    }));
  } finally { await database.close(); }
});

test("security signal promotion is regression-gated in schema and runtime has no self-modifying primitive", () => {
  const schema = readFileSync(new URL("../src/db/schema.ts", import.meta.url), "utf8");
  assert.match(schema, /riwi_security_signals_promotion_check/);
  assert.match(schema, /regressionFixtureId[\s\S]*regressionEvidenceHash[\s\S]*reviewedByUserId/);
  const tools = readFileSync(new URL("../src/lib/services/riwi/core-tools.ts", import.meta.url), "utf8");
  for (const forbidden of ["shell.exec", "database.rawSql", "source.write", "git.push", "migration.apply"]) assert.doesNotMatch(tools, new RegExp(forbidden.replace(".", "\\.")));
});
