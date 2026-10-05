"use client";

import { Button } from "@/components/ui/Button";
import { BandBadge } from "@/components/ui/Badge";
import type { Dictionary } from "@/lib/i18n/en";
import type { LearnerEvaluation } from "@/lib/services/coach/public-evaluation";

/**
 * Evidence feedback for one answer (spec §23–§26, §31).
 *
 * Attribution rules held here, and the reason this is a separate component from
 * anything that shows staff provenance:
 *
 *  - THE EVALUATOR IS ALWAYS "Checked by RIWI". The response type has no field
 *    that could name a provider or model, so this card cannot leak one even by
 *    mistake while a future field is added.
 *  - PRONUNCIATION IS SHOWN AS "NOT ASSESSED" when no acoustic provider ran. No
 *    band is displayed for it, ever, because a transcript cannot carry it.
 *  - NO OFFICIAL BAND IS CLAIMED. The estimate is labelled text-based, and when
 *    the server withheld one the reason is stated rather than a number invented.
 *  - NOTHING IS SHOWN THAT WAS NOT PRODUCED. An answer with no evaluation says
 *    so; it does not get generic advice dressed up as feedback.
 */
export function AiAnswerFeedback({
  dict,
  evaluation,
  transcriptEdited,
  transcriptSent,
  isLast,
  onTryAgain,
  onNext,
}: {
  dict: Dictionary;
  evaluation: LearnerEvaluation | null;
  /** True when the learner changed the recognized text before sending. */
  transcriptEdited: boolean;
  /** False when the learner cleared the transcript and sent audio only. */
  transcriptSent: boolean;
  /** The final question: the way forward leads to the summary, not another question. */
  isLast: boolean;
  onTryAgain: () => void;
  onNext: () => void;
}) {
  const t = dict.speakingAi;

  return (
    <div className="flex flex-col gap-3" data-ai-feedback>
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge bg-signal-100 text-signal-700" data-ai-checked-by>
          {t.checkedBy.replace("{name}", evaluation?.checkedBy ?? "RIWI")}
        </span>
        {!transcriptSent && <span className="badge bg-paper-sunken text-ink-500" data-ai-no-transcript>{t.audioOnly}</span>}
        {transcriptSent && transcriptEdited && (
          <span className="badge bg-amber-100 text-ink-700 dark:bg-amber-950/40" data-ai-transcript-edited>
            {t.transcriptEditedNotice}
          </span>
        )}
      </div>

      {!evaluation ? (
        <p className="rounded-md border border-ink-100 bg-paper-sunken p-3 text-sm text-ink-500" data-ai-no-evaluation>
          {t.noEvaluation}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-xs text-ink-500">{t.estimateLabel}</span>
            <BandBadge band={evaluation.overallEstimate} />
            <span className="text-xs text-ink-300">{t.textBasedEstimate}</span>
          </div>

          <div className="flex flex-col gap-1">
            {evaluation.criteria.map((criterion) => (
              <div key={criterion.key} className="flex flex-wrap items-baseline gap-2 text-sm" data-ai-criterion={criterion.key}>
                <span className="text-ink-700">{criterion.label}</span>
                {/* A limited criterion is "Not assessed", never a band. */}
                {criterion.limited || criterion.band === null ? (
                  <span className="badge bg-ink-100 text-ink-500" data-ai-not-assessed>{t.notAssessed}</span>
                ) : (
                  <BandBadge band={criterion.band} />
                )}
              </div>
            ))}
          </div>

          {evaluation.strengths.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-ink-500">{t.strengths}</p>
              <ul className="list-disc pl-5 text-sm text-ink-700">
                {evaluation.strengths.map((strength, index) => <li key={index}>{strength}</li>)}
              </ul>
            </div>
          )}

          {evaluation.issues.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-ink-500">{t.fixes}</p>
              <ul className="flex flex-col gap-2 text-sm text-ink-700">
                {evaluation.issues.slice(0, 4).map((issue, index) => (
                  <li key={index} className="rounded-md border border-ink-100 bg-paper-sunken p-2" data-ai-issue={issue.category}>
                    <p>{issue.message}</p>
                    {issue.suggestion && <p className="mt-1 text-xs text-ink-500">{issue.suggestion}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {evaluation.nextActions.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-ink-500">{t.nextActions}</p>
              <ul className="list-disc pl-5 text-sm text-ink-700">
                {evaluation.nextActions.map((action, index) => <li key={index}>{action}</li>)}
              </ul>
            </div>
          )}

          {evaluation.fallbackUsed && (
            <p className="text-xs text-ink-300" data-ai-fallback>{t.localCheckNote}</p>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onTryAgain} data-ai-try-again>{t.tryAgain}</Button>
        <Button onClick={onNext} data-ai-next-question>{isLast ? t.finishSession : t.nextQuestion}</Button>
      </div>
    </div>
  );
}
