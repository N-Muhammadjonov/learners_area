"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { ternaryLabel } from "@/lib/reading-choices";
import type { Dictionary } from "@/lib/i18n/en";
import type { readingQuestions, readingAnswers } from "@/db/schema";

type Question = typeof readingQuestions.$inferSelect;
type Answer = typeof readingAnswers.$inferSelect;

const answerLabel = (type: Question["type"], raw: string): string => {
  if (type !== "true_false_not_given" && type !== "yes_no_not_given") return raw;
  return ternaryLabel(type, raw);
};

const TYPE_LABELS: Record<Question["type"], { en: string; uz: string }> = {
  true_false_not_given: { en: "True / False / Not Given", uz: "True / False / Not Given" },
  yes_no_not_given: { en: "Yes / No / Not Given", uz: "Yes / No / Not Given" },
  multiple_choice: { en: "Multiple choice", uz: "Ko'p tanlovli" },
  short_answer: { en: "Short answer", uz: "Qisqa javob" },
};

/**
 * The post-test analysis.
 *
 * Everything on this page comes from rows the student's own attempt produced:
 * their answer, the answer key, the evidence the author quoted, the author's
 * explanation. The question-type table is counted from submitted answers only,
 * so a type never claims a mastery it has not been tested on. The passage itself
 * is clickable, so a word that caused the mistake can be saved right here.
 */
