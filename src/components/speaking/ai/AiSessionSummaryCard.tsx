"use client";

import { BandBadge } from "@/components/ui/Badge";
import type { Dictionary } from "@/lib/i18n/en";
import type { SessionSummary } from "@/lib/speaking/ai-session-summary";

/**
 * The end-of-session summary (spec §27–§29, §49).
 *
 * Everything here comes from the server-computed summary object, which is
 * arithmetic over evaluations that were really persisted. No number is rounded
 * for presentation beyond the half-band scale the evaluator already used, and
 * nothing is inferred from the session's shape.
 *
 * The two statements this card must be able to make out loud:
 *  - WHEN THERE IS NO OVERALL ESTIMATE, IT SAYS WHY. Part 1 alone cannot produce
 *    a full interview band, so the card explains the limitation instead of
 *    quietly omitting the row.
 *  - PRONUNCIATION READS "NOT ASSESSED" WHEN NO PROVIDER HEARD THE AUDIO. It is
 *    never estimated from the transcript.
 */
export function AiSessionSummaryCard({
  dict,
  summary,
  onRestart,
  historyHref,
}: {
  dict: Dictionary;
  summary: SessionSummary;
  onRestart: () => void;
  historyHref: string;
}) {
  const t = dict.speakingAi;

  const suppressionText =
    summary.estimate.suppressedReason === "part1_only" ? t.noBandPart1Only
    : summary.estimate.suppressedReason === "no_answers" ? t.noBandNoAnswers
    : summary.estimate.suppressedReason === "not_evaluated" ? t.noBandNotEvaluated
    : summary.estimate.suppressedReason === "no_assessed_criteria" ? t.noBandNoCriteria
    : null;

  return (
    <section className="card flex flex-col gap-4 p-5" data-ai-summary data-ai-summary-band={summary.estimate.band ?? "none"}>
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg text-ink-900">{t.summaryTitle}</p>
        <p className="text-sm text-ink-500">
          {t.summaryCounts
            .replace("{answered}", String(summary.answeredCount))
            .replace("{total}", String(summary.totalCount))
            .replace("{skipped}", String(summary.skippedCount))}
        </p>
      </div>

      <div className="flex flex-col gap-1" data-ai-summary-estimate>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-xs text-ink-500">{t.estimateLabel}</span>
          {summary.estimate.band === null ? (
            <span className="badge bg-ink-100 text-ink-500" data-ai-summary-no-band>{t.notAssessed}</span>
          ) : (
            <BandBadge band={summary.estimate.band} />
          )}
        </div>
        {summary.estimate.band === null && suppressionText && (
          <p className="text-xs text-ink-500" data-ai-summary-suppressed={summary.estimate.suppressedReason}>
            {suppressionText}
          </p>
        )}
        {summary.estimate.band !== null && (
          <p className="text-xs text-ink-300">
            {t.textBasedEstimate} · {t.basedOnAnswers.replace("{n}", String(summary.estimate.basedOnAnswers))}
          </p>
        )}
      </div>

      {summary.criteria.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-ink-500">{t.criteriaTitle}</p>
          {summary.criteria.map((criterion) => (
            <div key={criterion.key} className="flex flex-wrap items-baseline gap-2 text-sm" data-ai-summary-criterion={criterion.key}>
              <span className="text-ink-700">{criterion.label}</span>
              {criterion.limited || criterion.band === null ? (
                <span className="badge bg-ink-100 text-ink-500" data-ai-summary-not-assessed>{t.notAssessed}</span>
              ) : (
                <BandBadge band={criterion.band} />
              )}
            </div>
          ))}
          {!summary.pronunciationAssessed && (
            <p className="text-xs text-ink-300" data-ai-summary-pronunciation-note>{t.pronunciationNotAssessedNote}</p>
          )}
        </div>
      )}

      {summary.weaknesses.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-ink-500">{t.recurringTitle}</p>
          <ul className="flex flex-col gap-1 text-sm text-ink-700">
            {summary.weaknesses.map((weakness) => (
              <li key={weakness.category} data-ai-summary-weakness={weakness.category}>
                {weakness.message}
                <span className="ml-2 text-xs text-ink-300">
                  {t.recurringCount.replace("{n}", String(weakness.occurrences))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.strengths.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-ink-500">{t.strengths}</p>
          <ul className="list-disc pl-5 text-sm text-ink-700">
            {summary.strengths.map((strength, index) => <li key={index}>{strength}</li>)}
          </ul>
        </div>
      )}

      {summary.nextActions.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-ink-500">{t.nextActions}</p>
          <ul className="list-disc pl-5 text-sm text-ink-700">
            {summary.nextActions.map((action, index) => <li key={index}>{action}</li>)}
          </ul>
        </div>
      )}

      {summary.topics.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-ink-500">{t.topicsTitle}</p>
          <ul className="flex flex-col gap-1 text-sm text-ink-700">
            {summary.topics.map((topic) => (
              <li key={`${topic.part}-${topic.topicKey}`} className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs text-ink-300">{dict.speakingPractice.part[topic.part]}</span>
                <span>{topic.topicTitle ?? dict.speakingPractice.untitledTopic}</span>
                <span className="text-xs text-ink-300">{t.topicCounts.replace("{answered}", String(topic.answered)).replace("{total}", String(topic.total))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A published-bank shortfall is disclosed, not hidden: the learner should
          know a topic had fewer questions than a full cluster (§9). */}
      {summary.limitations.length > 0 && (
        <div className="rounded-md border border-ink-100 bg-paper-sunken p-3 text-xs text-ink-500" data-ai-summary-limitations>
          <p className="font-medium text-ink-700">{t.limitationsTitle}</p>
          <ul className="mt-1 list-disc pl-4">
            {summary.limitations.map((limitation) => (
              <li key={`${limitation.part}-${limitation.topicKey}`}>
                {t.limitationLine
                  .replace("{topic}", limitation.topicTitle ?? limitation.topicKey)
                  .replace("{available}", String(limitation.available))
                  .replace("{requested}", String(limitation.requested))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.fallbackUsed && <p className="text-xs text-ink-300" data-ai-summary-fallback>{t.localCheckNote}</p>}

      <div className="flex flex-wrap gap-2">
        <a href={historyHref} className="btn-primary">{dict.speakingPractice.viewHistory}</a>
        <button type="button" className="btn-ghost" onClick={onRestart} data-ai-summary-restart>{t.again}</button>
      </div>
    </section>
  );
}
