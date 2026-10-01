// Learners Area — Live Partner signalling service (WebRTC offer/answer/ICE relay).
//
// Long-running Node process (NOT a Vercel function). Zero dependencies: a small
// RFC 6455 text-frame server on node:http + node:crypto. It never sees audio —
// it only relays SDP and ICE between the two participants a short-lived
// HS256 token names. Rooms live in memory for the lifetime of a call; nothing
// is persisted or logged beyond counters.
//
//   LIVE_PARTNER_SIGNAL_SECRET  ≥32 chars, shared with the app (never the browser)
//   PORT                         default 8787
//   ALLOWED_ORIGINS              comma list of https origins allowed to connect
import http from "node:http";
import crypto from "node:crypto";

export const AUDIENCE = "learners-area-live-signal";
export const ISSUER = "learners-area";
const MAX_MESSAGE = 16 * 1024;
const AUTH_TIMEOUT_MS = 5_000;
const RATE = { capacity: 60, refillPerSec: 6 };
const RELAY_TYPES = new Set(["offer", "answer", "candidate", "bye", "restart"]);

const b64u = (buf) => Buffer.from(buf).toString("base64url");
export function verifyToken(token, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string" || token.length > 2048) throw new Error("malformed");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  if (header.alg !== "HS256") throw new Error("alg");
  const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, "base64url");
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) throw new Error("signature");
  const c = JSON.parse(Buffer.from(p, "base64url").toString());
  if (c.aud !== AUDIENCE || c.iss !== ISSUER) throw new Error("audience");
  if (typeof c.exp !== "number" || c.exp <= nowSec) throw new Error("expired");
  if (typeof c.sub !== "string" || typeof c.sid !== "string" || typeof c.peer !== "string" || c.sub === c.peer) throw new Error("claims");
  return { userId: c.sub, sessionId: c.sid, peerId: c.peer, role: c.role === "offerer" ? "offerer" : "answerer" };
}
/** Test helper mirroring the app's issuer. */
export function signToken(claims, secret) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ aud: AUDIENCE, iss: ISSUER, ...claims }));
  return `${h}.${p}.${b64u(crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest())}`;
}

/** Privacy: only TURN relay candidates may cross (no host/srflx IPs leak to a stranger). */
export function isRelayCandidate(candidate) {
  if (candidate == null) return true; // end-of-candidates
  const line = typeof candidate === "object" ? candidate.candidate : null;
  if (line === "") return true;
  return typeof line === "string" && line.length < 1024 && / typ relay( |$)/.test(line);
}

// ---------- minimal RFC 6455 ----------
function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = data.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]) : null;
  if (!head) throw new Error("frame too large");
  return Buffer.concat([head, data]);
}
class Conn {
  constructor(socket, onMessage, onClose) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.closed = false; this.fragments = null;
    this.onMessage = onMessage; this.onClose = onClose;
    socket.on("data", (chunk) => this.#read(chunk));
    socket.on("close", () => this.#finish());
    socket.on("error", () => this.#finish());
  }
  send(obj) { if (!this.closed) this.socket.write(encodeFrame(1, JSON.stringify(obj))); }
  close(code = 1000, reason = "") {
    if (this.closed) return;
    const r = Buffer.from(reason.slice(0, 100));
    const p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code, 0); r.copy(p, 2);
    try { this.socket.write(encodeFrame(8, p)); } catch {}
    this.socket.end(); this.#finish();
  }
  #finish() { if (this.closed) return; this.closed = true; this.socket.destroy(); this.onClose(this); }
  #read(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length > MAX_MESSAGE * 2) return this.close(1009, "too big");
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (!masked) return this.close(1002, "unmasked");
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) return this.close(1009, "too big");
      if (len > MAX_MESSAGE) return this.close(1009, "too big");
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (opcode === 8) return this.close(1000);
      if (opcode === 9) { this.socket.write(encodeFrame(10, payload)); continue; }
      if (opcode === 10) continue;
      if (opcode === 1 || opcode === 0) {
        this.fragments = opcode === 1 ? [payload] : [...(this.fragments ?? []), payload];
        if (Buffer.concat(this.fragments).length > MAX_MESSAGE) return this.close(1009, "too big");
        if (fin) { const text = Buffer.concat(this.fragments).toString("utf8"); this.fragments = null; this.onMessage(this, text); }
        continue;
      }
      return this.close(1003, "unsupported");
    }
  }
}

