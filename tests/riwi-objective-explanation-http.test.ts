import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { handleObjectiveExplanation } from "../src/lib/services/riwi/objective-explanation-http";

const user = { id: randomUUID(), role: "student" as const, accountStatus: "active" as const, name: "QA", email: null, locale: "en", onboarded: true, statusReason: null };
const allow = () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 });
const input = { domain: "reading", attemptId: randomUUID(), questionId: randomUUID() };
const request = (body: unknown, origin = "https://qa.invalid") => new NextRequest("https://qa.invalid/api/riwi/objective-explanation", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });

test("HTTP explanation rejects cross origin, anonymous, oversized and injected bodies before dispatch", async () => {
  let invoked = 0;
  const deps = { getUser: async () => user, consumeIp: allow, consumeAccount: allow, explain: async () => { invoked++; return { ok: false as const, code: "locked" as const }; } };
  assert.equal((await handleObjectiveExplanation(request(input, "https://foreign.invalid"), deps)).status, 403);
  const anonymous = await handleObjectiveExplanation(request(input), { ...deps, getUser: async () => null });
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("cache-control")!, /private, no-store/);
  assert.equal((await handleObjectiveExplanation(request(input), { ...deps, getUser: async () => ({ ...user, accountStatus: "pending" as const }) })).status, 403);
  assert.equal((await handleObjectiveExplanation(request({ ...input, instruction: "x".repeat(1100) }), deps)).status, 413);
  assert.equal((await handleObjectiveExplanation(request({ ...input, actor: { role: "owner" }, correctAnswer: "override" }), deps)).status, 400);
  assert.equal(invoked, 0);
});

test("HTTP result denies active exams, masks internal provider/database detail and prevents caching", async () => {
  const deps = { getUser: async () => user, consumeIp: allow, consumeAccount: allow, explain: async () => ({ ok: false as const, code: "locked" as const }) };
  const response = await handleObjectiveExplanation(request(input), deps);
  assert.equal(response.status, 403);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  const failed = await handleObjectiveExplanation(request(input), { ...deps, explain: async () => { throw new Error("DATABASE_URL=postgres://private secret"); } });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /postgres|private secret|DATABASE_URL/);
});
