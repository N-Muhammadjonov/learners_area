"use client";

import Link from "next/link";
import { useFocusEntry } from "@/lib/interaction/focus-entry";
import { useEffect, useRef, useState } from "react";
import { ReadingHighlightedText, useReadingHighlights } from "@/components/reading/ReadingHighlights";
import { ReadAloud } from "@/components/reading/ReadAloud";
import { GroupHeading, GroupQuestions, QuestionCard, type ExamGroup, type ExamQuestion } from "@/components/reading/ReadingExam";
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

export type GeneralQuestion = { id: string; questionNo: number | null; order: number; type: string; questionText: string; options: string[] | null; typeCode?:string|null; groupId?:string|null; renderMode?:string|null; answerConstraint?:Record<string,unknown>|null };
export type GeneralPassage = {
  passageNo: number;
  passageId: string;
  title: string;
  body: string;
  paragraphs: { id: string; label: string | null; text: string; isFootnote: boolean }[];
  questions: GeneralQuestion[];
  groups?:ExamGroup[];
  occurrences: OccurrenceSpan[];
};
export type GeneralProgressView = { answers: Record<string, string>; score: number | null; total: number | null; checked: boolean; result?:CheckRow[]|null };
type CheckRow = { questionId: string; isCorrect: boolean; correctAnswer: string; acceptedAnswers?:string[]; evidenceQuote: string | null; explanation: string | null };

export function GeneralReadingSession({ dict, setId, setTitle, passages, initialProgress, mode, userId }: {
  dict: Dictionary;
  userId: string;
  setId: string;
  setTitle: string;
  passages: GeneralPassage[];
  initialProgress: Record<string, GeneralProgressView>;
  /** "full" = all passages in one session; otherwise the single chosen passage number. */
  mode: "full" | 1 | 2 | 3;
}) {
  useFocusEntry(`general-reading:${setId}:${mode}`);
  const t = dict.generalReading;
  const highlightsFor=useReadingHighlights(`${userId}:${setId}`);
  const [active, setActive] = useState(passages[0]?.passageNo ?? 1);
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(passages.map((p) => [p.passageId, initialProgress[p.passageId]?.answers ?? {}])));
  const [status, setStatus] = useState<Record<string, "idle" | "saving" | "saved" | "error" | "checking">>({});
  const [checks, setChecks] = useState<Record<string, { rows: CheckRow[]; score: number | null; total: number | null }>>(() =>
    Object.fromEntries(passages.flatMap(p => {
      const saved = initialProgress[p.passageId];
      return saved?.checked && saved.result ? [[p.passageId, { rows:saved.result, score:saved.score, total:saved.total }]] : [];
    })));
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const revisions=useRef<Record<string,number>>({});
  const queues=useRef<Record<string,Promise<void>>>({});
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const passage = passages.find((p) => p.passageNo === active) ?? passages[0];
  if (!passage) return null;

  async function persist(passageId: string, nextAnswers: Record<string, string>, check: boolean) {
    const revision=revisions.current[passageId]??0;
    const previous=queues.current[passageId]??Promise.resolve();
    let release!:()=>void;
    queues.current[passageId]=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try {
    setStatus((s) => ({ ...s, [passageId]: check ? "checking" : "saving" }));
    const result = await requestJson<{ ok: boolean; score: number | null; total: number | null; result: CheckRow[] | null }>("/api/reading/general/progress", {
      method: "POST", body: { passageId, answers: nextAnswers, check },
    });
    if(revision!==(revisions.current[passageId]??0)) return;
    if (!result.ok) {
      setStatus((s) => ({ ...s, [passageId]: "error" }));
      setErrors((e) => ({ ...e, [passageId]: failureMessage(result, dict.auth) || t.saveFailed }));
      return;
    }
    setErrors((e) => ({ ...e, [passageId]: null }));
    setStatus((s) => ({ ...s, [passageId]: "saved" }));
    if (check && result.data.result) setChecks((c) => ({ ...c, [passageId]: { rows: result.data.result!, score: result.data.score, total: result.data.total } }));
    } finally {release();}
  }

  function setAnswer(passageId: string, questionId: string, value: string) {
    revisions.current[passageId]=(revisions.current[passageId]??0)+1;
    setChecks(c=>{const next={...c};delete next[passageId];return next;});
    const next = { ...(answers[passageId] ?? {}), [questionId]: value };
    setAnswers((a) => ({ ...a, [passageId]: next }));
    clearTimeout(timers.current[passageId]);
    // Debounced autosave per passage: progress of each passage is independent.
    timers.current[passageId] = setTimeout(() => void persist(passageId, next, false), 700);
  }

  const check = checks[passage.passageId];
  const initial = initialProgress[passage.passageId];
  const shownScore = check ? { score: check.score, total: check.total } : initial?.checked && !revisions.current[passage.passageId] ? { score: initial.score, total: initial.total } : null;

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
                <ReadingHighlightedText {...highlightsFor(paragraph.id,paragraph.text)} dict={dict} text={paragraph.text} occurrences={occurrenceSpans(passage.body, paragraph.text, passage.occurrences)}
                  sourceType="reading" sourceId={passage.passageId} lexicalAssistance
                  className={`academic-text text-sm leading-relaxed text-ink-700 ${paragraph.isFootnote ? "italic" : ""}`} />
              </div>
            )) : (
              <ReadingHighlightedText {...highlightsFor(passage.passageId,passage.body)} dict={dict} text={passage.body} occurrences={occurrenceSpans(passage.body, passage.body, passage.occurrences)}
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
          <div className="flex flex-col gap-4">
            {(passage.groups??[]).map(group=><section key={group.id} className="flex flex-col gap-3">
              <GroupHeading dict={dict} group={group}/>
              <GroupQuestions dict={dict} group={group} questions={passage.questions.filter(q=>q.groupId===group.id).map(examQuestion)}
                answers={answers[passage.passageId]??{}} onChange={(id,value)=>setAnswer(passage.passageId,id,value)}/>
            </section>)}
            {passage.questions.filter(q=>!q.groupId || !passage.groups?.some(g=>g.id===q.groupId)).map(q=><QuestionCard key={q.id} dict={dict} question={examQuestion(q)} group={null}
              inputId={`answer-${q.id}`} value={answers[passage.passageId]?.[q.id]??""} onChange={value=>setAnswer(passage.passageId,q.id,value)}/>)}
          </div>
          <ol className="flex flex-col gap-4">
            {passage.questions.map((question) => {
              const row = check?.rows.find((r) => r.questionId === question.id);
              return (
                <li key={question.id} className="flex flex-col gap-2" data-general-question={question.id}>
                  {row && (
                    <div className={`rounded-sm p-2 text-xs ${row.isCorrect ? "bg-signal-50 text-ink-900" : "bg-paper-sunken text-ink-700"}`} data-general-result={row.isCorrect ? "correct" : "incorrect"}>
                      <p>{row.isCorrect ? "✓" : "✗"} {t.correctAnswer.replace("{answer}", row.correctAnswer)}</p>
                      {Boolean(row.acceptedAnswers?.length) && <p data-general-accepted>{dict.readingPractice.acceptedAnswers}: {row.acceptedAnswers!.join(" / ")}</p>}
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

function examQuestion(q:GeneralQuestion):ExamQuestion {
  return {...q,type:q.type as ExamQuestion["type"],typeCode:q.typeCode??null,groupId:q.groupId??null,renderMode:q.renderMode??null,answerConstraint:q.answerConstraint??null};
}
