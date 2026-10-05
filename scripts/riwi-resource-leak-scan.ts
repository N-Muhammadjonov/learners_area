import assert from "node:assert/strict";
import { buildSecuritySignal } from "../src/lib/services/riwi/security-learning";
import { stableJson, sha256 } from "../src/lib/portability/archive";
import { buildAiSessionPlan } from "../src/lib/speaking/ai-session";

type ProcessHandles = NodeJS.Process & { _getActiveHandles(): unknown[]; _getActiveRequests(): unknown[] };
const runtime = process as ProcessHandles;
const baselineHandles = runtime._getActiveHandles().length;
const baselineRequests = runtime._getActiveRequests().length;
for (let index = 0; index < 10_000; index += 1) {
  const signal = buildSecuritySignal({ type: "prompt_injection", actorRole: "student", routeClass: "riwi.chat", tags: ["direct"] });
  assert.equal(signal.fingerprint.length, 64);
  assert.equal(sha256(stableJson({ index, signal: signal.fingerprint })).length, 64);
}
const prompts = Array.from({ length: 30 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  part: index < 12 ? "part1" : index < 16 ? "part2" : "part3",
  topic: index < 12 ? (index < 6 ? "work" : "home") : "technology",
}));
for (let index = 0; index < 2_000; index += 1) buildAiSessionPlan(prompts, "full", { seed: `seed-${index}` });
await new Promise((resolve) => setImmediate(resolve));
const finalHandles = runtime._getActiveHandles().length;
const finalRequests = runtime._getActiveRequests().length;
assert.ok(finalHandles <= baselineHandles + 1, `active handles grew ${baselineHandles} -> ${finalHandles}`);
assert.ok(finalRequests <= baselineRequests, `active requests grew ${baselineRequests} -> ${finalRequests}`);
console.log(JSON.stringify({ iterations: 12_000, baselineHandles, finalHandles, baselineRequests, finalRequests, status: "PASS" }));
