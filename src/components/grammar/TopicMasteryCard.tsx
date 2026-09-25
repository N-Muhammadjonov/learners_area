import { Card } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/en";
import { MASTERY_SESSIONS, type TopicMastery } from "@/lib/services/grammar/mastery";

const ACTIVITY_LABEL: Record<string, "correctIt" | "translateIt" | "activateIt"> = {
  correct_it: "correctIt",
  translate_it: "translateIt",
  activate_it: "activateIt",
};

/**
 * Topic mastery, drawn from the attempts themselves.
 *
 * The rule is shown, not implied: ~80% accuracy across all three activities on
 * three separate days. A topic that is 100% on one evening says exactly that.
 */
export function TopicMasteryCard({ dict, mastery }: { dict: Dictionary; mastery: TopicMastery }) {
  const t = dict.grammar;
  const label: Record<string, string> = {
    correctIt: t.correctIt,
    translateIt: t.translateTitle,
    activateIt: t.activateTitle,
  };

  return (
    <Card data-topic-mastery={mastery.mastered ? "mastered" : "in-progress"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg text-ink-900">{t.masteryTitle}</h2>
        <span
          className={`badge ${mastery.mastered ? "bg-band-good/10 text-band-good" : "bg-paper-sunken text-ink-500"}`}
          data-mastery-state={mastery.mastered ? "mastered" : "in-progress"}
        >
          {mastery.mastered ? t.masteryMastered : t.masteryInProgress}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-ink-700">
        <span data-mastery-score={mastery.scorePercent}>
          {t.masteryScore}: {mastery.scorePercent}%
        </span>
        <span data-mastery-sessions={mastery.sessions}>
          {t.masterySessions}: {mastery.sessions} {t.masteryOf} {MASTERY_SESSIONS}
        </span>
      </div>

      <ul className="mt-3 flex flex-col gap-1">
        {mastery.byActivity.map((entry) => (
          <li key={entry.activity} className="flex items-center justify-between text-xs text-ink-500">
            <span>{label[ACTIVITY_LABEL[entry.activity]!]}</span>
            <span data-mastery-activity={entry.activity}>
              {entry.attempted === 0
                ? t.masteryNotPractised
                : `${entry.percent}% · ${entry.correct}/${entry.attempted}`}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-ink-300">{t.masteryRule}</p>
      {!mastery.mastered && mastery.sessionsRemaining > 0 && mastery.attempted > 0 && (
        <p className="mt-1 text-xs text-ink-300" data-mastery-remaining>
          {t.masterySessionsLeft.replace("{n}", String(mastery.sessionsRemaining))}
        </p>
      )}
    </Card>
  );
}
