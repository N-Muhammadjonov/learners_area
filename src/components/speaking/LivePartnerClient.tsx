"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
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

function Avatar({ kind, label, large = false, userId }: { kind: "a" | "b"; label: string; large?: boolean; userId?: string }) {
  const [failed, setFailed] = useState(false);
  return <span role="img" aria-label={label} className={`flex ${large ? "h-36 w-36 text-6xl" : "h-10 w-10 text-lg"} shrink-0 overflow-hidden items-center justify-center rounded-full ${kind === "b" ? "bg-rose-100" : "bg-sky-100"}`}>
    {userId && !failed ? <Image src={`/api/profile/photo/${userId}`} alt={label} width={large ? 144 : 40} height={large ? 144 : 40} unoptimized className="h-full w-full object-cover" onError={() => setFailed(true)} /> : kind === "b" ? "👩‍🎓" : "👨‍🎓"}
  </span>;
}

function micErrorStatus(error: unknown): MicStatus {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  return "error";
}

export function LivePartnerClient({ dict, me, questions }: {
  dict: Dictionary;
  me: { userId?: string; name: string; avatar: "a" | "b"; hasGender: boolean; speakingScore: number | null };
  questions: QuestionRow[];
}) {
  const t = dict.livePartner;
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [flow, setFlow] = useState<Flow>("none");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<"part1" | "part2" | "part3" | null>("part1");
  const [selectedTopic, setSelectedTopic] = useState<{ part: "part1" | "part2" | "part3"; topic: string | null } | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [level, setLevel] = useState(0);
  const [mic, setMic] = useState<MicStatus>("unknown");
  const [callStatus, setCallStatus] = useState<CallStatus | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [partnerMuted, setPartnerMuted] = useState(false);
  // The room receives one bounded page of prompts. Filtering only that page in the
  // browser would hide every prompt past it, so a typed query is answered by the server
  // against the whole published bank. Search alone is not enough either: one broad term
  // can match more prompts than fit a page, so the result is walked with a keyset
  // cursor. Requests are sequenced, failures are shown with a retry rather than being
  // swallowed into a stale list, and an empty result is distinguished from "not asked".
  const [remoteQuestions, setRemoteQuestions] = useState<QuestionRow[] | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "success" | "empty" | "error">("idle");
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const searchTicket = useRef(0);

  const runQuestionSearch = useCallback(async (term: string, cursor: string | null) => {
    // Every request takes a ticket; only the newest may write state. A slow reply for an
    // abandoned term can therefore never be presented as this term's results, and can
    // never overwrite a newer response that already landed.
    const ticket = ++searchTicket.current;
    setSearchState("loading");
    try {
      const params = new URLSearchParams({ q: term });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/speaking/live-partner/questions?${params.toString()}`);
      if (ticket !== searchTicket.current) return;
      if (!res.ok) { setSearchState("error"); return; }
      const payload = (await res.json()) as { questions?: QuestionRow[]; nextCursor?: string | null };
      if (ticket !== searchTicket.current) return;
      const batch = payload.questions ?? [];
      const merged = cursor && remoteQuestions ? [...remoteQuestions, ...batch] : batch;
      setRemoteQuestions(merged);
      setSearchCursor(payload.nextCursor ?? null);
      setSearchState(merged.length === 0 ? "empty" : "success");
    } catch {
      if (ticket === searchTicket.current) setSearchState("error");
    }
  }, [remoteQuestions]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      // Abandon anything in flight so a late reply cannot repopulate a cleared box.
      searchTicket.current += 1;
      setRemoteQuestions(null);
      setSearchCursor(null);
      setSearchState("idle");
      return;
    }
    const timer = setTimeout(() => { void runQuestionSearch(term, null); }, 250);
    return () => clearTimeout(timer);
    // runQuestionSearch is intentionally excluded: it changes identity whenever the
    // accumulated results change, which would restart the search mid-walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchAttempt]);

  const pool = remoteQuestions ?? questions;
  const grouped = useMemo(() => filterQuestions(pool, query), [pool, query]);

  // A chosen topic must survive a later search. The questions behind it are kept from
  // whichever pool they were chosen in, so typing cannot blank an open prompt.
  const topicQuestions = selectedTopic
    ? (() => {
        const fromPool = pool.filter(q => q.part === selectedTopic.part && q.topic === selectedTopic.topic);
        if (fromPool.length > 0) return fromPool;
        return questions.filter(q => q.part === selectedTopic.part && q.topic === selectedTopic.topic);
      })()
    : [];
  const selectedQuestion = topicQuestions[Math.min(questionIndex, Math.max(0, topicQuestions.length - 1))];

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

  const entryAttempted = useRef(false);
  const latestPresence = useRef(data);
  latestPresence.current = data;
  useEffect(() => {
    if (!data || entryAttempted.current || data.state !== "offline" || !data.realtime.ready) return;
    entryAttempted.current = true;
    if (!me.hasGender) { setError(t.errors.profile_incomplete); return; }
    if (!data.rulesAccepted) { setFlow("rules"); return; }
    void act({ action: "go_online" });
  }, [data, me.hasGender, act, t]);
  useEffect(() => () => {
    const presence = latestPresence.current;
    if (!presence || presence.state === "offline") return;
    // Release presence when leaving this route, including a call in progress.
    const leave = async () => {
      if (presence.sessionId) await fetch("/api/live-partner", { ...json({ action: "hangup", sessionId: presence.sessionId }), keepalive: true, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(() => {});
      await fetch("/api/live-partner", { ...json({ action: "go_offline" }), keepalive: true, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(() => {});
    };
    void leave();
  }, []);

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

  async function acceptRules() {
    if (await act({ action: "accept_rules", version: LIVE_PARTNER_RULES_VERSION })) { closeFlow(); await act({ action: "go_online" }); }
  }
  function closeFlow() { stopMic(); setFlow("none"); }
  function finishPreflight() { closeFlow(); }

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
          <Avatar userId={data.incoming.from.userId} kind={data.incoming.from.avatar} label={t.avatar} />
          <p className="flex-1 text-sm"><strong>{data.incoming.from.name}</strong> · {score(data.incoming.from.speakingScore)} — {t.incomingBody}</p>
          <button type="button" disabled={busy} className="btn-primary" onClick={() => act({ action: "accept", inviteId: data.incoming!.id })}>{t.accept}</button>
          <button type="button" disabled={busy} className="btn-secondary" onClick={() => act({ action: "decline", inviteId: data.incoming!.id })}>{t.decline}</button>
        </div>
      ) : null}

      <audio ref={audioRef} autoPlay muted={partnerMuted} className="hidden" aria-hidden="true" />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr_1fr]">
        <section aria-labelledby="lp-you" className="lp-panel lp-self flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4">
          <h2 id="lp-you" className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t.you}</h2>
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <Avatar userId={me.userId} kind={me.avatar} label={t.avatar} large />
            <div><p className="font-medium text-ink-900">{me.name}</p><p className="font-mono text-sm text-ink-600">{score(me.speakingScore)}</p></div>
          </div>
          <p className="text-xs text-ink-500">{t.micStatus}: {t.mic[mic]}</p>
          <p className="text-sm text-ink-600" aria-live="polite">{t.states[state]}</p>
          <button type="button" disabled={busy || inCall} className="btn-secondary" onClick={() => void startPreflight()}>{t.micTitle}</button>
          {data?.realtime.ready && !data.rulesAccepted && <button type="button" className="btn-secondary" onClick={() => setFlow("rules")}>{t.rulesTitle}</button>}

          {data?.outgoing ? <button type="button" disabled={busy} className="btn-secondary" onClick={() => act({ action: "cancel", inviteId: data.outgoing!.id })}>{t.cancelInvite}</button> : null}
          {inCall ? <button type="button" aria-pressed={micMuted} className="btn-secondary" onClick={() => { const next = !micMuted; setMicMuted(next); callRef.current?.setMuted(next); }}>{micMuted ? t.unmuteMic : t.muteMic}</button> : null}
        </section>

        <section aria-labelledby="lp-q" className="lp-panel lp-questions flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4">
          <h2 id="lp-q" className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t.questions}</h2>
          <p className="text-xs text-ink-500">{t.questionsOptional}</p>
          <label className="text-sm"><span className="sr-only">{t.search}</span>
            {/*
              SELECTION CONTRACT (verified in scripts/browser/verify-live-partner-search-browser.mjs):
              changing the query CLEARS the open topic. It is not preserved, and must
              not be described as preserved. Topic identity here is (part, topic), not
              a prompt id, so keeping a selection across a changed result pool could
              resolve it to a different question — clearing is what makes that
              unreachable. Continuation (Load more) does NOT change the query and
              deliberately keeps the open prompt, so reaching a late prompt and
              staying on it works.
            */}
            <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setSelectedTopic(null); }} placeholder={t.search} className="w-full rounded-sm border border-ink-200 px-3 py-2" />
          </label>
          <p className="text-xs text-ink-500" role="status" aria-live="polite" data-partner-search-state={searchState}>
            {searchState === "loading" ? t.searchSearching
              : searchState === "error" ? t.searchFailed
              : searchState === "empty" ? t.noQuestions
              : ""}
          </p>
          {searchState === "error" ? (
            <button type="button" className="btn-ghost btn-sm self-start" data-partner-search-retry onClick={() => setSearchAttempt((n) => n + 1)}>
              {t.searchRetry}
            </button>
          ) : null}
          {searchCursor && searchState === "success" ? (
            <button type="button" className="btn-ghost btn-sm self-start" data-partner-search-more onClick={() => { void runQuestionSearch(query.trim(), searchCursor); }}>
              {t.searchMore}
            </button>
          ) : null}
          {selectedTopic && selectedQuestion ? <div className="flex min-h-80 flex-col gap-5 rounded-2xl border border-ink-100 bg-paper-raised p-5" data-partner-topic-question>
            <button type="button" className="btn-secondary self-start" onClick={() => setSelectedTopic(null)}>← {dict.common.back}</button>
            <div><p className="text-xs font-semibold uppercase tracking-widest text-signal-600">{t.parts[selectedTopic.part]}</p><h3 className="mt-2 font-display text-xl">{selectedTopic.topic ?? dict.speakingStudy.topic}</h3></div>
            <p className="whitespace-pre-line text-lg">{selectedQuestion.promptText}</p>
            {selectedQuestion.cueCard && <p className="whitespace-pre-line text-ink-700">{selectedQuestion.cueCard}</p>}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-ink-500">{questionIndex + 1} / {topicQuestions.length}</span><button type="button" className="btn-primary" disabled={questionIndex + 1 >= topicQuestions.length} onClick={() => setQuestionIndex(i => i + 1)}>{t.nextQuestion} →</button></div>
          </div> : (["part1", "part2", "part3"] as const).map(part => {
            const topics = [...new Map(grouped[part].map(q => [q.topic, q])).values()];
            const expanded = query.trim().length > 0 || open === part;
            return <div key={part} data-practice-part={part} className="practice-part-card relative overflow-hidden rounded-2xl border border-ink-100">
              <button type="button" aria-expanded={expanded} aria-controls={`lp-${part}`} onClick={() => setOpen(open === part ? null : part)} className="relative flex min-h-28 w-full items-center justify-between gap-3 px-5 py-4 text-left font-medium">
                <span className="flex flex-col gap-2"><span className="practice-part-label text-xs font-bold uppercase tracking-widest">{t.parts[part]}</span><span className="font-display text-xl font-bold">{dict.speakingPractice.partTitle[part]}</span><span className="text-xs text-ink-500">{dict.speakingPractice.partBody[part]}</span></span><span className="text-xs text-ink-500">{topics.length} <span aria-hidden="true">{expanded ? "▲" : "▼"}</span></span>
              </button>
              {expanded && <ul id={`lp-${part}`} className="max-h-96 space-y-2 overflow-y-auto border-t border-ink-100 p-3">
                {topics.length === 0 ? <li className="text-sm text-ink-500">{t.noQuestions}</li> : topics.map(q => <li key={q.id}><button type="button" className="btn-secondary w-full justify-between text-left" onClick={() => { setSelectedTopic({ part, topic: q.topic }); setQuestionIndex(0); }}><span>{q.topic ?? dict.speakingStudy.topic}</span><span aria-hidden="true">→</span></button></li>)}
              </ul>}
            </div>;
          })}
        </section>

        {inCall && data?.partner ? (
          <section aria-labelledby="lp-partner" className="lp-panel lp-peer flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4">
            <h2 id="lp-partner" className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t.partner}</h2>
            <div className="flex flex-col items-center gap-4 py-6 text-center"><Avatar userId={data.partner.userId} kind={data.partner.avatar} label={t.avatar} large /><div><p className="font-medium">{data.partner.name}</p><p className="font-mono text-sm">{score(data.partner.speakingScore)}</p></div></div>
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
                    <Avatar userId={p.userId} kind={p.avatar} label={t.avatar} />
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
