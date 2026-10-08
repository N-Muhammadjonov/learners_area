"use client";
import { ReadingEvidence } from "@/components/reading/ReadingEvidence";

import { questionTypeLabel } from "@/lib/reading-labels";
import { readingQuestionType } from "@/lib/reading/question-model";
import { useMemo, useState } from "react";
import { occurrenceSpans, type OccurrenceSpan } from "@/lib/services/lexical/occurrence-spans";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { Card } from "@/components/ui/Card";
import { RetentionCheck } from "@/components/reading/RetentionCheck";
import { ternaryLabel } from "@/lib/reading-choices";
import type { Dictionary } from "@/lib/i18n/en";
import type { readingQuestions, readingAnswers, readingQuestionGroups } from "@/db/schema";

type Question = typeof readingQuestions.$inferSelect;
type Answer = typeof readingAnswers.$inferSelect;
type Group = typeof readingQuestionGroups.$inferSelect;

const answerLabel = (type: Question["type"], raw: string): string => {
  if (type !== "true_false_not_given" && type !== "yes_no_not_given") return raw;
  return ternaryLabel(type, raw);
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
  groups = [],
  answers,
  passageBody,
  passageTitle,
  attemptId,
  passageLevel,
  locale,
  occurrences = [],
  passages = [],
}: {
  dict: Dictionary;
  score: number | null;
  total: number | null;
  questions: Question[];
  /** The instruction blocks the questions belong to (empty for older attempts). */
  groups?: Group[];
  answers: Answer[];
  passageBody?: string;
  passageTitle?: string;
  attemptId?: string;
  /** The passage's own level (A2…C2) — the recall drill adapts its target to it. */
  passageLevel?: string | null;
  /** The reader's language, decided by the request (cookie), never guessed. */
  locale: "en" | "uz";
  occurrences?: OccurrenceSpan[];
  passages?: {id:string;title:string;body:string}[];
}) {
  const answerByQuestion = useMemo(
    () => new Map(answers.map((a) => [a.questionId, a])),
    [answers]
  );

  const byType = useMemo(() => {
    const rows = new Map<string, { correct: number; total: number }>();
    for (const question of questions) {
      const answer = answerByQuestion.get(question.id);
      if (!answer) continue;
      const type=readingQuestionType(question.typeCode??question.type)?.id??question.type;
      const row = rows.get(type) ?? { correct: 0, total: 0 };
      row.total += 1;
      if (answer.isCorrect) row.correct += 1;
      rows.set(type, row);
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

  /**
   * Review order follows the paper: questions under the instructions they were
   * answered under, in their group's order. A question with no group keeps the
   * order it was stored in.
   */
  const ordered = useMemo(() => {
    const position = new Map(groups.map((group) => [group.id, group.position]));
    return [...questions].sort((a, b) => {
      const aPos = a.groupId ? (position.get(a.groupId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      const bPos = b.groupId ? (position.get(b.groupId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      return aPos === bPos ? a.order - b.order : aPos - bPos;
    });
  }, [questions, groups]);

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

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
        {/* The raw count is what the database really stores; no band is invented. */}
        <span className="text-xs text-ink-300">{dict.readingPractice.rawScoreNote}</span>
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
                <span className="w-40 shrink-0 text-xs text-ink-700">{questionTypeLabel(row.type,locale)}</span>
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
            {dict.reading.weakTypeNote}: <strong className="text-ink-900">{questionTypeLabel(weakest.type,locale)}</strong>{" "}
            ({weakest.correct}/{weakest.total})
          </p>
        )}
      </Card>

      {passageBody && attemptId && (
        <RetentionCheck
          dict={dict}
          passageTitle={passageTitle ?? ""}
          passageBody={passageBody}
          passageLevel={passageLevel}
          sourceId={attemptId}
          occurrences={occurrences}
          lexicalAssistance
        />
      )}

      {ordered.map((q, index) => {
        const evidencePassage = passages.find(p=>p.id===q.passageId);
        const a = answerByQuestion.get(q.id);
        const group = q.groupId ? groupById.get(q.groupId) : undefined;
        const isNewGroup = !!group && ordered[index - 1]?.groupId !== group.id;
        const alternatives = (q.acceptedAnswers ?? []).filter(
          (value) => value.trim().toLowerCase() !== q.correctAnswer.trim().toLowerCase()
        );
        return (
          <div key={q.id} className="flex flex-col gap-3">
            {isNewGroup && group && (
              <div className="rounded-[16px] border border-ink-100 bg-paper-sunken p-4" data-group-instructions={group.typeCode}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {group.displayTitle ??
                    dict.readingPractice.groupQuestions
                      .replace("{from}", String(group.fromQuestionNo ?? q.questionNo ?? q.order))
                      .replace("{to}", String(group.toQuestionNo ?? q.questionNo ?? q.order))}
                </p>
                {group.sharedChoices.length>0 && <ul>{group.sharedChoices.map(choice=><li key={choice}>{choice}</li>)}</ul>}
                {group.instructionsText && (
                  <p className="whitespace-pre-line text-sm text-ink-700">{group.instructionsText}</p>
                )}
              </div>
            )}
            <Card className={a?.isCorrect ? "border-band-good/40" : "border-band-bad/40"}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-ink-900">
                {q.questionNo ?? q.order}. {q.questionText.trim() || dict.readingPractice.chooseLetter}
              </p>
              <span className={`badge ${a?.isCorrect ? "bg-band-good/10 text-band-good" : "bg-band-bad/10 text-band-bad"}`}>
                {a?.isCorrect ? dict.reading.correct : dict.reading.incorrect}
              </span>
            </div>
            <p className="text-xs uppercase tracking-wide text-ink-300">
              {dict.reading.questionType}: {questionTypeLabel(q.typeCode??q.type,locale)}
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {dict.reading.yourAnswer}:{" "}
              <span className="text-ink-900">{a?.userAnswer ? answerLabel(q.type, a.userAnswer) : "—"}</span>
            </p>
            {
              <p className="text-sm text-ink-500">
                {dict.reading.correctAnswer}:{" "}
                <span className="text-ink-900">{answerLabel(q.type, q.correctAnswer)}</span>
              </p>
            }
            {/* The source's own accepted alternatives, shown only when they differ. */}
            {alternatives.length > 0 && (
              <p className="text-xs text-ink-300">
                {dict.readingPractice.acceptedAnswers}: {alternatives.join(", ")}
              </p>
            )}
            {q.evidenceQuote && (
              <div className="mt-1 text-xs italic text-ink-300" data-evidence={q.id}>
                {dict.reading.evidence}:
                {attemptId ? <ClickableText lexicalAssistance={false} dict={dict} text={q.evidenceQuote} occurrences={occurrenceSpans(passageBody ?? "", q.evidenceQuote, occurrences)} sourceType="reading" sourceId={attemptId} /> : q.evidenceQuote}
                {/* 82 of the source's questions have no locatable evidence line; saying
                    so is honest, inventing one would not be. */}
                {q.evidenceType === "missing_source" && (
                  <span className="ml-1 not-italic">({dict.readingPractice.evidenceMissing})</span>
                )}
              </div>
            )}
            {q.evidenceQuote && evidencePassage && <ReadingEvidence dict={dict} body={evidencePassage.body} title={evidencePassage.title} quote={q.evidenceQuote} />}
            {!q.evidenceQuote && <p className="text-xs text-ink-500" data-evidence-missing>{dict.readingV4.evidenceMissing}</p>}
            {q.explanation && (
              <div className="mt-1 text-xs text-ink-500">
                <span className="text-ink-300">{dict.reading.explanation}: </span>
                {attemptId ? <ClickableText lexicalAssistance={false} dict={dict} text={q.explanation} sourceType="reading" sourceId={attemptId} /> : q.explanation}
              </div>
            )}
            {!q.explanation && <p className="text-xs text-ink-500" data-explanation-missing>{dict.readingV4.explanationMissing}</p>}
            </Card>
          </div>
        );
      })}
    </div>
  );
}
