"use client";

import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import type { AiSessionView } from "@/lib/data/speaking-ai-sessions";
import type { SessionSummary } from "@/lib/speaking/ai-session-summary";
import type { SpeakingAiReadiness } from "@/lib/speaking/ai-readiness";
import { AiPracticeSession } from "./ai/AiPracticeSession";

/**
 * Practice with AI — the entry screen.
 *
 * It owns one thing the rest of the flow does not: the readiness notice. That
 * notice has to be truthful in both directions, because this screen is where the
 * feature used to be gated:
 *
 *  - SERVER TRANSCRIPTION IS NO LONGER REQUIRED. The live transcript comes from
 *    the learner's own browser speech recognition, which costs no STT API call,
 *    so a deployment with no speech-to-text provider is fully usable. Saying
 *    "transcription is unavailable" here would now be false.
 *  - WHAT IS NOT CLAIMED: browser recognition is not described as server
 *    transcription or as anything it is not, and RIWI's built-in checks are never
 *    presented as an external AI evaluation.
 *
 * The readiness booleans are server-derived and carry no provider names, models
 * or secrets, so nothing vendor-specific can reach the learner from here.
 */
export function AiExaminerSession({
  dict,
  readiness,
  isStaff,
  initialSession,
}: {
  dict: Dictionary;
  readiness: SpeakingAiReadiness;
  isStaff: boolean;
  /** An unfinished session to resume instead of starting a new one. */
  initialSession?: AiSessionView | null;
  initialSummary?: SessionSummary | null;
}) {
  const t = dict.speakingAi;
  const externalEvaluation = readiness.aiEvaluation;

  return (
    <div className="flex flex-col gap-5" data-ai-session={initialSession ? "resumed" : "new"}>
      <div
        role="status"
        data-ai-readiness={externalEvaluation ? "ready" : "local"}
        className={`rounded-md border p-4 text-sm ${externalEvaluation ? "border-band-good/30 bg-band-good/5 text-ink-700" : "border-ink-100 bg-paper-sunken text-ink-700"}`}
      >
        {externalEvaluation ? (
          <p>{t.readyBody}</p>
        ) : (
          <>
            <p className="font-medium text-ink-900">{t.unavailableTitle}</p>
            {/* Honest, and no longer a blocker: the session below still runs. */}
            <p className="mt-1">{t.localEvaluationBody}</p>
            {isStaff && (
              <p className="mt-2 text-xs" data-ai-staff-setup>
                {t.staffSetup} <Link className="underline" href="/owner/integrations">{t.staffSetupLink}</Link>
              </p>
            )}
          </>
        )}
      </div>

      <AiPracticeSession dict={dict} historyHref="/speaking/history" initialSession={initialSession ?? null} />
    </div>
  );
}
