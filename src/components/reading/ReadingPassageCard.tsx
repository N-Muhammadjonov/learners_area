import Link from "next/link";
import { StartPassageButton } from "@/components/reading/StartPassageButton";
import { IconChevronRight, IconReading } from "@/components/ui/icons";
import type { Dictionary } from "@/lib/i18n/en";
import type { ReadingPassageCard as CardData } from "@/lib/data/reading-library";
import { topicLabel } from "@/lib/reading-labels";

/**
 * One passage in the library.
 *
 * The card answers the three questions a student has before clicking: what is
 * this, how big is it, and what have I already done with it. The third one is
 * why the action changes — "Start" on something never opened, "Resume" on an
 * attempt left in the middle (which returns to that attempt, not to a new one),
 * and "Try again" once it is finished, with the score it earned.
 *
 * A status is never shown without the thing that produced it.
 */
export function ReadingPassageCard({
  passage,
  dict,
  lang,
}: {
  passage: CardData;
  dict: Dictionary;
  lang: "uz" | "en";
}) {
  const position =
    passage.passageNo && passage.testNo
      ? `Test ${passage.testNo} · Passage ${passage.passageNo}`
      : passage.passageNo
        ? `Passage ${passage.passageNo}`
        : null;

  const statusLabel =
    passage.status === "completed"
      ? dict.readingHub.stateCompleted
      : passage.status === "in_progress"
        ? dict.readingHub.stateInProgress
        : dict.readingHub.stateNotStarted;

  const action = passage.status === "completed" ? dict.readingHub.actionRetry : dict.readingHub.actionStart;
  const topic = topicLabel(passage.topicCode, lang);

  return (
    <article className="panel flex h-full flex-col gap-3" data-passage={passage.id} data-passage-status={passage.status}>
      <div className="flex items-start justify-between gap-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ink-100 bg-paper-sunken text-[20px] text-gold">
          <IconReading />
        </span>
        <span
          className={
            passage.status === "completed"
              ? "chip chip-done"
              : passage.status === "in_progress"
                ? "chip chip-active"
                : "chip"
          }
          data-passage-state={passage.status}
        >
          {statusLabel}
        </span>
      </div>

      <h3 className="card-title leading-snug">{passage.title}</h3>

      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-ink-500">
        {position && <dd>{position}</dd>}
        <dd>{dict.readingHub.questionsShort.replace("{n}", String(passage.questionCount))}</dd>
        <dd>
          {passage.suggestedMinutes} {dict.reading.minutes}
        </dd>
        {topic && <dd>{topic}</dd>}
      </dl>

      {passage.status === "completed" && passage.lastScore !== null && (
        <p className="text-[0.875rem] text-ink-700" data-passage-score>
          {dict.readingHub.scoreShort
            .replace("{score}", String(passage.lastScore))
            .replace("{total}", String(passage.questionCount))}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        {passage.status === "in_progress" && passage.lastAttemptId ? (
          <Link
            href={`/reading/attempts/${passage.lastAttemptId}`}
            className="btn-primary min-h-[var(--control-h)]"
            data-passage-action="resume"
          >
            {dict.readingHub.actionResume}
          </Link>
        ) : (
          <StartPassageButton passageId={passage.id} label={action} />
        )}

        {passage.status === "completed" && (
          <Link
            href="/reading/history"
            className="inline-flex items-center gap-1 text-[0.875rem] font-medium text-ink-500 hover:text-ink-900"
          >
            {dict.reading.historyTitle}
            <IconChevronRight className="text-[15px]" />
          </Link>
        )}
      </div>
    </article>
  );
}
