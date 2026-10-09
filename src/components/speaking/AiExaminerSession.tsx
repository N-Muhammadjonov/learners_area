"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { speakingPrompts } from "@/db/schema";
import { AI_MODES, type AiMode } from "@/lib/speaking/ai-session";
import type { SpeakingAiReadiness } from "@/lib/speaking/ai-readiness";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import { MicrophoneCheck } from "./MicrophoneCheck";
import { AiQuestionRecorder } from "./AiQuestionRecorder";

type Prompt = typeof speakingPrompts.$inferSelect;
type Session = { id: string; mode: AiMode; status: string; currentItemIndex: number; limitations: string[] };
type Item = { id: string; ordinal: number; topicKey: string; topicPosition: number; questionPosition: number; status: string; attemptId: string | null; prompt: Prompt | null };
type SessionPayload = { session: Session | null; items: Item[] };
type SessionSummary = {
  answered: number; skipped: number; evaluated: number; unevaluated: number; completeEvidence: boolean; totalDurationMs: number; textBasedEstimate: number | null;
  criteria: Array<{ key: string; label: string; estimate: number; evidenceCount: number }>;
  strengths: string[]; weaknesses: string[]; recurringWeaknesses: Array<{ category: string; count: number }>;
};

/** Persisted Practice-with-AI orchestrator. Randomization happens on POST only. */
export function AiExaminerSession({ dict, prompts, readiness, isStaff }: {
  dict: Dictionary; prompts: Prompt[]; readiness: SpeakingAiReadiness; isStaff: boolean;
}) {
  const t = dict.speakingAi;
  const request = useScopedRequest();
  const [gate, setGate] = useState<"microphone" | "mode" | "session">("microphone");
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [step, setStep] = useState(0);
  const [lastAttemptId, setLastAttemptId] = useState<string | null>(null);
  const [transition, setTransition] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const summaryRequested = useRef<string | null>(null);
  const resumed = useRef(false);
  const startingRef = useRef(false);
  const advancingRef = useRef(false);

  // Refresh resumes the immutable active plan. It does not create or reshuffle it.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    void (async () => {
      const result = await request<SessionPayload>("/api/speaking/ai/sessions", { method: "GET" });
      if (result?.ok && result.data?.session && result.data.items.length) {
        setSession(result.data.session); setItems(result.data.items);
        setStep(Math.min(result.data.session.currentItemIndex, result.data.items.length));
        setGate("session");
      }
    })();
  }, [request]);

  const start = useCallback(async (mode: AiMode) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true); setError("");
    const result = await request<SessionPayload>("/api/speaking/ai/sessions", { body: { mode } });
    startingRef.current = false;
    setStarting(false);
    if (!result?.ok || !result.data?.session) { setError(t.startFailed); return; }
    setSession(result.data.session); setItems(result.data.items); setStep(0); setLastAttemptId(null); setGate("session");
  }, [request, t.startFailed]);

  async function advance() {
    const item = items[step];
    if (!session || !item || !lastAttemptId) return;
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      const result = await request(`/api/speaking/ai/sessions/${session.id}/items/${item.id}/complete`, { body: { action: "answered", attemptId: lastAttemptId } });
      if (!result?.ok) { setError(t.advanceFailed); return; }
      const next = items[step + 1];
      setItems((current) => current.map((value) => value.id === item.id ? { ...value, status: "answered", attemptId: lastAttemptId } : value));
      setSession((current) => current ? { ...current, currentItemIndex: item.ordinal, ...(next ? {} : { status: "completed" }) } : current);
      setLastAttemptId(null);
      if (next && next.topicPosition !== item.topicPosition) setTransition(true);
      else setStep((value) => value + 1);
    } finally { advancingRef.current = false; }
  }

  async function skip() {
    const item = items[step];
    if (!session || !item) return;
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      const result = await request(`/api/speaking/ai/sessions/${session.id}/items/${item.id}/complete`, { body: { action: "skipped" } });
      if (!result?.ok) { setError(t.advanceFailed); return; }
      const next = items[step + 1];
      setItems((current) => current.map((value) => value.id === item.id ? { ...value, status: "skipped" } : value));
      setSession((current) => current ? { ...current, currentItemIndex: item.ordinal, ...(next ? {} : { status: "completed" }) } : current);
      if (next && next.topicPosition !== item.topicPosition) setTransition(true);
      else setStep((value) => value + 1);
    } finally { advancingRef.current = false; }
  }

  function newSession() {
    setSession(null); setItems([]); setStep(0); setLastAttemptId(null); setTransition(false); setError(""); setSummary(null); summaryRequested.current = null; setGate("mode");
  }

  const current = items[step];
  const finished = session && (session.status === "completed" || step >= items.length);

  useEffect(() => {
    if (!finished || !session || summaryRequested.current === session.id) return;
    summaryRequested.current = session.id;
    void (async () => {
      const result = await request<{ summary: SessionSummary }>(`/api/speaking/ai/sessions/${session.id}/complete`, { method: "GET" });
      if (result?.ok && result.data?.summary) setSummary(result.data.summary);
    })();
  }, [finished, request, session]);

  return <div className="flex flex-col gap-5" data-ai-session={finished ? "finished" : session ? "running" : gate}>
    {gate === "microphone" && !session && <MicrophoneCheck dict={dict} onContinue={() => setGate("mode")} />}

    {gate === "mode" && !session && <>
      <div className="rounded-md border border-ink-100 p-4 text-sm text-ink-700" data-ai-readiness={readiness.aiEvaluation ? "external" : "local"}>
        <p>{readiness.aiEvaluation ? t.externalReady : t.localFallback}</p>
        {isStaff && !readiness.aiEvaluation && <p className="mt-2 text-xs">{t.staffSetup} <Link className="underline" href="/owner/integrations">{t.staffSetupLink}</Link></p>}
      </div>
      <h2 className="font-display text-xl text-ink-900">{t.chooseSession}</h2>
      <div className="grid gap-3 sm:grid-cols-2" data-ai-modes>
        {AI_MODES.map((mode) => <button key={mode} type="button" disabled={starting} onClick={() => void start(mode)} data-ai-mode={mode}
          className="card flex min-h-24 flex-col items-start gap-1 p-5 text-left hover:bg-paper-sunken disabled:opacity-50">
          <span className="font-display text-lg text-ink-900">{t.mode[mode]}</span>
          <span className="text-sm text-ink-500">{t.modeBody[mode]}</span>
        </button>)}
      </div>
      {prompts.length === 0 && <p className="text-sm text-ink-500">{t.noQuestions}</p>}
    </>}

    {session && transition && current && <Card className="flex flex-col items-center gap-3 p-6 text-center" data-topic-transition>
      <h2 className="font-display text-xl text-ink-900">{t.topicComplete}</h2>
      <p className="text-sm text-ink-500">{t.topicCompleteBody}</p>
      <Button onClick={() => { setTransition(false); setStep((value) => value + 1); }}>{t.continue}</Button>
    </Card>}

    {session && !transition && current?.prompt && !finished && <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-500">
        <span>{dict.speakingPractice.part[current.prompt.part]} · {t.topic}: {current.prompt.topic ?? t.untitledTopic}</span>
        <span data-ai-progress>{t.progress.replace("{n}", String(step + 1)).replace("{total}", String(items.length))}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={step}>
        <div className="h-full bg-signal-500" style={{ width: `${items.length ? (step / items.length) * 100 : 0}%` }} />
      </div>
      <p className="text-sm font-medium text-ink-700">{t.examinerSays}</p>
      <AiQuestionRecorder key={current.id} dict={dict} prompt={current.prompt} sessionId={session.id} itemId={current.id} index={step + 1}
        onEvaluated={setLastAttemptId} onNext={() => void advance()} />
      {!lastAttemptId && <Button variant="ghost" className="self-start" onClick={() => void skip()}>{t.skip}</Button>}
    </section>}

    {finished && <Card className="flex flex-col gap-4 p-6" data-ai-finished>
      <div><p className="text-sm font-medium text-signal-700">{t.checkedByRiwi}</p><h2 className="mt-1 font-display text-2xl text-ink-900">{t.summaryTitle}</h2></div>
      <p className="text-sm text-ink-700">{t.finishedBody.replace("{n}", String(summary?.answered ?? items.filter((item) => item.status === "answered").length)).replace("{total}", String(items.length))}</p>
      <p className="text-sm text-ink-500">{t.summaryHonesty}</p>
      {summary && <>
        <p className="text-sm text-ink-500" data-ai-summary-coverage>{t.summaryCoverage.replace("{evaluated}", String(summary.evaluated)).replace("{answered}", String(summary.answered))}</p>
        {summary.textBasedEstimate !== null && <div className="text-center"><p className="text-xs uppercase tracking-wide text-ink-500">{t.textBasedEstimate}</p><p className="font-display text-4xl text-ink-900">{summary.textBasedEstimate.toFixed(1)}</p></div>}
        {summary.criteria.length > 0 && <div className="divide-y divide-ink-100 rounded-md border border-ink-100">{summary.criteria.map((criterion) => <div key={criterion.key} className="flex justify-between gap-3 p-3 text-sm"><span>{criterion.label}</span><strong>{criterion.estimate.toFixed(1)}</strong></div>)}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {summary.strengths.length > 0 && <div><h3 className="text-sm font-semibold">{t.strengths}</h3><ul className="list-inside list-disc text-sm text-ink-700">{summary.strengths.map((value) => <li key={value}>{value}</li>)}</ul></div>}
          {summary.weaknesses.length > 0 && <div><h3 className="text-sm font-semibold">{t.improveNext}</h3><ul className="list-inside list-disc text-sm text-ink-700">{summary.weaknesses.map((value) => <li key={value}>{value}</li>)}</ul></div>}
        </div>
      </>}
      <p className="text-sm"><strong>{t.pronunciation}:</strong> {t.notAssessed}</p>
      <div className="flex flex-wrap gap-2"><Link href="/speaking/history" className="btn-primary">{dict.speakingPractice.viewHistory}</Link><Button variant="secondary" onClick={newSession}>{t.newSession}</Button></div>
    </Card>}
    {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
  </div>;
}
