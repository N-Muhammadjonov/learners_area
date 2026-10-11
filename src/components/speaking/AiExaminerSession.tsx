"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { AI_MODES, type AiMode, type ExaminerPrompt } from "@/lib/speaking/ai-session";
import type { SpeakingAiReadiness } from "@/lib/speaking/ai-readiness";
import { Button } from "@/components/ui/Button";
import { QuestionRecorder } from "./QuestionRecorder";

/**
 * Practice with AI: an examiner-style session, one question at a time, built from the canonical bank.
 * Every answer goes through the normal submit pipeline, which transcribes and evaluates server-side
 * only when real providers are configured. This screen never shows a transcript or band of its own —
 * results live on the attempt in Speaking history.
 *
 * §05 — WHAT CHANGED, AND WHAT DID NOT.
 *
 * The script used to be built in the browser by `buildExaminerScript(prompts, mode)` over the complete
 * published bank, which is why the page had to ship the whole corpus. The obvious alternative — drawing
 * from the first bounded page — is explicitly wrong and was not done: it would bias every exam toward
 * whichever prompts happen to sort first and make later ones unreachable, trading a performance defect
 * for a fairness one. A learner's Part 2 cue card has to be drawn from the whole bank.
 *
 * So the draw moved to `GET /api/speaking/ai/script`, which samples uniformly over the corpus while
 * returning at most a handful of rows. The examiner flow is unchanged: Part 1 short questions from one
 * eligible topic, Part 2 a single cue card, Part 3 discussion questions preferring the Part 2 topic.
 * Nothing is invented and no draft can appear.
 *
 * §5.1 — A NETWORK RESPONSE MUST NEVER RESET AN ACTIVE RECORDER. The script is fetched only from the
 * "choose a mode" state, when no recorder is mounted, and the response is applied only if the session is
 * still in that state and still awaiting this same request. Once a script exists nothing refetches it,
 * so an in-progress attempt cannot be invalidated by a late or duplicated response. Ending the session
 * is an explicit local action, not a network one.
 */
export function AiExaminerSession({ dict, readiness, isStaff }: {
  dict: Dictionary;
  readiness: SpeakingAiReadiness;
  isStaff: boolean;
}) {
  const t = dict.speakingAi;
  const [script, setScript] = useState<ExaminerPrompt[] | null>(null);
  const [step, setStep] = useState(0);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /*
   * §02 — WHICH request failed has to be remembered, or it cannot be retried. The Retry button used to
   * call `setFailed(false)`, which only hid the message and dropped the learner back on the mode grid:
   * the failed draw was never re-issued, so the button labelled "Try again" did not try again. Keeping
   * the mode lets Retry repeat the exact request that failed.
   */
  const [failedMode, setFailedMode] = useState<AiMode | null>(null);

  /*
   * Two guards, because one is not enough. `requestRef` rejects a response that is no longer the newest
   * (modes clicked twice quickly), and `phaseRef` rejects any response that arrives after the learner has
   * left the choose state — which is what makes it impossible for a late response to overwrite a script a
   * recorder is already working through.
   */
  const requestRef = useRef(0);
  const phaseRef = useRef<"choose" | "running">("choose");
  const onBusyChange = useCallback((id: string, busy: boolean) => {
    setBusyId((current) => (busy ? id : current === id ? null : current));
  }, []);

  useEffect(() => () => { requestRef.current += 1; }, []);

  const start = useCallback(async (mode: AiMode) => {
    if (loading) return;
    const token = ++requestRef.current;
    setLoading(true);
    setFailed(false);
    setFailedMode(null);
    try {
      const response = await fetch(`/api/speaking/ai/script?mode=${encodeURIComponent(mode)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`script ${response.status}`);
      const payload = (await response.json()) as { mode: AiMode; script: ExaminerPrompt[] };
      // Superseded, or the learner already left the choose state: drop it rather than apply it.
      if (token !== requestRef.current || phaseRef.current !== "choose") return;
      setScript(payload.script);
      setStep(0);
      setAnswered({});
      phaseRef.current = "running";
    } catch {
      if (token === requestRef.current && phaseRef.current === "choose") {
        setFailed(true);
        setFailedMode(mode);
      }
    } finally {
      if (token === requestRef.current) setLoading(false);
    }
  }, [loading]);

  const endSession = useCallback(() => {
    // Local only: ending a session must never depend on, or be triggered by, a network response.
    requestRef.current += 1;
    phaseRef.current = "choose";
    setScript(null);
    setStep(0);
    setAnswered({});
    setLoading(false);
    setFailed(false);
    setFailedMode(null);
  }, []);

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
        <>
          <div className="grid gap-3 sm:grid-cols-2" data-ai-modes>
            {AI_MODES.map((mode) => (
              <button key={mode} type="button" onClick={() => void start(mode)} disabled={loading} data-ai-mode={mode}
                className="card flex min-h-24 flex-col items-start gap-1 p-5 text-left hover:bg-paper-sunken disabled:cursor-not-allowed disabled:opacity-50">
                <span className="font-display text-lg text-ink-900">{t.mode[mode]}</span>
                <span className="text-sm text-ink-500">{t.modeBody[mode]}</span>
              </button>
            ))}
          </div>
          {/* Loading and failure are distinct states, and a failure offers a retry rather than silently
              presenting an empty exam as though the bank had no questions. */}
          {loading && <p className="text-sm text-ink-500" data-ai-loading>{dict.common.loading}</p>}
          {failed && !loading && (
            <p className="text-sm text-ink-500" data-ai-error>
              {dict.common.error}{" "}
              {/* A genuine retry: the same mode, the same request. Disabled when the mode is somehow
                  unknown rather than silently doing nothing. */}
              <button type="button" className="min-h-11 rounded-md underline" disabled={failedMode === null}
                onClick={() => { if (failedMode !== null) void start(failedMode); }} data-ai-retry>{dict.errorPage.retry}</button>
            </p>
          )}
        </>
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
            <Button variant="ghost" disabled={busyId !== null} onClick={endSession}>{t.endSession}</Button>
          </div>
        </section>
      )}

      {finished && script && script.length > 0 && (
        <section className="card flex flex-col gap-2 p-5" data-ai-finished>
          <p className="font-display text-lg text-ink-900">{t.finishedTitle}</p>
          <p className="text-sm text-ink-500">{t.finishedBody.replace("{n}", String(Object.keys(answered).length)).replace("{total}", String(script.length))}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/app/speaking/history" className="btn-primary">{dict.speakingPractice.viewHistory}</Link>
            <Button variant="ghost" onClick={endSession}>{t.again}</Button>
          </div>
        </section>
      )}
    </div>
  );
}
