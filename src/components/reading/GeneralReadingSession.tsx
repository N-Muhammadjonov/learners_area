"use client";

import Link from "next/link";
import { useFocusEntry } from "@/lib/interaction/focus-entry";
import { useEffect, useRef, useState } from "react";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { ReadAloud } from "@/components/reading/ReadAloud";
import { choiceSetFor } from "@/lib/reading-choices";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import { occurrenceSpans, type OccurrenceSpan } from "@/lib/services/lexical/occurrence-spans";
import type { Dictionary } from "@/lib/i18n/en";

/*
 * General Reading — LEARNING mode (develop reading). Vocabulary help is on from the
 * first second, in every passage and in Full Reading: there is no attempt, no lock
 * and no timer deciding permissions. The text uses the SAME ClickableText → occurrence
 * → canonical sense → popup → save path as every other contextual source; the
 * server re-derives the mode from the passage's persisted classification.
 */

export type GeneralQuestion = { id: string; questionNo: number | null; order: number; type: string; questionText: string; options: string[] | null };
export type GeneralPassage = {
  passageNo: number;
  passageId: string;
  title: string;
  body: string;
  paragraphs: { id: string; label: string | null; text: string; isFootnote: boolean }[];
  questions: GeneralQuestion[];
  occurrences: OccurrenceSpan[];
};
export type GeneralProgressView = { answers: Record<string, string>; score: number | null; total: number | null; checked: boolean };
type CheckRow = { questionId: string; isCorrect: boolean; correctAnswer: string; evidenceQuote: string | null; explanation: string | null };

