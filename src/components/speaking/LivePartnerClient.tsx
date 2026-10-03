"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { filterQuestions, type QuestionRow } from "@/lib/live-partner/questions";
import { LIVE_PARTNER_RULES_VERSION } from "@/lib/live-partner/rules";
import { LivePartnerCall, type CallStatus, type CallTokenResponse } from "@/lib/live-partner/call-engine";

type Person = { userId: string; name: string; avatar: "a" | "b"; speakingScore: number | null };
type Payload = {
  state: "offline" | "available" | "outgoing_invite" | "incoming_invite" | "connecting" | "in_call" | "reconnecting";
  rulesAccepted: boolean; sessionId: string | null; partner: Person | null;
  incoming: { id: string; from: Person; expiresAt: string } | null;
  outgoing: { id: string; toUserId: string; expiresAt: string } | null;
  online: Person[]; realtime: { ready: boolean; reason?: string }; serverNow: string;
};
type Flow = "none" | "rules" | "mic";
type MicStatus = "unknown" | "checking" | "ok" | "denied" | "missing" | "unsupported" | "error";

const POLL_MS = 4_000;
const HEARTBEAT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8_000;
const score = (s: number | null) => (s == null ? "S —" : `S ${s.toFixed(1)}`);
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function Avatar({ kind, label, large = false }: { kind: "a" | "b"; label: string; large?: boolean }) {
  // Exactly two system avatar styles; no uploads.
  return <span role="img" aria-label={label} className={`flex ${large ? "h-24 w-24 text-4xl" : "h-10 w-10 text-lg"} shrink-0 items-center justify-center rounded-full ${kind === "b" ? "bg-rose-100" : "bg-sky-100"}`}>{kind === "b" ? "👩" : "👨"}</span>;
}

function micErrorStatus(error: unknown): MicStatus {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  return "error";
}

