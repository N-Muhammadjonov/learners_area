import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { BandBadge } from "@/components/ui/Badge";
import type { Dictionary } from "@/lib/i18n/en";
import type { EvaluationRecord } from "@/lib/data/evaluations";
import type { WeaknessCategory } from "@/lib/services/coach/schema";

/**
 * Renders a normalized Coach evaluation.
 *
 * Two rules are enforced by this component rather than by convention:
 *
 *  - The "Checked by …" label comes from `evaluation.checkedByName`, which was
 *    written from the provider metadata at evaluation time. It is never derived
 *    from current configuration, so the label cannot drift away from the truth
 *    when AI_PRIMARY_PROVIDER changes.
 *  - A criterion the evaluator could not judge (`limited`) is shown as "Not
 *    assessed" instead of a number. RIWI's speaking pronunciation entry is the
 *    live example: no pronunciation band is displayed because none exists.
 */
export function EvaluationView({
  dict,
  evaluation,
  heading,
}: {
  dict: Dictionary;
  evaluation: EvaluationRecord;
  heading?: string;
}) {
  const t = dict.coach;
  const criterionLabel = (key: string): string => {
    const labels = t.criterionLabels as Record<string, string | undefined>;
    return labels[key] ?? "";
  };
  const categoryLabel = (category: string): string => {
    const labels = t.categoryLabels as Record<string, string | undefined>;
    return labels[category] ?? category;
  };
  const verdictLabel = (verdict: string | null): string =>
    verdict === "correct"
      ? t.verdicts.correct
      : verdict === "mostly_correct"
        ? t.verdicts.mostly_correct
        : verdict === "needs_correction"
          ? t.verdicts.needs_correction
          : "";

  const hasBand = evaluation.overallEstimate !== null;

  return (
    <div className="flex flex-col gap-4" data-evaluated-by={evaluation.providerId}>
      <Card className="flex flex-col items-center gap-2 py-6 text-center">
        {hasBand ? (
          <>
            <span className="text-xs uppercase tracking-wide text-ink-300">{t.estimatedBand}</span>
            <span className="font-display text-4xl text-ink-900">
              {evaluation.overallEstimate?.toFixed(1)}
            </span>
          </>
        ) : (
          <>
            <span className="text-xs uppercase tracking-wide text-ink-300">{t.overallVerdict}</span>
            <span className="font-display text-2xl text-ink-900">
              {verdictLabel(evaluation.verdict)}
            </span>
          </>
        )}
        <span className="text-xs text-ink-500">
          {t.confidence}: {(evaluation.confidence * 100).toFixed(0)}%
        </span>
        <span className="text-xs text-ink-300">{t.automatedNotice}</span>
      </Card>

      {evaluation.fallbackUsed && (
        <Card className="bg-signal-100/40">
          <p className="text-xs text-signal-700">
            {t.fallbackNotice}
            {evaluation.fallbackFrom ? ` (${evaluation.fallbackFrom})` : ""}
          </p>
        </Card>
      )}

      {evaluation.criteria.length > 0 && (
        <Card>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-300">{t.criteria}</p>
          <div className="flex flex-col">
            {evaluation.criteria.map((criterion) => (
              <div
                key={criterion.key}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-100 py-2 last:border-0"
              >
                <div className="flex flex-col">
                  <span className="text-sm text-ink-700">
                    {criterionLabel(criterion.key) || criterion.label}
                  </span>
                  {criterion.note && <span className="text-xs text-ink-500">{criterion.note}</span>}
                </div>
                {criterion.limited || criterion.band === null ? (
                  <span className="badge-locked">{t.limited}</span>
                ) : (
                  <BandBadge band={criterion.band} />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {evaluation.issues.length > 0 && (
        <Card className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-300">{t.issues}</p>
          {evaluation.issues.map((issue, index) => (
            <div key={`${issue.category}-${index}`} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-500">
                {categoryLabel(issue.category)} · {issue.severity}
              </span>
              <span className="text-sm text-ink-900">{issue.message}</span>
              {issue.excerpt && (
                <span className="rounded-sm bg-paper-sunken p-2 font-mono text-xs text-ink-700">
                  {issue.excerpt}
                </span>
              )}
              {issue.suggestion && (
                <span className="text-xs text-ink-500">
                  {t.suggestion}: {issue.suggestion}
                </span>
              )}
            </div>
          ))}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ListCard title={t.strengths} items={evaluation.strengths} />
        <ListCard title={t.weaknesses} items={evaluation.weaknesses} />
      </div>

      <ListCard title={t.nextActions} items={evaluation.nextActions} />

      {evaluation.recommendedExercises.length > 0 && (
        <Card className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-300">{t.recommended}</p>
          <div className="flex flex-col gap-2">
            {evaluation.recommendedExercises.map((exercise, index) => (
              <div key={`${exercise.label}-${index}`} className="flex flex-col">
                {exercise.href ? (
                  <Link className="btn-secondary" href={exercise.href}>
                    {exercise.label}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-ink-900">{exercise.label}</span>
                )}
                {exercise.reason && <span className="text-xs text-ink-500">{exercise.reason}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-300">
        <span>
          {heading ? `${heading} · ` : ""}
          {t.versionInfo}: {evaluation.providerVersion}
          {evaluation.model ? ` · ${evaluation.model}` : ""} · {t.processedIn}{" "}
          {evaluation.processedInMs}ms
        </span>
        {/* The evaluator that actually produced this result. */}
        <span
          className="badge bg-signal-100 text-signal-700"
          data-checked-by={evaluation.checkedByName}
          title={
            evaluation.providerType === "internal"
              ? "Learners Area internal evaluator"
              : "External provider"
          }
        >
          {t.checkedBy} {evaluation.checkedByName}
        </span>
      </div>
    </div>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="flex flex-col gap-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-300">{title}</p>
      <ul className="list-inside list-disc space-y-1 text-sm text-ink-500">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </Card>
  );
}

export function categoryText(dict: Dictionary, category: WeaknessCategory): string {
  const labels = dict.coach.categoryLabels as Record<string, string | undefined>;
  return labels[category] ?? category;
}
