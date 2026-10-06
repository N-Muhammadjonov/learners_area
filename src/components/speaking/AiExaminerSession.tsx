"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { speakingPrompts } from "@/db/schema";
import { AI_MODES, buildExaminerScript, type AiMode } from "@/lib/speaking/ai-session";
import type { SpeakingAiReadiness } from "@/lib/speaking/ai-readiness";
import { Button } from "@/components/ui/Button";
import { QuestionRecorder } from "./QuestionRecorder";

type Prompt = typeof speakingPrompts.$inferSelect;

/**
 * Practice with AI: an examiner-style session, one question at a time, built
 * from the canonical bank. Every answer goes through the normal submit
 * pipeline, which transcribes and evaluates server-side only when real
 * providers are configured. This screen never shows a transcript or band of
 * its own — results live on the attempt in Speaking history.
 */
export function AiExaminerSession({ dict, prompts, readiness, isStaff }: {
  dict: Dictionary;
  prompts: Prompt[];
  readiness: SpeakingAiReadiness;
  isStaff: boolean;
}) {
  const t = dict.speakingAi;
  const [script, setScript] = useState<Prompt[] | null>(null);
  const [step, setStep] = useState(0);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const onBusyChange = useCallback((id: string, busy: boolean) => {
    setBusyId((current) => (busy ? id : current === id ? null : current));
  }, []);

  const start = (mode: AiMode) => { setScript(buildExaminerScript(prompts, mode)); setStep(0); setAnswered({}); };
  const finished = script !== null && step >= script.length;
  const current = script && !finished ? script[step]! : null;

  return (
    <div className="flex flex-col gap-5" data-ai-session={script ? (finished ? "finished" : "running") : "choose"}>
      <div role="status" data-ai-readiness={readiness.transcription && readiness.aiEvaluation ? "ready" : "unavailable"}
        className={`rounded-md border p-4 text-sm ${readiness.transcription && readiness.aiEvaluation ? "border-band-good/30 bg-band-good/5 text-ink-700" : "border-amber-300 bg-amber-50 text-ink-700 dark:bg-amber-950/30"}`}>
        {readiness.transcription && readiness.aiEvaluation ? t.readyBody : (
          <>
            <p className="font-medium text-ink-900">{t.unavailableTitle}</p>
            <p className="mt-1">{t.unavailableBody}</p>
            {isStaff && <p className="mt-2 text-xs" data-ai-staff-setup>{t.staffSetup} <Link className="underline" href="/app/owner/integrations">{t.staffSetupLink}</Link></p>}
          </>
        )}
      </div>

      {!script && (
        <div className="grid gap-3 sm:grid-cols-2" data-ai-modes>
          {AI_MODES.map((mode) => (
            <button key={mode} type="button" onClick={() => start(mode)} data-ai-mode={mode}
              className="card flex min-h-24 flex-col items-start gap-1 p-5 text-left hover:bg-paper-sunken">
              <span className="font-display text-lg text-ink-900">{t.mode[mode]}</span>
              <span className="text-sm text-ink-500">{t.modeBody[mode]}</span>
            </button>
          ))}
        </div>
      )}

      {script && script.length === 0 && <p className="text-sm text-ink-500">{t.noQuestions}</p>}

      {current && script && (
        <section className="flex flex-col gap-3" aria-live="polite">
          <p className="text-sm text-ink-500" data-ai-progress>{t.progress.replace("{n}", String(step + 1)).replace("{total}", String(script.length))} · {dict.speakingPractice.part[current.part]}</p>
          <p className="text-sm text-ink-700">{t.examinerSays}</p>
          <QuestionRecorder key={current.id} dict={dict} prompt={current} index={step + 1} lockedBy={busyId} onBusyChange={onBusyChange}
            onSubmitted={(attemptId) => setAnswered((a) => ({ ...a, [current.id]: attemptId }))} />
          <div className="flex flex-wrap gap-2">
            <Button data-ai-next disabled={busyId !== null} onClick={() => setStep((s) => s + 1)}>
              {answered[current.id] ? t.next : t.skip}
            </Button>
            <Button variant="ghost" disabled={busyId !== null} onClick={() => setScript(null)}>{t.endSession}</Button>
          </div>
        </section>
      )}

      {finished && script && script.length > 0 && (
        <section className="card flex flex-col gap-2 p-5" data-ai-finished>
          <p className="font-display text-lg text-ink-900">{t.finishedTitle}</p>
          <p className="text-sm text-ink-500">{t.finishedBody.replace("{n}", String(Object.keys(answered).length)).replace("{total}", String(script.length))}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/app/speaking/history" className="btn-primary">{dict.speakingPractice.viewHistory}</Link>
            <Button variant="ghost" onClick={() => setScript(null)}>{t.again}</Button>
          </div>
        </section>
      )}
    </div>
  );
}
