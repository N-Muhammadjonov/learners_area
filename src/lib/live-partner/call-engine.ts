/**
 * Live Partner WebRTC call engine (browser). Audio only, relay-only ICE.
 *
 * - Media: one local microphone track → RTCPeerConnection; remote audio track →
 *   a MediaStream handed to the UI for playback. Nothing is recorded, uploaded
 *   or stored (no MediaRecorder here, by design).
 * - Signalling: the standalone service in services/live-signal over WebSocket,
 *   authenticated with a 120 s token the app issues only to the two session
 *   participants. The inviter is always the offerer, so offers never collide.
 * - Resilience: ICE restart on disconnect/failure (bounded), socket rejoin with
 *   a fresh token and backoff (bounded). Transport state is reported to the
 *   server, which owns the call lifecycle and ends calls that do not recover.
 * - Cleanup is total and idempotent: timers, socket, peer connection, tracks.
 */
export type CallStatus = "preparing" | "connecting" | "connected" | "reconnecting" | "failed" | "ended";
export type CallTokenResponse = { token: string; url: string; role: "offerer" | "answerer"; iceServers: RTCIceServer[]; iceTransportPolicy: RTCIceTransportPolicy };
export type CallDeps = {
  fetchToken: (sessionId: string) => Promise<CallTokenResponse>;
  getUserMedia: () => Promise<MediaStream>;
  createPeer: (config: RTCConfiguration) => RTCPeerConnection;
  createSocket: (url: string) => WebSocket;
  report: (status: "connected" | "reconnecting") => void;
  onStatus: (status: CallStatus, detail?: string) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

export const MAX_ICE_RESTARTS = 3;
export const MAX_SOCKET_REJOINS = 5;

export class LivePartnerCall {
  private pc: RTCPeerConnection | null = null;
  private socket: WebSocket | null = null;
  private local: MediaStream | null = null;
  private remote: MediaStream | null = null;
  private role: "offerer" | "answerer" = "answerer";
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private timers = new Set<unknown>();
  private destroyed = false;
  private iceRestarts = 0;
  private rejoins = 0;
  private lastReported: "connected" | "reconnecting" | null = null;
  private status: CallStatus = "preparing";
  private muted = false;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(private readonly sessionId: string, private readonly deps: CallDeps) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  get isDestroyed() { return this.destroyed; }

  async start() {
    this.setStatus("preparing");
    let auth: CallTokenResponse;
    try { auth = await this.deps.fetchToken(this.sessionId); } catch { return this.fail("token"); }
    if (this.destroyed) return;
    let stream: MediaStream;
    try { stream = await this.deps.getUserMedia(); } catch { return this.fail("microphone"); }
    if (this.destroyed) { stream.getTracks().forEach((t) => t.stop()); return; } // left while the prompt was open
    this.local = stream;
    this.applyMute();
    this.role = auth.role;
    const pc = this.deps.createPeer({ iceServers: auth.iceServers, iceTransportPolicy: "relay" });
    this.pc = pc;
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    pc.ontrack = (event) => {
      this.remote = event.streams[0] ?? new MediaStream([event.track]);
      this.deps.onRemoteStream(this.remote);
    };
    pc.onicecandidate = (event) => this.send({ type: "signal", kind: "candidate", data: event.candidate ? event.candidate.toJSON() : null });
    pc.onconnectionstatechange = () => this.onConnectionState(pc.connectionState);
    for (const track of stream.getAudioTracks()) track.onended = () => this.fail("microphone_ended");
    this.setStatus("connecting");
    this.openSocket(auth);
  }

  setMuted(muted: boolean) { this.muted = muted; this.applyMute(); }
  private applyMute() { for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !this.muted; }

  /** User hung up: tell the peer, then release everything. */
  hangup() {
    this.send({ type: "signal", kind: "bye" });
    this.destroy("ended");
  }

  destroy(final: CallStatus = "ended") {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const id of this.timers) this.clearTimer(id);
    this.timers.clear();
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.onerror = null; try { socket.close(1000); } catch { /* already closed */ } }
    const pc = this.pc; this.pc = null;
    if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.onconnectionstatechange = null; try { pc.close(); } catch { /* closed */ } }
    this.local?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.local = null;
    this.remote = null;
    this.deps.onRemoteStream(null);
    this.status = final;
    this.deps.onStatus(final);
  }

  private setStatus(status: CallStatus, detail?: string) {
    if (this.destroyed || this.status === status) return;
    this.status = status;
    this.deps.onStatus(status, detail);
  }
  private report(status: "connected" | "reconnecting") {
    if (this.lastReported === status) return;
    this.lastReported = status;
    this.deps.report(status);
  }
  private fail(reason: string) {
    if (this.destroyed) return;
    this.deps.onStatus("failed", reason);
    this.destroy("failed");
  }
  private later(fn: () => void, ms: number) {
    const id = this.setTimer(() => { this.timers.delete(id); if (!this.destroyed) fn(); }, ms);
    this.timers.add(id);
  }

  private onConnectionState(state: RTCPeerConnectionState) {
    if (state === "connected") { this.iceRestarts = 0; this.setStatus("connected"); this.report("connected"); }
    else if (state === "disconnected") { this.setStatus("reconnecting"); this.report("reconnecting"); this.later(() => this.restartIce(), 2_000); }
    else if (state === "failed") { this.setStatus("reconnecting"); this.report("reconnecting"); this.restartIce(); }
  }

  private async restartIce() {
    const pc = this.pc;
    if (!pc || this.role !== "offerer" || pc.connectionState === "connected") return;
    if (this.iceRestarts >= MAX_ICE_RESTARTS) return this.fail("ice");
    this.iceRestarts++;
    await this.makeOffer(true);
  }

  private async makeOffer(iceRestart = false) {
    const pc = this.pc;
    if (!pc || this.destroyed) return;
    try {
      const offer = await pc.createOffer({ iceRestart, offerToReceiveAudio: true });
      if (this.destroyed) return;
      await pc.setLocalDescription(offer);
      this.send({ type: "signal", kind: "offer", data: { type: offer.type, sdp: offer.sdp } });
    } catch { this.fail("negotiation"); }
  }

  private openSocket(auth: CallTokenResponse) {
    if (this.destroyed) return;
    const socket = this.deps.createSocket(auth.url);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token: auth.token }));
    socket.onmessage = (event) => { void this.onMessage(String(event.data)); };
    socket.onclose = () => {
      if (this.destroyed || this.socket !== socket) return;
      this.socket = null;
      if (this.rejoins >= MAX_SOCKET_REJOINS) return this.fail("signalling");
      const delay = 1_000 * 2 ** this.rejoins++;
      if (this.status === "connected") this.report("reconnecting");
      this.later(async () => {
        try { this.openSocket(await this.deps.fetchToken(this.sessionId)); } catch { this.fail("token"); }
      }, delay);
    };
  }

  private send(message: unknown) {
    const socket = this.socket;
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  private async onMessage(text: string) {
    let msg: { type?: string; kind?: string; data?: unknown; role?: string; peerPresent?: boolean; reason?: string };
    try { msg = JSON.parse(text); } catch { return; }
    const pc = this.pc;
    if (!pc || this.destroyed) return;
    if (msg.type === "ready") {
      this.rejoins = 0;
      if (this.role === "offerer" && msg.peerPresent) await this.makeOffer(pc.connectionState !== "new");
      return;
    }
    if (msg.type === "peer-joined") { if (this.role === "offerer") await this.makeOffer(pc.connectionState !== "new"); return; }
    if (msg.type === "peer-left") { if (this.status === "connected") { this.setStatus("reconnecting"); } return; }
    if (msg.type === "error") { if (msg.reason?.startsWith("token_") || msg.reason === "not_participant") this.fail("unauthorized"); return; }
    if (msg.type !== "signal") return;
    try {
      if (msg.kind === "offer" && this.role === "answerer") {
        await pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
        await this.flushCandidates();
        const answer = await pc.createAnswer();
        if (this.destroyed) return;
        await pc.setLocalDescription(answer);
        this.send({ type: "signal", kind: "answer", data: { type: answer.type, sdp: answer.sdp } });
      } else if (msg.kind === "answer" && this.role === "offerer" && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
        await this.flushCandidates();
      } else if (msg.kind === "candidate") {
        if (!msg.data) return;
        if (pc.remoteDescription) await pc.addIceCandidate(msg.data as RTCIceCandidateInit);
        else if (this.pendingCandidates.length < 50) this.pendingCandidates.push(msg.data as RTCIceCandidateInit);
      } else if (msg.kind === "bye") {
        this.destroy("ended");
      }
    } catch { /* a bad remote candidate must not kill the call; negotiation errors surface via connection state */ }
  }

  private async flushCandidates() {
    const list = this.pendingCandidates; this.pendingCandidates = [];
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => {});
  }
}