export function ReadingAnalysis({
  dict,
  score,
  total,
  questions,
  answers,
  passageBody,
  passageTitle,
  attemptId,
  passageLevel,
  locale,
}: {
  dict: Dictionary;
  score: number | null;
  total: number | null;
  questions: Question[];
  answers: Answer[];
  passageBody?: string;
  passageTitle?: string;
  attemptId?: string;
  /** The passage's own level (A2…C2) — the recall drill adapts its target to it. */
  passageLevel?: string | null;
  /** The reader's language, decided by the request (cookie), never guessed. */
  locale: "en" | "uz";
}) {
  const answerByQuestion = useMemo(
    () => new Map(answers.map((a) => [a.questionId, a])),
    [answers]
  );
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [kept, setKept] = useState<Record<string, boolean>>({});

  // How much a reader at this level should be able to reproduce from memory. The
  // target rises with the level; nothing here is scored — the student compares
  // their own recall with the passage, which is the whole point of the drill.
  const level = (passageLevel ?? "B2").toUpperCase();
  const retentionTarget = level >= "C1" ? 5 : level === "B2" ? 4 : 3;
  const retentionChecks: { key: string; label: string }[] = [
    { key: "main", label: dict.reading.retentionCheckMain },
    { key: "details", label: `${dict.reading.retentionCheckDetails} (${retentionTarget - 1})` },
    ...(level >= "B2" ? [{ key: "evidence", label: dict.reading.retentionCheckEvidence }] : []),
    ...(level >= "C1" ? [{ key: "conclusion", label: dict.reading.retentionCheckConclusion }] : []),
  ];
  const keptCount = retentionChecks.filter((c) => kept[c.key]).length;

  const byType = useMemo(() => {
    const rows = new Map<Question["type"], { correct: number; total: number }>();
    for (const question of questions) {
      const answer = answerByQuestion.get(question.id);
      if (!answer) continue;
      const row = rows.get(question.type) ?? { correct: 0, total: 0 };
      row.total += 1;
      if (answer.isCorrect) row.correct += 1;
      rows.set(question.type, row);
    }
    return [...rows.entries()].map(([type, row]) => ({
      type,
      ...row,
      ratio: row.total ? row.correct / row.total : 0,
    }));
  }, [questions, answerByQuestion]);

  const weakest = byType.length
    ? byType.reduce((worst, row) => (row.ratio < worst.ratio ? row : worst), byType[0]!)
    : null;

  // `locale` is a property of the request, passed down by the server page. It used
  // to be inferred by comparing a translated string against a literal, which fell
  // back to English the moment that translation was reworded.

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col items-center gap-1 py-6 text-center">
        <span className="text-xs uppercase tracking-wide text-ink-300">{dict.reading.score}</span>
        <span className="font-display text-4xl text-ink-900">
          {score}/{total}
        </span>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink-900">{dict.reading.typeMastery}</h2>
        <p className="text-xs text-ink-300">{dict.reading.typeMasteryHint}</p>
        {byType.length === 0 ? (
          <p className="text-sm text-ink-500">{dict.reading.noTypeData}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-type-mastery>
            {byType.map((row) => (
              <li key={row.type} className="flex items-center gap-3" data-type={row.type}>
                <span className="w-40 shrink-0 text-xs text-ink-700">{TYPE_LABELS[row.type][locale]}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunken">
                  <span
                    className={`block h-full ${row.ratio >= 0.8 ? "bg-band-good" : row.ratio >= 0.5 ? "bg-band-warn" : "bg-band-bad"}`}
                    style={{ width: `${Math.round(row.ratio * 100)}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-xs text-ink-500">
                  {row.correct}/{row.total}
                </span>
              </li>
            ))}
          </ul>
        )}
        {weakest && (
          <p className="text-xs text-ink-500">
            {dict.reading.weakTypeNote}: <strong className="text-ink-900">{TYPE_LABELS[weakest.type][locale]}</strong>{" "}
            ({weakest.correct}/{weakest.total})
          </p>
        )}
      </Card>

      {passageBody && attemptId && (
        <Card className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink-900">{dict.reading.retentionTitle}</h2>
            <button
              type="button"
              className="btn-ghost text-xs"
              data-retention-toggle
              aria-expanded={retentionOpen}
              onClick={() => setRetentionOpen((open) => !open)}
            >
              {retentionOpen ? dict.reading.retentionShow : dict.reading.retentionHide}
            </button>
          </div>
          <p className="text-xs text-ink-500">{dict.reading.retentionHint}</p>
          <p className="text-xs text-ink-300" data-retention-target={retentionTarget} data-retention-level={level}>
            {dict.reading.retentionGoal.replace("{count}", String(retentionTarget)).replace("{level}", level)}
          </p>
          <textarea
            className="input min-h-[110px]"
            data-retention-input
            placeholder={dict.reading.retentionPlaceholder}
          />
          {/* The self-check is a checklist, not a score: the student marks what they
              actually reproduced before revealing the passage. */}
          <ul className="flex flex-wrap gap-3" data-retention-checklist>
            {retentionChecks.map((item) => (
              <li key={item.key}>
                <label className="flex items-center gap-2 text-xs text-ink-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    data-retention-check={item.key}
                    checked={Boolean(kept[item.key])}
                    onChange={(e) => setKept((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                  />
                  {item.label}
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-300" data-retention-kept={keptCount}>
            {dict.reading.retentionKept.replace("{kept}", String(keptCount)).replace("{count}", String(retentionChecks.length))}
          </p>
          {/*
            The passage is rendered once and hidden with CSS while the student
            recalls it. This is a recall aid, not an exam: nothing here is scored,
            so a student who peeks only cheats their own practice.
          */}
          <div
            className={`rounded-sm bg-paper-sunken p-3 ${retentionOpen ? "" : "hidden"}`}
            data-retention-passage
          >
            <p className="mb-1 text-xs font-medium text-ink-500">{passageTitle}</p>
            <ClickableText
              dict={dict}
              text={passageBody}
              sourceType="reading"
              sourceId={attemptId}
              className="text-sm leading-relaxed text-ink-700"
            />
            <p className="mt-2 text-xs text-ink-300">{dict.reading.retentionSelfCheck}</p>
          </div>
        </Card>
      )}

      {questions.map((q) => {
        const a = answerByQuestion.get(q.id);
        return (
          <Card key={q.id} className={a?.isCorrect ? "border-band-good/40" : "border-band-bad/40"}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-ink-900">
                {q.order}. {q.questionText}
              </p>
              <span className={`badge ${a?.isCorrect ? "bg-band-good/10 text-band-good" : "bg-band-bad/10 text-band-bad"}`}>
                {a?.isCorrect ? dict.reading.correct : dict.reading.incorrect}
              </span>
            </div>
            <p className="text-xs uppercase tracking-wide text-ink-300">
              {dict.reading.questionType}: {TYPE_LABELS[q.type][locale]}
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {dict.reading.yourAnswer}:{" "}
              <span className="text-ink-900">{a?.userAnswer ? answerLabel(q.type, a.userAnswer) : "—"}</span>
            </p>
            {!a?.isCorrect && (
              <p className="text-sm text-ink-500">
                {dict.reading.correctAnswer}:{" "}
                <span className="text-ink-900">{answerLabel(q.type, q.correctAnswer)}</span>
              </p>
            )}
            {q.evidenceQuote && (
              <p className="mt-1 text-xs italic text-ink-300" data-evidence={q.id}>
                {dict.reading.evidence}: &ldquo;{q.evidenceQuote}&rdquo;
              </p>
            )}
            {q.explanation && (
              <p className="mt-1 text-xs text-ink-500">
                <span className="text-ink-300">{dict.reading.explanation}: </span>
                {q.explanation}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
