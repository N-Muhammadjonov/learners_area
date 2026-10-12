import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createSignalServer, signToken, isRelayCandidate } from "./server.mjs";

const SECRET = "s".repeat(40);
const { server, rooms } = createSignalServer({ secret: SECRET, allowedOrigins: [] });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `ws://127.0.0.1:${server.address().port}/signal`;
after(() => server.close());
const exp = () => Math.floor(Date.now() / 1000) + 120;
const tok = (sub, peer, extra = {}) => signToken({ sub, peer, sid: "S1", exp: exp(), role: sub === "A" ? "offerer" : "answerer", ...extra }, SECRET);

function client(token) {
  const ws = new WebSocket(url);
  const inbox = []; const waiters = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiters.findIndex((x) => x.pred(m)); if (w >= 0) waiters.splice(w, 1)[0].res(m); else inbox.push(m); };
  const closed = new Promise((r) => { ws.onclose = (e) => r(e.code); });
  const next = (pred = () => true) => { const i = inbox.findIndex(pred); if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]); return new Promise((res) => waiters.push({ pred, res })); };
  const opened = new Promise((r) => { ws.onopen = () => { if (token) ws.send(JSON.stringify({ type: "auth", token })); r(); }; });
  return { ws, next, closed, opened, send: (o) => ws.send(JSON.stringify(o)) };
}

test("two participants: ready/peer-joined, offer/answer/relay-candidate relayed, host candidate dropped", async () => {
  const a = client(tok("A", "B")); assert.equal((await a.next()).type, "ready");
  const b = client(tok("B", "A")); const rb = await b.next(); assert.equal(rb.type, "ready"); assert.equal(rb.peerPresent, true); assert.equal(rb.role, "answerer");
  assert.equal((await a.next()).type, "peer-joined");
  a.send({ type: "signal", kind: "offer", data: { type: "offer", sdp: "v=0..." } });
  assert.deepEqual(await b.next(), { type: "signal", kind: "offer", data: { type: "offer", sdp: "v=0..." } });
  b.send({ type: "signal", kind: "candidate", data: { candidate: "candidate:1 1 udp 2122260223 192.168.1.5 5000 typ host" } });
  assert.equal((await b.next()).reason, "non_relay_candidate_dropped");
  b.send({ type: "signal", kind: "candidate", data: { candidate: "candidate:2 1 udp 41885439 203.0.113.9 3478 typ relay raddr 0.0.0.0 rport 0" } });
  assert.equal((await a.next()).kind, "candidate");
  a.ws.close(); assert.equal((await b.next()).type, "peer-left");
  b.ws.close(); await b.closed;
});

test("rejects: third user, expired, wrong audience, tampered, no auth, bad message", async () => {
  const a = client(tok("A", "B")); await a.next();
  const c = client(tok("C", "A")); assert.equal((await c.next()).reason, "not_participant"); assert.equal(await c.closed, 4401);
  const e = client(tok("A", "B", { exp: 10 })); assert.equal((await e.next()).reason, "token_expired");
  const w = client(signToken({ sub: "A", peer: "B", sid: "S1", exp: exp(), aud: "other" }, SECRET)); assert.equal((await w.next()).reason, "token_audience");
  const t = tok("A", "B"); const bad = client(t.slice(0, -3) + "AAA"); assert.equal((await bad.next()).reason, "token_signature");
  const ws = client(null); await ws.opened; ws.send({ type: "signal", kind: "offer" }); assert.equal((await ws.next()).reason, "auth_required");
  a.send({ type: "nope" }); assert.equal((await a.next()).reason, "bad_message");
  await a.closed;
});

test("rejoin replaces the stale socket; rate limit closes a flooding client", async () => {
  const a1 = client(tok("A", "B")); await a1.next();
  const a2 = client(tok("A", "B")); await a2.next();
  assert.equal(await a1.closed, 4000);
  for (let i = 0; i < 80; i++) a2.send({ type: "ping" });
  assert.equal((await a2.next((m) => m.type === "error")).reason, "rate_limited");
  await a2.closed;
  assert.equal(rooms.size, 0, "rooms are released when empty");
});

test("relay candidate filter", () => {
  assert.equal(isRelayCandidate(null), true);
  assert.equal(isRelayCandidate({ candidate: "" }), true);
  assert.equal(isRelayCandidate({ candidate: "candidate:1 1 udp 1 10.0.0.1 1 typ srflx" }), false);
});
