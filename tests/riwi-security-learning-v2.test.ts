import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSecuritySignal, RIWI_SECURITY_SIGNAL_TYPES } from "../src/lib/services/riwi/security-learning";

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

test("security signal promotion is regression-gated in schema and runtime has no self-modifying primitive", () => {
  const schema = readFileSync(new URL("../src/db/schema.ts", import.meta.url), "utf8");
  assert.match(schema, /riwi_security_signals_promotion_check/);
  assert.match(schema, /regressionFixtureId[\s\S]*regressionEvidenceHash[\s\S]*reviewedByUserId/);
  const tools = readFileSync(new URL("../src/lib/services/riwi/core-tools.ts", import.meta.url), "utf8");
  for (const forbidden of ["shell.exec", "database.rawSql", "source.write", "git.push", "migration.apply"]) assert.doesNotMatch(tools, new RegExp(forbidden.replace(".", "\\.")));
});
