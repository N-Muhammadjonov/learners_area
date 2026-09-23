import { Card } from "@/components/ui/Card";
import { BandBadge } from "@/components/ui/Badge";
import { AddVocabQuick } from "./AddVocabQuick";
import type { Dictionary } from "@/lib/i18n/en";
import type { writingFeedback } from "@/db/schema";

type Feedback = typeof writingFeedback.$inferSelect;

function CriterionRow({ label, band }: { label: string; band: number | null }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-100 py-2 last:border-0">
      <span className="text-sm text-ink-700">{label}</span>
      <BandBadge band={band} />
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink-900">{title}</p>
      <ul className="list-inside list-disc space-y-1 text-sm text-ink-500">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Teacher feedback — a separate track from the automated Coach evaluation.
 *
 * An automated evaluation never writes here and never overwrites a row here:
 * a teacher's judgement outranks a heuristic estimate, and the two are shown
 * side by side so it is always clear which is which.
 */
export function FeedbackView({
  dict,
  feedback,
  submissionId,
}: {
  dict: Dictionary;
  feedback: Feedback;
  submissionId: string;
}) {
  return (
    <div className="flex flex-col gap-4" data-feedback-source="teacher">
      <Card className="bg-signal-100/40">
        <p className="text-xs font-medium text-signal-700">{dict.teacher.teacherFeedbackLabel}</p>
      </Card>

      {feedback.overallBand !== null && (
        <Card className="flex flex-col items-center gap-1 py-6 text-center">
          <span className="text-xs uppercase tracking-wide text-ink-300">{dict.writing.overallBand}</span>
          <span className="font-display text-4xl text-ink-900">{feedback.overallBand.toFixed(1)}</span>
        </Card>
      )}

      {(feedback.taskResponseBand !== null ||
        feedback.coherenceBand !== null ||
        feedback.lexicalBand !== null ||
        feedback.grammarBand !== null) && (
        <Card>
          <CriterionRow label={dict.writing.taskResponse} band={feedback.taskResponseBand} />
          <CriterionRow label={dict.writing.coherence} band={feedback.coherenceBand} />
          <CriterionRow label={dict.writing.lexical} band={feedback.lexicalBand} />
          <CriterionRow label={dict.writing.grammar} band={feedback.grammarBand} />
        </Card>
      )}

      <Card className="flex flex-col gap-4">
        {feedback.comment && <p className="text-sm text-ink-900">{feedback.comment}</p>}
        <List title={dict.writing.strengths} items={feedback.strengths} />
        <List title={dict.writing.weaknesses} items={feedback.weaknesses} />
        <List title={dict.writing.suggestions} items={feedback.suggestions} />
      </Card>

      <Card>
        <AddVocabQuick dict={dict} sourceId={submissionId} />
      </Card>
    </div>
  );
}