export function createSignalServer({ secret, allowedOrigins = [], now = () => Date.now() } = {}) {
  if (!secret || secret.length < 32) throw new Error("LIVE_PARTNER_SIGNAL_SECRET must be at least 32 characters");
  const rooms = new Map(); // sessionId -> { allowed:Set, members: Map<userId, Conn> }
  const stats = { connections: 0, rejected: 0, relayed: 0 };

  function leave(conn) {
    const room = conn.sessionId && rooms.get(conn.sessionId);
    if (!room || room.members.get(conn.userId) !== conn) return;
    room.members.delete(conn.userId);
    for (const other of room.members.values()) other.send({ type: "peer-left" });
    if (room.members.size === 0) rooms.delete(conn.sessionId);
  }
  function reject(conn, reason) { stats.rejected++; conn.send({ type: "error", reason }); conn.close(4401, reason); }

  function onMessage(conn, text) {
    let msg; try { msg = JSON.parse(text); } catch { return reject(conn, "bad_json"); }
    if (!conn.userId) {
      if (msg?.type !== "auth") return reject(conn, "auth_required");
      let claims; try { claims = verifyToken(msg.token, secret, Math.floor(now() / 1000)); } catch (e) { return reject(conn, `token_${e.message}`); }
      let room = rooms.get(claims.sessionId);
      if (!room) { room = { allowed: new Set([claims.userId, claims.peerId]), members: new Map() }; rooms.set(claims.sessionId, room); }
      if (!room.allowed.has(claims.userId) || !room.allowed.has(claims.peerId)) return reject(conn, "not_participant");
      clearTimeout(conn.authTimer);
      Object.assign(conn, claims, { tokens: RATE.capacity, last: now() });
      const previous = room.members.get(claims.userId);
      room.members.set(claims.userId, conn); // rejoin replaces the stale socket
      if (previous && previous !== conn) previous.close(4000, "replaced");
      conn.send({ type: "ready", role: claims.role, peerPresent: room.members.size === 2 });
      for (const [id, other] of room.members) if (id !== claims.userId) other.send({ type: "peer-joined" });
      return;
    }
    const t = now(); conn.tokens = Math.min(RATE.capacity, conn.tokens + ((t - conn.last) / 1000) * RATE.refillPerSec); conn.last = t;
    if (conn.tokens < 1) return reject(conn, "rate_limited");
    conn.tokens -= 1;
    if (msg?.type === "ping") return conn.send({ type: "pong" });
    if (msg?.type !== "signal" || !RELAY_TYPES.has(msg.kind)) return reject(conn, "bad_message");
    if (msg.kind === "candidate" && !isRelayCandidate(msg.data)) return conn.send({ type: "error", reason: "non_relay_candidate_dropped" });
    if ((msg.kind === "offer" || msg.kind === "answer") && (typeof msg.data?.sdp !== "string" || msg.data.sdp.length > 12_000)) return reject(conn, "bad_sdp");
    const room = rooms.get(conn.sessionId);
    for (const [id, other] of room?.members ?? []) if (id !== conn.userId) { other.send({ type: "signal", kind: msg.kind, data: msg.data ?? null }); stats.relayed++; }
  }

  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
    res.writeHead(404); res.end();
  });
  server.on("upgrade", (req, socket) => {
    const origin = req.headers.origin;
    const key = req.headers["sec-websocket-key"];
    if (new URL(req.url, "http://x").pathname !== "/signal" || !key || (allowedOrigins.length && !allowedOrigins.includes(origin))) {
      stats.rejected++; socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return;
    }
    const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    stats.connections++;
    const conn = new Conn(socket, onMessage, leave);
    conn.authTimer = setTimeout(() => { if (!conn.userId) reject(conn, "auth_timeout"); }, AUTH_TIMEOUT_MS);
  });
  return { server, rooms, stats };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server } = createSignalServer({
    secret: process.env.LIVE_PARTNER_SIGNAL_SECRET,
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  });
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, "0.0.0.0", () => console.log(`live-signal listening on ${port}`));
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
}
