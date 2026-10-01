"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { filterQuestions, type QuestionRow } from "@/lib/live-partner/questions";
import { LIVE_PARTNER_RULES_VERSION } from "@/lib/live-partner/rules";

type Person = { userId: string; name: string; avatar: "a" | "b"; speakingScore: number | null };
type Payload = {
  state: "offline" | "available" | "outgoing_invite" | "incoming_invite" | "connecting" | "in_call" | "reconnecting";
  rulesAccepted: boolean; sessionId: string | null; partner: Person | null;
  incoming: { id: string; from: Person; expiresAt: string } | null;
  outgoing: { id: string; toUserId: string; expiresAt: string } | null;
  online: Person[]; realtimeConfigured: boolean; serverNow: string;
};
type Flow = "none" | "rules" | "mic";

const POLL_MS = 4_000;
const HEARTBEAT_MS = 15_000;
const score = (s: number | null) => (s == null ? "S —" : `S ${s.toFixed(1)}`);

function Avatar({ kind, label }: { kind: "a" | "b"; label: string }) {
  // System avatars only (no uploads): two neutral glyph styles.
  return <span role="img" aria-label={label} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${kind === "b" ? "bg-rose-100" : "bg-sky-100"}`}>{kind === "b" ? "👩" : "👨"}</span>;
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
  const [micOk, setMicOk] = useState(false);
  const micRef = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const grouped = useMemo(() => filterQuestions(questions, query), [questions, query]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/live-partner", { cache: "no-store", signal: AbortSignal.timeout(8_000) });
      if (res.ok) { setData(await res.json()); setError(""); }
      else setError(t.errors.unavailable);
    } catch { setError(t.errors.unavailable); }
  }, [t]);

  // A single explicit POST per user action — never auto-retried.
  const act = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/live-partner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { setData(json); setError(""); return true; }
      setError((t.errors as Record<string, string>)[json.error] ?? t.errors.unavailable);
      void refresh();
      return false;
    } catch { setError(t.errors.unknownResult); void refresh(); return false; }
    finally { setBusy(false); }
  }, [t, refresh]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  const state = data?.state ?? "offline";
  useEffect(() => {
    if (state === "offline") return;
    const beat = setInterval(() => { void fetch("/api/live-partner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "heartbeat" }) }).catch(() => {}); }, HEARTBEAT_MS);
    return () => clearInterval(beat);
  }, [state]);

  function stopMic() {
    const m = micRef.current; micRef.current = null;
    if (!m) return;
    cancelAnimationFrame(m.raf); m.stream.getTracks().forEach((tr) => tr.stop()); void m.ctx.close();
  }
  useEffect(() => stopMic, []);

  async function startPreflight() {
    setFlow("mic"); setMicOk(false); setError("");
    try {
      // Local level meter only: nothing is recorded or uploaded.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        const l = Math.min(1, peak / 64); setLevel(l); if (l > 0.08) setMicOk(true);
        if (micRef.current) micRef.current.raf = requestAnimationFrame(tick);
      };
      micRef.current = { stream, ctx, raf: requestAnimationFrame(tick) };
    } catch { setError(t.errors.mic); setFlow("none"); }
  }

  async function goOnline() {
    if (!me.hasGender) { setError(t.errors.profile_incomplete); return; }
    if (!data?.rulesAccepted) { setFlow("rules"); return; }
    await startPreflight();
  }
  async function acceptRules() {
    if (await act({ action: "accept_rules", version: LIVE_PARTNER_RULES_VERSION })) await startPreflight();
  }
  async function finishPreflight() {
    stopMic(); setFlow("none");
    await act({ action: "go_online" });
  }

  const inCall = state === "connecting" || state === "in_call" || state === "reconnecting";

  return (
    <div className="flex flex-col gap-3">
      {error ? <p role="alert" className="rounded-sm border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{error}</p> : null}
      {data?.incoming ? (
        <div role="alertdialog" aria-label={t.incomingTitle} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-paper p-3">
          <Avatar kind={data.incoming.from.avatar} label={t.avatar} />
          <p className="flex-1 text-sm"><strong>{data.incoming.from.name}</strong> · {score(data.incoming.from.speakingScore)} — {t.incomingBody}</p>
          <button type="button" disabled={busy} className="btn-primary" onClick={() => act({ action: "accept", inviteId: data.incoming!.id })}>{t.accept}</button>
          <button type="button" disabled={busy} className="btn-secondary" onClick={() => act({ action: "decline", inviteId: data.incoming!.id })}>{t.decline}</button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr_1fr]">
        <section aria-labelledby="lp-you" className="flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4">
          <h2 id="lp-you" className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t.you}</h2>
          <div className="flex items-center gap-3">
            <Avatar kind={me.avatar} label={t.avatar} />
            <div><p className="font-medium text-ink-900">{me.name}</p><p className="font-mono text-sm text-ink-600">{score(me.speakingScore)}</p></div>
          </div>
          <p className="text-sm text-ink-600" aria-live="polite">{t.states[state]}</p>
          {state === "offline" ? <button type="button" disabled={busy || !data} className="btn-primary" onClick={goOnline}>{t.goOnline}</button> : null}
          {state === "available" ? <button type="button" disabled={busy} className="btn-secondary" onClick={() => act({ action: "go_offline" })}>{t.goOffline}</button> : null}
          {data?.outgoing ? <button type="button" disabled={busy} className="btn-secondary" onClick={() => act({ action: "cancel", inviteId: data.outgoing!.id })}>{t.cancelInvite}</button> : null}
          {inCall && data?.partner ? (
            <div className="flex flex-col gap-2 border-t border-ink-100 pt-3">
              <div className="flex items-center gap-3"><Avatar kind={data.partner.avatar} label={t.avatar} /><div><p className="font-medium">{data.partner.name}</p><p className="font-mono text-sm">{score(data.partner.speakingScore)}</p></div></div>
              {!data.realtimeConfigured ? <p className="rounded-sm bg-amber-50 p-2 text-xs text-amber-900">{t.realtimeMissing}</p> : null}
              <button type="button" disabled={busy} className="btn-secondary" onClick={() => act({ action: "hangup", sessionId: data.sessionId })}>{t.endCall}</button>
              <button type="button" disabled={busy} className="text-xs text-ink-500 underline" onClick={() => act({ action: "block", userId: data.partner!.userId }).then(() => act({ action: "hangup", sessionId: data.sessionId }))}>{t.block}</button>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="lp-q" className="flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4">
          <h2 id="lp-q" className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t.questions}</h2>
          <label className="text-sm"><span className="sr-only">{t.search}</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} className="w-full rounded-sm border border-ink-200 px-3 py-2" />
          </label>
          {(["part1", "part2", "part3"] as const).map((part) => (
            <div key={part} className="rounded-sm border border-ink-100">
              <button type="button" aria-expanded={open === part} aria-controls={`lp-${part}`} onClick={() => setOpen(open === part ? null : part)} className="flex w-full items-center justify-between px-3 py-2 text-left font-medium">
                <span>{t.parts[part]}</span><span className="text-xs text-ink-500">{grouped[part].length}</span>
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

        <section aria-labelledby="lp-online" className="flex flex-col gap-3 rounded-lg border border-ink-100 bg-paper p-4">
          <h2 id="lp-online" className="text-xs font-semibold uppercase tracking-wide text-ink-500">{t.onlineUsers}</h2>
          {!data ? <p className="text-sm text-ink-500">{t.loading}</p> : data.online.length === 0 ? <p className="text-sm text-ink-500">{t.nobodyOnline}</p> : (
            <ul className="flex flex-col gap-2">
              {data.online.map((p) => (
                <li key={p.userId} className="flex items-center gap-2">
                  <Avatar kind={p.avatar} label={t.avatar} />
                  <div className="flex-1"><p className="text-sm font-medium">{p.name}</p><p className="font-mono text-xs text-ink-600">{score(p.speakingScore)}</p></div>
                  <button type="button" disabled={busy || state !== "available"} className="btn-secondary text-sm" onClick={() => act({ action: "invite", toUserId: p.userId })}>{t.invite}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {flow !== "none" ? (
        <div role="dialog" aria-modal="true" aria-labelledby="lp-flow" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-paper p-5 shadow-lg">
            {flow === "rules" ? (
              <>
                <h2 id="lp-flow" className="font-display text-lg">{t.rulesTitle}</h2>
                <ul className="my-3 list-disc pl-5 text-sm text-ink-700">{t.rules.map((r) => <li key={r}>{r}</li>)}</ul>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setFlow("none")}>{t.close}</button>
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
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={() => { stopMic(); setFlow("none"); }}>{t.close}</button>
                  <button type="button" disabled={!micOk || busy} className="btn-primary" onClick={finishPreflight}>{t.micReady}</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