export function LivePartnerClient({ dict, me, questions }: {
  dict: Dictionary;
  me: { name: string; avatar: "a" | "b"; hasGender: boolean; speakingScore: number | null };
  questions: QuestionRow[];
}) {
  const t = dict.livePartner;
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [flow, setFlow] = useState<Flow>("none");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<"part1" | "part2" | "part3" | null>("part1");
  const [level, setLevel] = useState(0);
  const [mic, setMic] = useState<MicStatus>("unknown");
  const [callStatus, setCallStatus] = useState<CallStatus | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [partnerMuted, setPartnerMuted] = useState(false);
  const grouped = useMemo(() => filterQuestions(questions, query), [questions, query]);

  // ---- request discipline -------------------------------------------------
  const alive = useRef(true);
  const pollCtl = useRef<AbortController | null>(null);   // at most one GET in flight
  const actionInFlight = useRef(false);                   // synchronous single-flight for user actions
  const heartbeatInFlight = useRef(false);
  const generation = useRef(0);                           // newer writes win over late responses
  const controllers = useRef(new Set<AbortController>());

  const tracked = useCallback(() => {
    const ctl = new AbortController();
    controllers.current.add(ctl);
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    return { ctl, done: () => { clearTimeout(timer); controllers.current.delete(ctl); } };
  }, []);
  const accept = useCallback((payload: Payload, gen: number) => {
    if (!alive.current || gen < generation.current) return; // late response for an older view
    generation.current = gen;
    setData(payload);
  }, []);

  const refresh = useCallback(async () => {
    if (pollCtl.current) return;                          // never stack polls
    const gen = generation.current;
    const { ctl, done } = tracked();
    pollCtl.current = ctl;
    try {
      const res = await fetch("/api/live-partner", { cache: "no-store", signal: ctl.signal });
      if (res.ok) { accept(await res.json(), gen); if (alive.current) setError(""); }
      else if (alive.current) setError(t.errors.unavailable);
    } catch { if (alive.current && !ctl.signal.aborted) setError(t.errors.unavailable); }
    finally { done(); if (pollCtl.current === ctl) pollCtl.current = null; }
  }, [accept, tracked, t]);

  // One explicit POST per user action — never auto-retried; an unknown result is re-read from the server.
  const act = useCallback(async (body: Record<string, unknown>) => {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setBusy(true);
    const gen = ++generation.current;
    pollCtl.current?.abort();                             // a poll started before this action is stale
    const { ctl, done } = tracked();
    try {
      const res = await fetch("/api/live-partner", { ...json(body), signal: ctl.signal });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) { accept(payload, gen); if (alive.current) setError(""); return true; }
      if (alive.current) setError((t.errors as Record<string, string>)[payload.error] ?? t.errors.unavailable);
      void refresh();
      return false;
    } catch {
      if (alive.current && !ctl.signal.aborted) setError(t.errors.unknownResult);
      void refresh();
      return false;
    } finally {
      done(); actionInFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }, [accept, refresh, tracked, t]);

  useEffect(() => {
    alive.current = true;
    const controllerSet = controllers.current;
    void refresh();
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    return () => { alive.current = false; clearInterval(poll); for (const c of controllerSet) c.abort(); controllerSet.clear(); };
  }, [refresh]);

  const state = data?.state ?? "offline";
  useEffect(() => {
    if (state === "offline") return;
    const beat = setInterval(() => {
      if (heartbeatInFlight.current) return;              // bounded: one heartbeat at a time, 8 s cap
      heartbeatInFlight.current = true;
      const { ctl, done } = tracked();
      void fetch("/api/live-partner", { ...json({ action: "heartbeat" }), signal: ctl.signal }).catch(() => {}).finally(() => { done(); heartbeatInFlight.current = false; });
    }, HEARTBEAT_MS);
    return () => clearInterval(beat);
  }, [state, tracked]);

  // ---- mic preflight (local level meter only) ------------------------------
  const micRef = useRef<{ stream: MediaStream | null; ctx: AudioContext | null; raf: number; cancelled: boolean } | null>(null);
  const stopMic = useCallback(() => {
    const m = micRef.current; micRef.current = null;
    if (!m) return;
    m.cancelled = true;
    cancelAnimationFrame(m.raf);
    m.stream?.getTracks().forEach((tr) => tr.stop());
    void m.ctx?.close().catch(() => {});
  }, []);
  useEffect(() => stopMic, [stopMic]);

  async function startPreflight() {
    stopMic();
    setFlow("mic"); setMic("checking"); setLevel(0); setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") { setMic("unsupported"); return; }
    const handle = { stream: null as MediaStream | null, ctx: null as AudioContext | null, raf: 0, cancelled: false };
    micRef.current = handle;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      handle.stream = stream;
      if (handle.cancelled || !alive.current) { stream.getTracks().forEach((tr) => tr.stop()); return; } // closed while the prompt was open
      stream.getAudioTracks()[0]?.addEventListener("ended", () => { if (micRef.current === handle) setMic("error"); });
      const ctx = new AudioContext();
      handle.ctx = ctx;
      const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (handle.cancelled) return;
        analyser.getByteTimeDomainData(buf);
        let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        const l = Math.min(1, peak / 64); setLevel(l); if (l > 0.08) setMic("ok");
        handle.raf = requestAnimationFrame(tick);
      };
      handle.raf = requestAnimationFrame(tick);
    } catch (e) {
      // AudioContext or getUserMedia failed: never leave a captured track open.
      handle.stream?.getTracks().forEach((tr) => tr.stop());
      void handle.ctx?.close().catch(() => {});
      if (micRef.current === handle) micRef.current = null;
      if (alive.current) setMic(micErrorStatus(e));
    }
  }

  async function goOnline() {
    if (!me.hasGender) { setError(t.errors.profile_incomplete); return; }
    if (!data?.realtime.ready) { setError(t.realtimeMissing); return; }
    if (!data.rulesAccepted) { setFlow("rules"); return; }
    await startPreflight();
  }
  async function acceptRules() {
    if (await act({ action: "accept_rules", version: LIVE_PARTNER_RULES_VERSION })) await startPreflight();
  }
  function closeFlow() { stopMic(); setFlow("none"); }
  async function finishPreflight() { closeFlow(); await act({ action: "go_online" }); }

  // ---- the call -------------------------------------------------------------
  const inCall = state === "connecting" || state === "in_call" || state === "reconnecting";
  const sessionId = inCall ? data?.sessionId ?? null : null;
  const callRef = useRef<LivePartnerCall | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    const call = new LivePartnerCall(sessionId, {
      fetchToken: async (sid) => {
        const res = await fetch("/api/live-partner", { ...json({ action: "signal_token", sessionId: sid }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as CallTokenResponse;
      },
      getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }),
      createPeer: (config) => new RTCPeerConnection(config),
      createSocket: (url) => new WebSocket(url),
      report: (status) => { void fetch("/api/live-partner", { ...json({ action: "connection", sessionId, status }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(() => {}); },
      onStatus: (status, detail) => {
        if (!alive.current) return;
        setCallStatus(status);
        if (status === "failed") {
          setError(detail === "microphone" || detail === "microphone_ended" ? t.errors.mic : t.callFailed);
          void fetch("/api/live-partner", {...json({ action: "hangup", sessionId }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)}).catch(() => {}).finally(() => void refresh());
        }
      },
      onRemoteStream: (stream) => {
        const el = audioRef.current;
        if (!el) return;
        el.srcObject = stream;
        if (stream) void el.play().catch(() => { if (alive.current) setError(t.tapToPlay); });
      },
    });
    callRef.current = call;
    setMicMuted(false); setPartnerMuted(false);
    void call.start();
    return () => { call.destroy(); if (callRef.current === call) callRef.current = null; setCallStatus(null); };
  }, [sessionId, refresh, t]);

  async function endCall(alsoBlock?: string) {
    const sid = data?.sessionId;
    callRef.current?.hangup();
    if (alsoBlock) await act({ action: "block", userId: alsoBlock });
    if (sid) await act({ action: "hangup", sessionId: sid });
  }

  // ---- dialog a11y: focus in, Tab trap, Escape, focus restore ------------------
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (flow === "none") return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    node?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeFlow(); return; }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>("button:not([disabled]),[href],input,[tabindex]:not([tabindex='-1'])")];
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); lastFocus.current?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeFlow is stable in effect; re-run only when the dialog changes
  }, [flow]);

  const callLabel = callStatus === "connected" ? t.callStates.connected : callStatus === "reconnecting" ? t.callStates.reconnecting : t.callStates.connecting;

  return (
    <div className="live-partner-workspace flex flex-col gap-3" data-live-partner-state={state}>
      {error ? <p role="alert" className="rounded-sm border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{error}</p> : null}
      {data && !data.realtime.ready ? <p className="rounded-sm border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" data-realtime-unavailable>{t.realtimeMissing}</p> : null}
      {data?.incoming ? (
        <div role="alertdialog" aria-label={t.incomingTitle} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-paper p-3">
          <Avatar kind={data.incoming.from.avatar} label={t.avatar} />
          <p className="flex-1 text-sm"><strong>{data.incoming.from.name}</strong> · {score(data.incoming.from.speakingScore)} — {t.incomingBody}</p>
          <button type="button" disabled={busy} className="btn-primary" onClick={() => act({ action: "accept", inviteId: data.incoming!.id })}>{t.accept}</button>
          <button type="button" disabled={busy} className="btn-secondary" onClick={() => act({ action: "decline", inviteId: data.incoming!.id })}>{t.decline}</button>
        </div>
      ) : null}

      <audio ref={audioRef} autoPlay muted={partnerMuted} className="hidden" aria-hidden="true" />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr_1fr]">
        <section aria-labelledby="lp-you" className="lp-panel lp-self flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4">
          <h2 id="lp-you" className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t.you}</h2>
          <div className="flex items-center gap-3">
            <Avatar kind={me.avatar} label={t.avatar} large />
            <div><p className="font-medium text-ink-900">{me.name}</p><p className="font-mono text-sm text-ink-600">{score(me.speakingScore)}</p></div>
          </div>
          <p className="text-xs text-ink-500">{t.micStatus}: {t.mic[mic]}</p>
          <p className="text-sm text-ink-600" aria-live="polite">{t.states[state]}</p>
          {state === "offline" ? <button type="button" disabled={busy || !data || !data.realtime.ready} className="btn-primary" onClick={goOnline}>{t.goOnline}</button> : null}
          {state === "available" ? <button type="button" disabled={busy} className="btn-secondary" onClick={() => act({ action: "go_offline" })}>{t.goOffline}</button> : null}
          {data?.outgoing ? <button type="button" disabled={busy} className="btn-secondary" onClick={() => act({ action: "cancel", inviteId: data.outgoing!.id })}>{t.cancelInvite}</button> : null}
          {inCall ? <button type="button" aria-pressed={micMuted} className="btn-secondary" onClick={() => { const next = !micMuted; setMicMuted(next); callRef.current?.setMuted(next); }}>{micMuted ? t.unmuteMic : t.muteMic}</button> : null}
        </section>

        <section aria-labelledby="lp-q" className="lp-panel lp-questions flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4">
          <h2 id="lp-q" className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t.questions}</h2>
          <p className="text-xs text-ink-500">{t.questionsOptional}</p>
          <label className="text-sm"><span className="sr-only">{t.search}</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} className="w-full rounded-sm border border-ink-200 px-3 py-2" />
          </label>
          {(["part1", "part2", "part3"] as const).map((part) => (
            <div key={part} data-practice-part={part} className="practice-part-card relative overflow-hidden rounded-2xl border border-ink-100">
              <button type="button" aria-expanded={open === part} aria-controls={`lp-${part}`} onClick={() => setOpen(open === part ? null : part)} className="relative flex min-h-28 w-full items-center justify-between gap-3 px-5 py-4 text-left font-medium">
                <span className="flex flex-col gap-2"><span className="practice-part-label text-xs font-bold uppercase tracking-widest">{t.parts[part]}</span><span className="font-display text-xl font-bold">{dict.speakingPractice.partTitle[part]}</span><span className="text-xs text-ink-500">{dict.speakingPractice.partBody[part]}</span></span><span className="text-xs text-ink-500">{grouped[part].length} <span aria-hidden="true">{open === part ? "▲" : "▼"}</span></span>
              </button>
              {open === part ? (
                <ul id={`lp-${part}`} className="max-h-96 overflow-y-auto border-t border-ink-100 text-sm">
                  {grouped[part].length === 0 ? <li className="px-3 py-2 text-ink-500">{t.noQuestions}</li> : grouped[part].map((q) => (
                    <li key={q.id} className="border-b border-ink-50 px-3 py-2">
                      {q.topic ? <p className="text-xs text-ink-500">{q.topic}</p> : null}
                      <p className="whitespace-pre-line text-ink-900">{q.promptText}</p>
                      {q.cueCard ? <p className="mt-1 whitespace-pre-line text-xs text-ink-600">{q.cueCard}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </section>

        {inCall && data?.partner ? (
          <section aria-labelledby="lp-partner" className="lp-panel lp-peer flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4">
            <h2 id="lp-partner" className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t.partner}</h2>
            <div className="flex items-center gap-3"><Avatar kind={data.partner.avatar} label={t.avatar} large /><div><p className="font-medium">{data.partner.name}</p><p className="font-mono text-sm">{score(data.partner.speakingScore)}</p></div></div>
            <p className="text-sm" aria-live="polite" data-call-status={callStatus ?? "connecting"}>{callLabel}</p>
            <button type="button" aria-pressed={partnerMuted} className="btn-secondary" onClick={() => setPartnerMuted((m) => !m)}>{partnerMuted ? t.unmutePartner : t.mutePartner}</button>
            <button type="button" disabled={busy} className="btn-primary" onClick={() => endCall()}>{t.choosePartner}</button>
            <button type="button" disabled={busy} className="btn-ghost btn-sm" onClick={() => endCall(data.partner!.userId)}>{t.block}</button>
          </section>
        ) : (
          <section aria-labelledby="lp-online" className="lp-panel lp-peer flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4">
            <h2 id="lp-online" className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t.onlineUsers}</h2>
            {!data ? <p className="text-sm text-ink-500">{t.loading}</p> : data.online.length === 0 ? <p className="text-sm text-ink-500">{t.nobodyOnline}</p> : (
              <ul className="flex flex-col gap-2">
                {data.online.map((p) => (
                  <li key={p.userId} className="flex items-center gap-2">
                    <Avatar kind={p.avatar} label={t.avatar} />
                    <div className="flex-1"><p className="text-sm font-medium">{p.name}</p><p className="font-mono text-xs text-ink-600">{score(p.speakingScore)}</p></div>
                    <button type="button" disabled={busy || state !== "available"} className="btn-secondary btn-sm" onClick={() => act({ action: "invite", toUserId: p.userId })}>{t.invite}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {flow !== "none" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) closeFlow(); }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="lp-flow" className="w-full max-w-md rounded-lg bg-paper p-5 shadow-lg">
            {flow === "rules" ? (
              <>
                <h2 id="lp-flow" className="font-display text-lg">{t.rulesTitle}</h2>
                <ul className="my-3 list-disc pl-5 text-sm text-ink-700">{t.rules.map((r) => <li key={r}>{r}</li>)}</ul>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={closeFlow}>{t.close}</button>
                  <button type="button" disabled={busy} className="btn-primary" onClick={acceptRules}>{t.agree}</button>
                </div>
              </>
            ) : (
              <>
                <h2 id="lp-flow" className="font-display text-lg">{t.micTitle}</h2>
                <p className="my-2 text-sm text-ink-600">{t.micBody}</p>
                <div role="meter" aria-label={t.micLevel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} className="h-3 w-full overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
                <p className="mt-2 text-xs text-ink-600" aria-live="polite">{t.mic[mic]}</p>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={closeFlow}>{t.close}</button>
                  {mic === "denied" || mic === "missing" || mic === "error" ? <button type="button" className="btn-secondary" onClick={startPreflight}>{t.retryMic}</button> : null}
                  <button type="button" disabled={mic !== "ok" || busy} className="btn-primary" onClick={finishPreflight}>{t.micReady}</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
