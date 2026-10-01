import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { issueSignalToken, realtimeReadiness, resetReadinessCache, signalConfigured, turnCredentials } from "../src/lib/live-partner/signal-token";
// The standalone service's verifier must accept exactly what the app issues.
// @ts-expect-error — plain ESM service module without types
import { verifyToken } from "../services/live-signal/server.mjs";

const SECRET = "k".repeat(40);
const env = {
  LIVE_PARTNER_SIGNAL_SECRET: SECRET, LIVE_PARTNER_SIGNAL_URL: "wss://signal.example.test/signal",
  LIVE_PARTNER_TURN_URLS: "turns:turn.example.test:5349?transport=tcp, turn:turn.example.test:3478, http://bad", LIVE_PARTNER_TURN_SECRET: "t".repeat(32),
} as unknown as NodeJS.ProcessEnv;

test("app-issued token is accepted by the signalling service verifier with both participants", async () => {
  const now = new Date("2026-10-01T10:00:00Z");
  const token = (await issueSignalToken({ userId: "A", peerId: "B", sessionId: "S", role: "offerer" }, SECRET, now))!;
  assert.deepEqual(verifyToken(token, SECRET, now.getTime() / 1000 + 60), { userId: "A", peerId: "B", sessionId: "S", role: "offerer" });
  assert.throws(() => verifyToken(token, SECRET, now.getTime() / 1000 + 121), /expired/);
  assert.throws(() => verifyToken(token, "x".repeat(40), now.getTime() / 1000), /signature/);
});

test("TURN: time-limited coturn REST credentials, relay-only, no permanent secret leaves the server", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  const c = turnCredentials("user-1", env, now)!;
  assert.equal(c.iceTransportPolicy, "relay");
  const server = c.iceServers[0]!;
  assert.deepEqual(server.urls, ["turns:turn.example.test:5349?transport=tcp", "turn:turn.example.test:3478"]);
  assert.equal(server.username, `${now.getTime() / 1000 + 600}:user-1`);
  assert.equal(server.credential, createHmac("sha1", "t".repeat(32)).update(server.username).digest("base64"));
  assert.ok(!JSON.stringify(c).includes("t".repeat(32)));
  assert.equal(turnCredentials("u", { ...env, LIVE_PARTNER_TURN_SECRET: "" } as NodeJS.ProcessEnv), null);
});

test("readiness: env alone is not ready — the service must answer /healthz; failures are cached briefly", async () => {
  resetReadinessCache();
  assert.equal(signalConfigured(env), true);
  assert.deepEqual(await realtimeReadiness({} as NodeJS.ProcessEnv), { ready: false, reason: "not_configured" });
  let calls: string[] = [];
  const down = (async (u: string) => { calls.push(u); throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  assert.deepEqual(await realtimeReadiness(env, down, 1_000), { ready: false, reason: "service_unreachable" });
  assert.deepEqual(calls, ["https://signal.example.test/healthz"]);
  resetReadinessCache(); calls = [];
  const up = (async (u: string) => { calls.push(u); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  assert.deepEqual(await realtimeReadiness(env, up, 2_000), { ready: true });
  await realtimeReadiness(env, up, 3_000);
  assert.equal(calls.length, 1, "cached 30 s");
});