export function GeneralReadingSession({ dict, setId, setTitle, passages, initialProgress, mode }: {
  dict: Dictionary;
  setId: string;
  setTitle: string;
  passages: GeneralPassage[];
  initialProgress: Record<string, GeneralProgressView>;
  /** "full" = all passages in one session; otherwise the single chosen passage number. */
  mode: "full" | 1 | 2 | 3;
}) {
  useFocusEntry(`general-reading:${setId}:${mode}`);
  const t = dict.generalReading;
  const [active, setActive] = useState(passages[0]?.passageNo ?? 1);
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(passages.map((p) => [p.passageId, initialProgress[p.passageId]?.answers ?? {}])));
  const [status, setStatus] = useState<Record<string, "idle" | "saving" | "saved" | "error" | "checking">>({});
  const [checks, setChecks] = useState<Record<string, { rows: CheckRow[]; score: number | null; total: number | null }>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const passage = passages.find((p) => p.passageNo === active) ?? passages[0];
  if (!passage) return null;

  async function persist(passageId: string, nextAnswers: Record<string, string>, check: boolean) {
    setStatus((s) => ({ ...s, [passageId]: check ? "checking" : "saving" }));
    const result = await requestJson<{ ok: boolean; score: number | null; total: number | null; result: CheckRow[] | null }>("/api/reading/general/progress", {
      method: "POST", body: { passageId, answers: nextAnswers, check },
    });
    if (!result.ok) {
      setStatus((s) => ({ ...s, [passageId]: "error" }));
      setErrors((e) => ({ ...e, [passageId]: failureMessage(result, dict.auth) || t.saveFailed }));
      return;
    }
    setErrors((e) => ({ ...e, [passageId]: null }));
    setStatus((s) => ({ ...s, [passageId]: "saved" }));
    if (check && result.data.result) setChecks((c) => ({ ...c, [passageId]: { rows: result.data.result!, score: result.data.score, total: result.data.total } }));
  }

  function setAnswer(passageId: string, questionId: string, value: string) {
    const next = { ...(answers[passageId] ?? {}), [questionId]: value };
    setAnswers((a) => ({ ...a, [passageId]: next }));
    clearTimeout(timers.current[passageId]);
    // Debounced autosave per passage: progress of each passage is independent.
    timers.current[passageId] = setTimeout(() => void persist(passageId, next, false), 700);
  }

  const check = checks[passage.passageId];
  const initial = initialProgress[passage.passageId];
  const shownScore = check ? { score: check.score, total: check.total } : initial?.checked ? { score: initial.score, total: initial.total } : null;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5" data-general-reading data-general-mode={mode}>
      <header className="flex flex-col gap-2">
        <Link href="/app/reading/general" prefetch={false} className="link-inline w-fit text-sm">{t.back}</Link>
        <h1 className="section-title">{setTitle}</h1>
        <p className="body-text text-sm" data-learning-note>{t.learningNote}</p>
        <Link href={`/app/reading/general/${setId}`} prefetch={false} className="link-inline w-fit text-xs">{t.changeMode}</Link>
      </header>

      {mode === "full" && passages.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label={t.full} data-general-passage-tabs>
          {passages.map((p) => (
            <button key={p.passageNo} type="button" aria-pressed={p.passageNo === active}
              className={p.passageNo === active ? "btn-primary" : "btn-secondary"} onClick={() => setActive(p.passageNo)} data-general-passage-tab={p.passageNo}>
              {t.passageN.replace("{n}", String(p.passageNo))}
            </button>
          ))}
        </nav>
      )}

      <div className="grid gap-5 lg:grid-cols-2" key={passage.passageId} data-general-passage={passage.passageNo}>
        <section className="card flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-3">
            <h2 className="font-display text-base text-ink-900">
              <span className="mr-2 text-ink-500">{t.passageN.replace("{n}", String(passage.passageNo))}</span>{passage.title}
            </h2>
            <ReadAloud dict={dict} text={`${passage.title}. ${passage.body}`} />
          </div>
          <div className="flex flex-col gap-4 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-2" data-passage-body>
            {passage.paragraphs.length > 0 ? passage.paragraphs.map((paragraph) => (
              <div key={paragraph.id} className="flex gap-3">
                {paragraph.label ? <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-sunken text-xs font-semibold text-ink-700">{paragraph.label}</span> : null}
                <ClickableText dict={dict} text={paragraph.text} occurrences={occurrenceSpans(passage.body, paragraph.text, passage.occurrences)}
                  sourceType="reading" sourceId={passage.passageId} lexicalAssistance
                  className={`academic-text text-sm leading-relaxed text-ink-700 ${paragraph.isFootnote ? "italic" : ""}`} />
              </div>
            )) : (
              <ClickableText dict={dict} text={passage.body} occurrences={occurrenceSpans(passage.body, passage.body, passage.occurrences)}
                sourceType="reading" sourceId={passage.passageId} lexicalAssistance className="academic-text text-sm leading-relaxed text-ink-700" />
            )}
          </div>
        </section>

        <section className="card flex flex-col gap-4 p-5" data-general-questions>
          <div className="flex items-center justify-between gap-2">
            <h2 className="card-title">{t.questions}</h2>
            <span className="text-xs text-ink-500" role="status" aria-live="polite" data-general-save-state={status[passage.passageId] ?? "idle"}>
              {status[passage.passageId] === "saving" ? t.saving : status[passage.passageId] === "saved" ? t.saved : ""}
            </span>
          </div>
          {passage.questions.length === 0 && <p className="body-text text-sm">{t.noQuestions}</p>}
          <ol className="flex flex-col gap-4">
            {passage.questions.map((question) => {
              const value = answers[passage.passageId]?.[question.id] ?? "";
              const row = check?.rows.find((r) => r.questionId === question.id);
              const name = `q-${question.id}`;
              const choices = question.type === "true_false_not_given" || question.type === "yes_no_not_given"
                ? Object.values(choiceSetFor(question.type)).map((c) => ({ value: c.value, label: c.label }))
                : question.type === "multiple_choice" && question.options?.length ? question.options.map((o) => ({ value: o, label: o })) : null;
              return (
                <li key={question.id} className="flex flex-col gap-2" data-general-question={question.id}>
                  <p className="text-sm text-ink-900"><span className="mr-2 font-semibold">{question.questionNo ?? question.order}</span>{question.questionText}</p>
                  {choices ? (
                    <div className="flex flex-wrap gap-3" role="radiogroup">
                      {choices.map((choice) => (
                        <label key={choice.value} className="flex items-center gap-2 text-sm">
                          <input type="radio" name={name} value={choice.value} checked={value === choice.value} onChange={() => setAnswer(passage.passageId, question.id, choice.value)} />
                          {choice.label}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <input className="input max-w-sm" maxLength={500} value={value} aria-label={String(question.questionNo ?? question.order)}
                      onChange={(event) => setAnswer(passage.passageId, question.id, event.target.value)} />
                  )}
                  {row && (
                    <div className={`rounded-sm p-2 text-xs ${row.isCorrect ? "bg-signal-50 text-ink-900" : "bg-paper-sunken text-ink-700"}`} data-general-result={row.isCorrect ? "correct" : "incorrect"}>
                      <p>{row.isCorrect ? "✓" : "✗"} {t.correctAnswer.replace("{answer}", row.correctAnswer)}</p>
                      {/* Evidence is answer support, rendered as plain text: it never becomes a vocabulary target or selects a sense. */}
                      {row.evidenceQuote ? <p className="mt-1 italic" data-general-evidence>{t.evidence} {row.evidenceQuote}</p> : <p data-general-evidence-missing>{dict.readingV4.evidenceMissing}</p>}
                      {row.explanation ? <p className="mt-1" data-general-explanation>{dict.reading.explanation}: {row.explanation}</p> : <p data-general-explanation-missing>{dict.readingV4.explanationMissing}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {passage.questions.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" disabled={status[passage.passageId] === "checking"}
                onClick={() => { clearTimeout(timers.current[passage.passageId]); void persist(passage.passageId, answers[passage.passageId] ?? {}, true); }} data-general-check>
                {status[passage.passageId] === "checking" ? t.checking : t.check}
              </button>
              {shownScore && shownScore.total !== null && (
                <span className="text-sm text-ink-700" data-general-score>{t.score.replace("{score}", String(shownScore.score ?? 0)).replace("{total}", String(shownScore.total))}</span>
              )}
            </div>
          )}
          {errors[passage.passageId] && <p role="alert" className="text-sm text-ink-900">{errors[passage.passageId]}</p>}
        </section>
      </div>
    </div>
  );
}
