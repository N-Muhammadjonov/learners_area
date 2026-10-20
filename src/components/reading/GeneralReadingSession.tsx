"use client";

import { ReadingEvidence } from "@/components/reading/ReadingEvidence";
import { ReadingWorkspace, focusReadingQuestion } from "@/components/reading/ReadingWorkspace";
import { useFocusEntry } from "@/lib/interaction/focus-entry";
import { useEffect, useRef, useState } from "react";
import { ReadingHighlightedText, useReadingHighlights } from "@/components/reading/ReadingHighlights";
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
  const [pane,setPane]=useState<"passage"|"questions">("passage");
  const [pendingQuestion,setPendingQuestion]=useState<string|null>(null);
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

  useEffect(() => { document.getElementById("reading-passage-pane")?.scrollTo?.({top:0}); },[active]);
  useEffect(() => { if(pendingQuestion){focusReadingQuestion(pendingQuestion);setPendingQuestion(null);} },[active,pendingQuestion]);
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

  const currentAnswers=answers[passage.passageId]??{};
  const first=passage.questions[0]?.questionNo??1,last=passage.questions.at(-1)?.questionNo??first;
  return <div className="reading-session" data-general-reading data-general-mode={mode} data-general-passage={passage.passageNo}>
    <ReadingWorkspace brand={dict.marketing.title} title={setTitle} pane={pane} setPane={setPane} labels={dict.readingWorkspace}
      tools={<span role="status" aria-live="polite" data-general-save-state={status[passage.passageId]??"idle"}>{status[passage.passageId]==="saving"?t.saving:status[passage.passageId]==="saved"?t.saved:""}</span>}
      passage={<><h2 className="reading-pane-heading">{dict.readingWorkspace.passageHeading.replace("{n}",String(passage.passageNo))}</h2><p className="reading-part-instruction">{dict.readingWorkspace.questionRange.replace("{from}",String(first)).replace("{to}",String(last))}</p><h3 className="reading-passage-title">{passage.title}</h3>
        <div className="reading-passage-text" data-passage-body>
          {passage.paragraphs.length ? passage.paragraphs.map(paragraph=><div key={paragraph.id} className="reading-paragraph">
            {paragraph.label&&<strong className="reading-paragraph-label">{paragraph.label}</strong>}
            <ReadingHighlightedText {...highlightsFor(paragraph.id,paragraph.text)} dict={dict} text={paragraph.text} occurrences={occurrenceSpans(passage.body,paragraph.text,passage.occurrences)} sourceType="reading" sourceId={passage.passageId} lexicalAssistance phraseAware className={`academic-text ${paragraph.isFootnote?"italic":""}`} />
          </div>):<ReadingHighlightedText {...highlightsFor(passage.passageId,passage.body)} dict={dict} text={passage.body} occurrences={occurrenceSpans(passage.body,passage.body,passage.occurrences)} sourceType="reading" sourceId={passage.passageId} lexicalAssistance phraseAware className="academic-text"/>}
        </div></>}
      questions={<div data-general-questions><h2 className="reading-pane-heading">{dict.readingWorkspace.questionRange.replace("{from}",String(first)).replace("{to}",String(last))}</h2>
        {!passage.questions.length&&<p>{t.noQuestions}</p>}
        <div className="reading-question-blocks">
          {(passage.groups??[]).map(group=><section key={group.id} className="reading-question-group"><GroupHeading dict={dict} group={group}/><GroupQuestions dict={dict} group={group} questions={passage.questions.filter(q=>q.groupId===group.id).map(examQuestion)} answers={currentAnswers} onChange={(id,value)=>setAnswer(passage.passageId,id,value)}/></section>)}
          {passage.questions.filter(q=>!q.groupId||!passage.groups?.some(g=>g.id===q.groupId)).map(q=><QuestionCard key={q.id} dict={dict} question={examQuestion(q)} group={null} inputId={`answer-${q.id}`} value={currentAnswers[q.id]??""} onChange={value=>setAnswer(passage.passageId,q.id,value)}/>)}
        </div>
        <ol className="reading-feedback">{check?.rows.map(row=><li key={row.questionId} data-general-question={row.questionId}><div data-general-result={row.isCorrect?"correct":"incorrect"}>
          <p>{row.isCorrect?"✓":"✗"} {t.correctAnswer.replace("{answer}",row.correctAnswer)}</p>
          {!!row.acceptedAnswers?.length&&<p data-general-accepted>{dict.readingPractice.acceptedAnswers}: {row.acceptedAnswers.join(" / ")}</p>}
          {row.evidenceQuote?<p data-general-evidence>{t.evidence} {row.evidenceQuote}</p>:<p data-general-evidence-missing>{dict.readingV4.evidenceMissing}</p>}
          {row.evidenceQuote&&<ReadingEvidence dict={dict} body={passage.body} title={passage.title} quote={row.evidenceQuote}/>}
          {row.explanation?<p data-general-explanation>{dict.reading.explanation}: {row.explanation}</p>:<p data-general-explanation-missing>{dict.readingV4.explanationMissing}</p>}
        </div></li>)}</ol>
        {errors[passage.passageId]&&<p role="alert" className="reading-error">{errors[passage.passageId]}</p>}
      </div>}
      navigation={<div className="reading-part-navigation" data-general-passage-tabs>{passages.map(p=><div key={p.passageNo} className="reading-part-navigation">
        <button type="button" className="reading-part-button" aria-pressed={p.passageNo===active} data-general-passage-tab={p.passageNo} onClick={()=>setActive(p.passageNo)}>{t.passageN.replace("{n}",String(p.passageNo))}</button>
        {p.passageNo===active&&<div className="reading-question-numbers">{p.questions.map(q=><button key={q.id} type="button" data-reading-question-nav={q.id} data-answered={!!currentAnswers[q.id]?.trim()} aria-label={`${dict.reading.yourAnswer} ${q.questionNo??q.order}`} onClick={()=>{setPane("questions");setPendingQuestion(q.id);}}>{q.questionNo??q.order}</button>)}</div>}
      </div>)}</div>}
      action={<>{shownScore&&shownScore.total!==null&&<span data-general-score>{t.score.replace("{score}",String(shownScore.score??0)).replace("{total}",String(shownScore.total))}</span>}{passage.questions.length>0&&<button type="button" className="btn-primary" disabled={status[passage.passageId]==="checking"} onClick={()=>{clearTimeout(timers.current[passage.passageId]);void persist(passage.passageId,currentAnswers,true);}} data-general-check>{status[passage.passageId]==="checking"?t.checking:t.check}</button>}</>}
    />
  </div>;
}

function examQuestion(q:GeneralQuestion):ExamQuestion {
  return {...q,type:q.type as ExamQuestion["type"],typeCode:q.typeCode??null,groupId:q.groupId??null,renderMode:q.renderMode??null,answerConstraint:q.answerConstraint??null};
}
