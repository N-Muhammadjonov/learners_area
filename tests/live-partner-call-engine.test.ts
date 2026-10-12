import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LivePartnerCall, type CallStatus } from "../src/lib/live-partner/call-engine";
import { issueSignalToken } from "../src/lib/live-partner/signal-token";
// @ts-expect-error — plain ESM service module
import { createSignalServer } from "../services/live-signal/server.mjs";

/**
 * Two call engines negotiate THROUGH THE REAL signalling service with an
 * app-issued token. RTCPeerConnection/MediaStream are fakes (Node has no
 * WebRTC), so this proves signalling, roles, cleanup and authorization —
 * NOT that audio flows. Two-way audio remains a browser gate.
 */
const SECRET = "z".repeat(40);
const { server } = createSignalServer({ secret: SECRET });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const URL_ = `ws://127.0.0.1:${(server.address() as { port: number }).port}/signal`;
after(() => server.close());

class FakeTrack { enabled = true; stopped = false; onended: (() => void) | null = null; kind = "audio"; stop() { this.stopped = true; } }
class FakeStream { tracks = [new FakeTrack()]; getTracks() { return this.tracks; } getAudioTracks() { return this.tracks; } }
const peers: FakePeer[] = [];
class FakePeer {
  connectionState: RTCPeerConnectionState = "new"; signalingState = "stable"; remoteDescription: unknown = null; localDescription: unknown = null;
  ontrack: ((e: unknown) => void) | null = null; onicecandidate: ((e: unknown) => void) | null = null; onconnectionstatechange: (() => void) | null = null;
  added: unknown[] = []; candidates: unknown[] = []; closed = false; config: RTCConfiguration;
  constructor(config: RTCConfiguration) { this.config = config; peers.push(this); }
  addTrack(t: unknown) { this.added.push(t); }
  async createOffer() { return { type: "offer", sdp: "v=0 offer" }; }
  async createAnswer() { return { type: "answer", sdp: "v=0 answer" }; }
  async setLocalDescription(d: { type: string }) { this.localDescription = d; this.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
    setTimeout(() => this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: "candidate:1 1 udp 1 203.0.113.1 3478 typ relay raddr 0.0.0.0 rport 0", sdpMid: "0" }) } }), 1);
    this.maybeConnect(); }
  async setRemoteDescription(d: unknown) { this.remoteDescription = d; this.signalingState = "stable"; this.maybeConnect(); }
  async addIceCandidate(c: unknown) { this.candidates.push(c); this.maybeConnect(); }
  maybeConnect() { if (this.localDescription && this.remoteDescription && this.candidates.length && this.connectionState !== "connected") {
    this.connectionState = "connected"; this.ontrack?.({ streams: [new FakeStream()], track: new FakeTrack() }); this.onconnectionstatechange?.(); } }
  close() { this.closed = true; this.connectionState = "closed"; }
}

function engine(userId: string, peerId: string, role: "offerer" | "answerer", sessionId = "S-1") {
  const statuses: CallStatus[] = []; const reports: string[] = []; const remote: unknown[] = [];
  const stream = new FakeStream();
  const call = new LivePartnerCall(sessionId, {
    fetchToken: async () => ({ token: (await issueSignalToken({ userId, peerId, sessionId, role }, SECRET))!, url: URL_, role, iceServers: [{ urls: "turns:turn.example.test:5349" }], iceTransportPolicy: "relay" }),
    getUserMedia: async () => stream as unknown as MediaStream,
    createPeer: (c) => new FakePeer(c) as unknown as RTCPeerConnection,
    createSocket: (u) => new WebSocket(u) as unknown as WebSocket,
    report: (s) => reports.push(s), onStatus: (s) => statuses.push(s), onRemoteStream: (s) => remote.push(s),
  });
  return { call, statuses, reports, remote, stream };
}
const until = async (cond: () => boolean, ms = 3_000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 10)); } };

test("offerer/answerer negotiate through the real service; relay-only config; both report connected once; remote stream delivered", async () => {
  peers.length = 0;
  const a = engine("A", "B", "offerer"); const b = engine("B", "A", "answerer");
  await a.call.start(); await b.call.start();
  await until(() => a.statuses.includes("connected") && b.statuses.includes("connected"));
  assert.deepEqual(a.reports, ["connected"]); assert.deepEqual(b.reports, ["connected"]);
  assert.ok(peers.every((p) => p.config.iceTransportPolicy === "relay"));
  assert.ok(a.remote.some(Boolean) && b.remote.some(Boolean));
  a.call.setMuted(true); assert.equal(a.stream.tracks[0]!.enabled, false);
  a.call.setMuted(false); assert.equal(a.stream.tracks[0]!.enabled, true);
  a.call.hangup();
  await until(() => b.call.isDestroyed);
  for (const e of [a, b]) { assert.equal(e.stream.tracks[0]!.stopped, true); assert.equal(e.remote.at(-1), null); assert.equal(e.statuses.at(-1), "ended"); }
  assert.ok(peers.every((p) => p.closed));
});

test("leaving while the microphone prompt is pending still stops the late stream", async () => {
  let resolveMic!: (s: MediaStream) => void; const late = new FakeStream();
  const call = new LivePartnerCall("S-2", {
    fetchToken: async () => ({ token: "t", url: URL_, role: "offerer", iceServers: [], iceTransportPolicy: "relay" }),
    getUserMedia: () => new Promise((r) => { resolveMic = r; }),
    createPeer: () => { throw new Error("must not create a peer after destroy"); },
    createSocket: () => { throw new Error("must not open a socket after destroy"); },
    report: () => {}, onStatus: () => {}, onRemoteStream: () => {},
  });
  const started = call.start();
  await new Promise((r) => setTimeout(r, 5));
  call.destroy();
  resolveMic(late as unknown as MediaStream);
  await started;
  assert.equal(late.tracks[0]!.stopped, true);
});

test("a token for another session/participant is refused by the service and the call fails closed", async () => {
  const statuses: string[] = [];
  const call = new LivePartnerCall("S-3", {
    fetchToken: async () => ({ token: (await issueSignalToken({ userId: "C", peerId: "D", sessionId: "S-3", role: "offerer" }, "w".repeat(40)))!, url: URL_, role: "offerer", iceServers: [], iceTransportPolicy: "relay" }),
    getUserMedia: async () => new FakeStream() as unknown as MediaStream,
    createPeer: (c) => new FakePeer(c) as unknown as RTCPeerConnection,
    createSocket: (u) => new WebSocket(u) as unknown as WebSocket,
    report: () => {}, onStatus: (s) => statuses.push(s), onRemoteStream: () => {},
  });
  await call.start();
  await until(() => call.isDestroyed);
  assert.equal(statuses.at(-1), "failed");
});

test("no recording path: the engine and client never use MediaRecorder or upload audio", () => {
  for (const f of ["src/lib/live-partner/call-engine.ts", "src/components/speaking/LivePartnerClient.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/MediaRecorder|createRecorder|upload/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), f);
  }
});
