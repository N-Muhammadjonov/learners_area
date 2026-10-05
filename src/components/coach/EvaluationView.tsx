import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { BandBadge } from "@/components/ui/Badge";
import type { Dictionary } from "@/lib/i18n/en";
import type { EvaluationRecord } from "@/lib/data/evaluations";
import type { WeaknessCategory } from "@/lib/services/coach/schema";
import { PUBLIC_CHECKED_BY, staffProvenanceLabel } from "@/lib/services/coach/attribution";

/**
 * Renders a normalized Coach evaluation.
 *
 * Two rules are enforced by this component rather than by convention:
 *
 *  - Attribution has two audiences. Learners (the default) see only "Checked by
 *    RIWI": no provider id, vendor, model, version or fallback source reaches
 *    their HTML. `audience="staff"` adds the truthful stored provenance line
 *    (actual provider, type, model, versions, fallback) for audit.
 *  - A criterion the evaluator could not judge (`limited`) is shown as "Not
 *    assessed" instead of a number. RIWI's speaking pronunciation entry is the
 *    live example: no pronunciation band is displayed because none exists.
 */
export function EvaluationView({
  dict,
  evaluation,
  heading,
  audience = "learner",
}: {
  dict: Dictionary;
  evaluation: EvaluationRecord;
  heading?: string;
  audience?: "learner" | "staff";
}) {
  const staff = audience === "staff";
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
    <div className="flex flex-col gap-4" data-evaluated-by={staff ? evaluation.providerId : PUBLIC_CHECKED_BY}>
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
            {staff && evaluation.fallbackFrom ? ` (${evaluation.fallbackFrom})` : ""}
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

      {evaluation.teachingFeedback && (
        <Card className="flex flex-col gap-3" data-teaching-feedback>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-300">{t.teachingFeedback}</p>
          {evaluation.teachingFeedback.simpleExplanation && <p className="text-sm text-ink-800"><strong>{t.simpleExplanation}: </strong>{evaluation.teachingFeedback.simpleExplanation}</p>}
          {evaluation.teachingFeedback.evidence.length > 0 && <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-ink-700">{t.evidence}</p>
            {evaluation.teachingFeedback.evidence.map((item, index) => <div key={`${item.excerpt}-${index}`} className="rounded-lg bg-paper-sunken p-3">
              <blockquote className="font-mono text-xs text-ink-700">“{item.excerpt}”</blockquote>
              <p className="mt-1 text-sm text-ink-800">{item.point}</p>
              {item.correction && <p className="mt-1 text-xs text-ink-600"><strong>{t.suggestion}: </strong>{item.correction}</p>}
            </div>)}
          </div>}
          {evaluation.teachingFeedback.steps.length > 0 && <div>
            <p className="text-xs font-semibold text-ink-700">{t.practiceSteps}</p>
            <ol className="mt-1 list-inside list-decimal space-y-1 text-sm text-ink-700">{evaluation.teachingFeedback.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
          </div>}
          {evaluation.teachingFeedback.examples.length > 0 && <div>
            <p className="text-xs font-semibold text-ink-700">{t.examples}</p>
            <ul className="mt-1 space-y-2">{evaluation.teachingFeedback.examples.map((example, index) => <li key={index} className="rounded-lg border border-ink-100 bg-white p-3 text-sm">
              {example.before && <p><strong>{t.before}: </strong>{example.before}</p>}
              <p><strong>{t.after}: </strong>{example.after}</p>
              {example.explanation && <p className="mt-1 text-xs text-ink-500">{example.explanation}</p>}
            </li>)}</ul>
          </div>}
          {evaluation.teachingFeedback.illustration && <p className="rounded-lg bg-signal-50 p-3 text-sm text-signal-900"><strong>{t.illustration}: </strong>{evaluation.teachingFeedback.illustration}</p>}
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
          {staff ? (
            <span data-staff-provenance>{staffProvenanceLabel(evaluation)} · </span>
          ) : null}
          {t.processedIn} {evaluation.processedInMs}ms
        </span>
        {/* The evaluator that actually produced this result. */}
        <span
          className="badge bg-signal-100 text-signal-700"
          data-checked-by={PUBLIC_CHECKED_BY}
        >
          {t.checkedBy} {PUBLIC_CHECKED_BY}
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
