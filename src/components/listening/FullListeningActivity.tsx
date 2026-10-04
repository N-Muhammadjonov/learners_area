"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";
import { ListeningMap } from "./ListeningMap";
import Image from "next/image";
import Link from "next/link";
import { ListeningSpeedPractice } from "./ListeningSpeedPractice";
import { McqMastery } from "./McqMastery";
import type { McqStage } from "@/lib/services/listening/mcq-mastery";
import { useEffect, useRef, useState } from "react";
import { type ListeningPackage } from "@/lib/listening/package";
import { ClickableText } from "@/components/vocabulary/ClickableText";
import { occurrenceSpans } from "@/lib/services/lexical/occurrence-spans";
import type { OccurrenceSpan } from "@/lib/services/lexical/occurrence-spans";
import type { VocabularySessionItem } from "@/lib/services/lexical/listening-occurrences";
import type { Dictionary } from "@/lib/i18n/en";
type Data = Partial<
  Pick<
    ListeningPackage,
    "questions" | "sections" | "keyword1" | "keyword2" | "mapDiagram" | "studyPack"
  >
> & {
  /** Activity 5: package-curated items whose lexical truth is the canonical sense. */
  vocabulary?: VocabularySessionItem[];
  questionSections?: Record<number,number>;
  report?: {
    score: number | null;
    total: number | null;
    answers: {
      number: number;
      userAnswer?: string;
      isCorrect?: boolean | null;
    }[];
  } | null;
  speeds?: number[];
  mcq?: { id: string; order: number; questionText: string; stage: McqStage }[];
};
export function FullListeningActivity({
  id,
  userId,
  title,
  activity,
  data,
  audioUrl,
  imageUrl,
  initial,
  dict,
  occurrences = {},
  segmentOccurrences = {},
  lexicalAssistance = false,
}: {
  id: string;
  userId: string;
  title: string;
  activity: number;
  data: Data;
  audioUrl: string | null;
  imageUrl?: string | null;
  initial: Record<string, string>;
  dict: Dictionary;
  occurrences?: Record<number, OccurrenceSpan[]>;
  segmentOccurrences?: Record<string, OccurrenceSpan[]>;
  /** Server decision from the Listening lexical policy (Review & Revision only). */
  lexicalAssistance?: boolean;
}) {
  const studyText = (text: string, key: string, inline = false, spans?: OccurrenceSpan[]) => <ClickableText dict={dict} text={text} sourceType="listening" sourceId={id} occurrences={spans ?? segmentOccurrences[key] ?? []} inline={inline} lexicalAssistance={lexicalAssistance} catalogueLookup />;
  const vocabularyRequest = useScopedResponse(12000);
  const [answers, setAnswers] = useState(initial);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ score: number | null; total: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [vocabSelection, setVocabSelection] = useState<number | null>(null);
  const [vocabFolders, setVocabFolders] = useState<{ id: string; name: string }[]>([]);
  const [vocabFolderId, setVocabFolderId] = useState("");
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [vocabSaving, setVocabSaving] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [selected, setSelected] = useState(1);
  const [reviewPart, setReviewPart] = useState(1);
  const audio = useRef<HTMLAudioElement>(null);
  const end = useRef<number | null>(null);
  const flight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      const current = controller.current;
      controller.current = null;
      current?.abort();
      audio.current?.pause();
    },
    [],
  );
  const draftKey = `la-listening-activity:${userId}:${id}:${activity}`;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const values = Object.entries(parsed).filter(
            ([key, value]) =>
              /^\d+$/.test(key) &&
              typeof value === "string" &&
              value.length <= 4000,
          );
          setAnswers((old) => ({ ...old, ...Object.fromEntries(values) }));
        }
      }
    } catch {
      /* Storage unavailable: server saves still work. */
    }
  }, [draftKey]);
  function answer(key: string, value: string) {
    setAnswers((old) => {
      const next = { ...old, [key]: value };
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(next));
      } catch {}
      return next;
    });
    setResult(null);
  }
  async function save(complete: boolean) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 12000);
    try {
      const res = await fetch(`/api/listening/full/${id}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({ activity, answers, complete }),
      });
      const body = await res.json().catch(() => ({}));
      if (controller.current !== abort) return;
      if (!res.ok) throw new Error("activity_save_failed");
      try {
        sessionStorage.removeItem(draftKey);
      } catch {}
      if (complete) setResult({ score: body.score, total: body.total });
    } catch (e) {
      void e;
      if (controller.current === abort) setError(dict.fullListeningHub.activity.saveFailed);
    } finally {
      clearTimeout(timer);
      if (controller.current === abort) {
        controller.current = null;
        flight.current = false;
        setBusy(false);
      }
    }
  }
  async function clip(start: number, stop: number) {
    if (!audio.current) return;
    setError("");
    end.current = stop;
    audio.current.currentTime = start;
    try {
      await audio.current.play();
    } catch {
      setError(dict.fullListeningHub.activity.momentUnavailable);
    }
  }
  async function chooseVocabularyFolder(index: number) {
    setVocabSelection(index); setVocabFolderId(""); setFoldersLoading(true); setError("");
    try {
      const res = await vocabularyRequest("/api/vocabulary/folders", { method: "GET", cache: "no-store" });
      if (!res) return;
      const payload = await res.json();
      if (!res.ok || !Array.isArray(payload.folders)) throw new Error();
      setVocabFolders(payload.folders.filter((folder: { id?: unknown; name?: unknown }) => typeof folder.id === "string" && typeof folder.name === "string"));
    } catch { setError(dict.fullListeningHub.activity.vocabSaveFailed); }
    finally { setFoldersLoading(false); }
  }
  async function vocabulary(index: number) {
    const x = data.vocabulary?.[index];
    if (!x || vocabSaving || foldersLoading) return;
    setVocabSaving(true);
    try {
      const res = await vocabularyRequest("/api/vocabulary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },

        // A linked item saves its canonical sense (server re-validates it against
        // this test's session list); an unlinked one falls back to the authored text.
        body: JSON.stringify(
          x.senseId
            ? { folderId: vocabFolderId || null, sourceType: "listening", sourceId: id, sessionSenseId: x.senseId, items: [{ term: x.term }] }
            : {
                folderId: vocabFolderId || null,
                sourceType: "listening",
                sourceId: id,
                items: [
                  {
                    term: x.term,
                    definitionEn: x.definitionEn,
                    translationUz: x.translationUz,
                    exampleSentence: x.example,
                    partOfSpeech: x.partOfSpeech,
                  },
                ],
              },
        ),
      });
      if (!res) return;
      if (!res.ok) throw new Error();
      setVocabSelection(null);
      setError("");
    } catch {
      setError(dict.fullListeningHub.activity.vocabSaveFailed);
    } finally { setVocabSaving(false); }
  }
  const q = data.questions?.find((x) => x.number === selected);
  const scriptPart=data.studyPack?.scriptParts?.find(part=>part.part===reviewPart);
  const scriptChunks: {text:string;gap?:{q:number;answer:string}}[]=[];
  if(scriptPart){let cursor=0;for(const gap of scriptPart.gaps){const at=scriptPart.transcript.indexOf(gap.match,cursor);if(at<0)continue;scriptChunks.push({text:scriptPart.transcript.slice(cursor,at),gap});cursor=at+gap.match.length;}scriptChunks.push({text:scriptPart.transcript.slice(cursor)});}
  return (
    <div className="listening-workspace mx-auto max-w-[1600px] space-y-6">
      <Link className="btn-secondary" href={`/listening/tests/${id}`}>
        ← Test hub
      </Link>
      <h1 className="font-display text-3xl">
        {title} · {data.studyPack ? activity === 3 ? dict.fullListeningHub.research.script : activity === 4 ? dict.fullListeningHub.research.recall : dict.fullListeningHub.activities[activity - 1] : dict.fullListeningHub.activities[activity - 1]}
      </h1>
      {activity === 2 && data.mapDiagram && <ListeningMap diagram={data.mapDiagram} />}
      {activity !== 5 && audioUrl && (
        <audio
          ref={audio}
          src={audioUrl}
          preload="none"
          controls
          className="w-full"
          onTimeUpdate={() => {
            if (
              end.current !== null &&
              audio.current &&
              audio.current.currentTime >= end.current
            ) {
              audio.current.pause();
              end.current = null;
            }
          }}
          onError={() => setError(dict.fullListeningHub.activity.recordingUnavailable)}
        />
      )}
      {activity === 2 && (
        <>
          {data.report && (
            <p className="card">
              Full Exam: {data.report.score} / {data.report.total}
            </p>
          )}
          {data.studyPack && <nav className="flex flex-wrap gap-2" aria-label={dict.fullListeningHub.research.review}>{data.sections?.map(part => <button type="button" key={part.number} className={reviewPart === part.number ? "btn-primary" : "btn-secondary"} onClick={() => { setReviewPart(part.number); setSelected(data.questions?.find(question => question.section === part.number)?.number ?? 1); }}>PART {part.number}</button>)}</nav>}
          {data.studyPack && <button type="button" className="btn-secondary" onClick={() => { const range = data.studyPack?.partRanges[String(reviewPart)]; if (range) void clip(range[0], range[1]); }}>▶ {dict.fullListeningHub.research.listenPart}</button>}
          <nav className="flex flex-wrap gap-2">
            {data.questions?.filter(question => !data.studyPack || question.section === reviewPart).map((x) => (
              <button
                type="button"
                key={x.number}
                className={
                  selected === x.number ? "btn-primary" : "btn-secondary"
                }
                onClick={() => {
                  setSelected(x.number);
                  answer(String(x.number), "reviewed");
                }}
              >
                Q{x.number}
                {answers[x.number] ? " ✓" : ""}
              </button>
            ))}
          </nav>
          {imageUrl && (!data.studyPack || reviewPart === 2) && <Image src={imageUrl} alt={dict.importPreview.image} width={1000} height={600} unoptimized className="h-auto max-h-96 w-auto max-w-full" />}
          <div className="listening-review-grid">
            <section className="card space-y-4">
              {q && (
                <>
                  <h2>
                    Q{q.number}. {studyText(q.text, `q${q.number}:text`)}
                  </h2>
                  <p>
                    Answer: {q.key}
                    {q.alternatives.length
                      ? ` · Also accepted: ${q.alternatives.join(" / ")}`
                      : ""}
                  </p>
                  <p>
                    Your answer:{" "}
                    {data.report?.answers.find((a) => a.number === q.number)
                      ?.userAnswer || "—"}
                  </p>
                  <div>{studyText(q.evidence.why, `q${q.number}:why`)}</div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() =>
                      void clip(
                        Math.max(0, q.evidence.at - 4),
                        q.evidence.at + 22,
                      )
                    }
                  >
                    {dict.fullListeningHub.activity.playEvidence}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => answer(String(q.number), "reviewed")}
                  >
                    {dict.fullListeningHub.activity.markReviewed}
                  </button>
                </>
              )}
            </section>
            <aside className="card space-y-5">
              <h2>{dict.fullListeningHub.activity.transcript}</h2>
              {data.sections?.map((s) => (
                <section key={s.number}>
                  <h3>
                    Section {s.number} · {s.title}
                  </h3>
                  {s.transcript ? (
                    <ClickableText
                      dict={dict}
                      sourceType="listening"
                      sourceId={id}
                      text={s.transcript}
                      occurrences={occurrences[s.number] ?? []}
                      lexicalAssistance={lexicalAssistance}
                      catalogueLookup
                    />
                  ) : (
                    <p role="status">
                      {dict.fullListeningHub.transcriptMissing}
                    </p>
                  )}
                </section>
              ))}
            </aside>
          </div>
        </>
      )}
      {activity === 2 && data.questions && (
        <ListeningSpeedPractice
          dict={dict}
          id={id}
          audioUrl={audioUrl}
          questions={data.questions}
          allowed={data.speeds ?? [1]}
        />
      )}
      {activity === 2 && data.mcq && (
        <McqMastery dict={dict} questions={data.mcq} />
      )}
      {activity === 4 && data.studyPack && <div className="space-y-4">{data.studyPack.recall.map(part => <article key={part.part} className="card space-y-3 p-5"><h2 className="font-display text-xl">PART {part.part} · {part.title}</h2><button type="button" className="btn-secondary" onClick={() => { const range = data.studyPack!.partRanges[String(part.part)]; if (range) void clip(range[0], range[1]); }}>▶ {dict.fullListeningHub.research.listenPart}</button><label className="block">{dict.fullListeningHub.research.recallPrompt}<textarea className="input mt-2 min-h-32" maxLength={4000} value={answers[part.part] ?? ""} onChange={event => answer(String(part.part), event.target.value)} /></label><button type="button" className="btn-secondary" onClick={() => setRevealed(old => ({ ...old, [part.part]: !old[part.part] }))} aria-expanded={Boolean(revealed[part.part])}>{dict.fullListeningHub.research.focusPoints}</button>{revealed[part.part] && <ul className="list-disc pl-5">{part.points.map(point => <li key={point}>{point}</li>)}</ul>}</article>)}</div>}
      {activity === 3 && scriptPart && <section className="space-y-4">
        <nav className="flex flex-wrap gap-2" aria-label={dict.fullListeningHub.research.script}>{data.studyPack!.scriptParts!.map(part=><button key={part.part} type="button" className={reviewPart===part.part?"btn-primary":"btn-secondary"} onClick={()=>setReviewPart(part.part)}>PART {part.part}</button>)}</nav>
        <button type="button" className="btn-secondary" onClick={()=>{const range=data.studyPack!.partRanges[String(reviewPart)];if(range)void clip(range[0],range[1]);}}>{dict.fullListeningHub.research.listenPart}</button>
        <div className="card p-5 leading-9 whitespace-pre-line">{scriptChunks.map((chunk,i)=><span key={i}>{studyText(chunk.text,`script:${reviewPart}:${i}`,true,occurrenceSpans(scriptPart.transcript,chunk.text,occurrences[reviewPart] ?? []))}{chunk.gap && <span className="inline-flex flex-wrap items-center gap-2 mx-1"><strong>{chunk.gap.q}</strong><input className="input inline-block !w-48" aria-label={`PART ${reviewPart} · ${chunk.gap.q}`} maxLength={200} value={answers[chunk.gap.q]??""} onChange={event=>answer(String(chunk.gap!.q),event.target.value)}/>{(result || revealed[chunk.gap.q]) && <span className="text-sm">{answers[chunk.gap.q]?.trim().toLowerCase()===chunk.gap.answer.toLowerCase()?dict.fullListeningHub.activity.correct:chunk.gap.answer}</span>}</span>}</span>)}</div>
        <button type="button" className="btn-primary" disabled={busy || scriptPart.gaps.some(gap=>!answers[gap.q]?.trim())} onClick={()=>{setRevealed(old=>({...old,...Object.fromEntries(scriptPart.gaps.map(gap=>[gap.q,true]))}));void save(false);}}>{dict.fullListeningHub.activity.checkAll}</button>
      </section>}
      {activity === 3 && !scriptPart && (
        <>
          <p>{dict.fullListeningHub.study.keywordIntro}</p>
          {data.keyword1?.map((x) => (
            <article className="card listening-review-grid" key={x.q}>
              <div>
                <h2>
                  Q{x.sourceQuestion ?? x.q} · PART {x.part ?? data.questionSections?.[x.sourceQuestion ?? x.q] ?? data.questions?.find(q => q.number === x.q)?.section ?? 1}
                </h2>
                <div>{studyText(x.text, `k1:${x.q}:text`)}</div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void clip(x.at, x.end)}
                >
                  ▶ Play moment
                </button>
              </div>
              <div>
                <p>{dict.fullListeningHub.activity.speakerSaid}</p>
                {!data.studyPack && <blockquote>{studyText(x.heard, `k${activity === 3 ? 1 : 2}:${x.q}:heard`)}</blockquote>}
                <label>
                  {dict.fullListeningHub.activity.yourMatches}
                  <textarea
                    className="input mt-2"
                    value={answers[x.q] ?? ""}
                    onChange={(e) => answer(String(x.q), e.target.value)}
                  />
                </label>
                {result && <div>Model: {studyText(x.link, `k1:${x.q}:link`)}</div>}
              </div>
            </article>
          ))}
        </>
      )}
      {activity === 4 && (
        <>
          <p>
            Hear → Meaning. Listen first, choose the meaning, then reveal the
            source relationship.
          </p>
          {data.keyword2?.map((x) => (
            <article className="card space-y-3" key={x.q}>
              <h2>
                Q{x.sourceQuestion ?? x.q} · PART {x.part ?? data.questionSections?.[x.sourceQuestion ?? x.q] ?? data.questions?.find(q => q.number === x.q)?.section ?? 1}
              </h2>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void clip(x.at, x.end)}
              >
                ▶ Hear moment
              </button>
              <label>
                Meaning
                {"options" in x ? <select
                  className="input"
                  value={answers[x.q] ?? ""}
                  disabled={!!revealed[x.q]}
                  onChange={(e) => answer(String(x.q), e.target.value)}
                >
                  <option value="">{dict.fullListeningHub.activity.chooseMeaning}</option>
                  {x.options.map((o, i) => (
                    <option key={o} value={i}>
                      {o}
                    </option>
                  ))}
                </select> : <input className="input" value={answers[x.q] ?? ""} disabled={!!revealed[x.q]} onChange={(e) => answer(String(x.q), e.target.value)} />}
              </label>
              <button
                type="button"
                className="btn-secondary"
                disabled={!answers[x.q]}
                onClick={() => setRevealed((old) => ({ ...old, [x.q]: true }))}
              >
                {dict.fullListeningHub.activity.commitReveal}
              </button>
              {revealed[x.q] && (
                <>
                  <blockquote>{studyText(x.heard, `k2:${x.q}:heard`)}</blockquote>
                  <div>{studyText(x.link, `k2:${x.q}:link`)}</div>
                </>
              )}
            </article>
          ))}
        </>
      )}
      {activity === 5 && (
        <>
          <nav className="flex gap-3">
            <button
              type="button"
              className={!quiz ? "btn-primary" : "btn-secondary"}
              onClick={() => setQuiz(false)}
            >
              Study
            </button>
            <button
              type="button"
              className={quiz ? "btn-primary" : "btn-secondary"}
              disabled={!data.vocabulary?.some(x => x.quiz)}
              onClick={() => setQuiz(true)}
            >
              Quiz
            </button>
          </nav>
          {data.vocabulary?.map((x, i) => (
            <article key={`${i}:${x.term}`} className="card space-y-3" data-session-sense={x.senseId ?? ""}>
              {!quiz || !x.quiz ? (
                <>
                  <h2 className="font-display text-xl">
                    {x.term} <span className="text-sm">{x.partOfSpeech}</span>
                    {x.ipa && <span className="ml-2 font-mono text-sm">/{x.ipa}/</span>}
                  </h2>
                  {x.translationUz && <p>{x.translationUz}</p>}
                  <p>{x.definitionEn}</p>
                  <p className="academic-text">{studyText(x.example, `v:${i}:example`)}</p>
                  <p>Also said as: {x.also.join(" · ")}</p>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      if (typeof speechSynthesis === "undefined") {
                        setError(dict.fullListeningHub.activity.pronunciationUnavailable);
                        return;
                      }
                      speechSynthesis.cancel();
                      const utterance = new SpeechSynthesisUtterance(x.term);
                      utterance.lang = "en-GB";
                      speechSynthesis.speak(utterance);
                    }}
                  >
                    {dict.fullListeningHub.activity.sayIt}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void chooseVocabularyFolder(i)}
                  >
                    + Vocabulary
                  </button>
                  {vocabSelection === i && <fieldset className="space-y-3 rounded-xl border border-signal-600/30 p-3" data-listening-vocabulary-folder>
                    <legend className="text-sm">{dict.vocabulary.games.set.folder}</legend>
                    <select className="input" value={vocabFolderId} disabled={foldersLoading || vocabSaving} onChange={e => setVocabFolderId(e.target.value)} aria-label={dict.vocabulary.games.set.folder}>
                      <option value="">{dict.nav.listening}</option>{vocabFolders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                    </select>
                    <div className="flex gap-2"><button type="button" className="btn-primary" disabled={foldersLoading || vocabSaving} onClick={() => void vocabulary(i)}>{vocabSaving ? dict.common.saving : dict.vocabulary.add.button}</button><button type="button" className="btn-secondary" disabled={vocabSaving} onClick={() => setVocabSelection(null)}>{dict.common.cancel}</button></div>
                  </fieldset>}
                </>
              ) : (
                <>
                  <h2>{x.quiz.q}</h2>
                  <label>
                    Answer
                    <select
                      className="input"
                      value={answers[i] ?? ""}
                      onChange={(e) => answer(String(i), e.target.value)}
                    >
                      <option value="">{dict.fullListeningHub.activity.choose}</option>
                      {x.quiz.options.map((o, n) => (
                        <option key={o} value={n}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </label>
                  {result && (
                    <p>
                      {Number(answers[i]) === x.quiz.correct
                        ? dict.fullListeningHub.activity.correct
                        : dict.fullListeningHub.activity.incorrect}{" "}
                      · {x.quiz.options[x.quiz.correct]}
                    </p>
                  )}
                </>
              )}
            </article>
          ))}
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void save(false)}
        >
          {dict.fullListeningHub.activity.saveProgress}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void save(true)}
        >
          {activity === 2 ? dict.fullListeningHub.activity.completeReviewed : dict.fullListeningHub.activity.checkAll}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => {
            setAnswers({});
            setResult(null);
            setRevealed({});
          }}
        >
          {dict.fullListeningHub.activity.tryAgain}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status" className="card">
          {result.score === null ? dict.fullListeningHub.completed : `${result.score} / ${result.total}`} · {dict.fullListeningHub.completed}
        </p>
      )}
    </div>
  );
}
