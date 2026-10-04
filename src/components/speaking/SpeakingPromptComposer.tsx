"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { speakingPrompts } from "@/db/schema";
import { sharedSpeakingChannels, usesSharedSpeakingBank, studySupportSchema, type SpeakingStudySupport } from "@/lib/speaking/study-support";
import { StudyRichEditor } from "@/components/ui/StudyRichEditor";
import { NewMaterialForm } from "./NewMaterialForm";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

type Prompt = typeof speakingPrompts.$inferSelect;
type QuestionDraft = { id?: string; promptText: string; cueCard: string; followUps?: string[]; studySupport: SpeakingStudySupport };
type TopicIdentity = { part: "part1" | "part2" | "part3"; topic: string | null; bank: "shared" | "ai"; ids: string[] };
const blank = () => studySupportSchema.parse({});
export function SpeakingPromptComposer({ dict, prompts }: { dict: Dictionary; prompts: Prompt[] }) {
  const t = dict.speakingStudy;
  const [browsePart, setBrowsePart] = useState("part1");
  const [topicSearch, setTopicSearch] = useState("");
  const [module, setModule] = useState("practice_alone");
  const [channels, setChannels] = useState<string[]>([]);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [active, setActive] = useState(0);
  const [original, setOriginal] = useState<TopicIdentity>();
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [id, setId] = useState<string | undefined>();
  const [part, setPart] = useState("part1");
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState("");
  const [cue, setCue] = useState("");
  const [support, setSupport] = useState<SpeakingStudySupport>(blank);
  const [open, setOpen] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const request = useScopedResponse(25000);
  const router = useRouter();
  const groups = [...prompts.filter(p => p.part !== "general").reduce((map, p) => {
    const bank = usesSharedSpeakingBank(p.availableIn) ? "shared" : "ai";
    const key = JSON.stringify([p.part, p.topic, bank]);
    map.set(key, [...(map.get(key) ?? []), p]); return map;
  }, new Map<string, Prompt[]>()).values()];
  const searchTerms = topicSearch.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const visibleGroups = groups.filter(rows => rows[0]!.part === browsePart && rows.some(row => {
    const text = `${row.topic ?? ""} ${row.promptText} ${row.cueCard ?? ""}`.normalize("NFKC").toLocaleLowerCase();
    return searchTerms.every(term => text.includes(term));
  }));
  function current(): QuestionDraft { return {id, promptText: question, cueCard: cue, followUps:questions[active]?.followUps ?? [], studySupport: support}; }
  function allQuestions() { const rows = questions.length ? [...questions] : [current()]; rows[active] = current(); return rows; }
  function show(q: QuestionDraft) { setId(q.id); setQuestion(q.promptText); setCue(q.cueCard); setSupport(q.studySupport); setOpen([]); setStatus(""); }
  function reset() { setOriginal(undefined); setQuestions([]); setActive(0); setTopic(""); setChannels([]); setArchiveConfirm(false); show({promptText:"",cueCard:"",studySupport:blank()}); }
  function load(rows: Prompt[]) {
    const p = rows[0]!;
    if (p.part === "general") return;
    const bank = usesSharedSpeakingBank(p.availableIn) ? "shared" : "ai";
    setOriginal({part:p.part, topic:p.topic, bank, ids:rows.map(q => q.id)});
    const visible = rows.some(q => q.publicationState !== "archived") ? rows.filter(q => q.publicationState !== "archived") : rows;
    const drafts = visible.map(q => ({id:q.id,promptText:q.promptText,cueCard:q.cueCard ?? "",followUps:q.followUps,studySupport:studySupportSchema.parse(q.studySupport)}));
    setQuestions(drafts); setActive(0); setPart(p.part); setChannels(p.availableIn); setModule(bank === "shared" ? "practice_alone" : "ai"); setTopic(p.topic ?? ""); setArchiveConfirm(false); show(drafts[0]!);
  }
  async function save(archive = false) {
    if (pending) return; setPending(true); setStatus("");
    try {
      const body = archive ? original : {original, questions:allQuestions().map(q => ({...q, promptText:part === "part2" && !q.promptText.trim() ? topic : q.promptText, part,topic,availableIn:sharedSpeakingChannels([...channels,module])}))};
      const res = await request("/api/speaking/topics", {method:archive ? "DELETE" : "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      if (!res) return;
      const data = await res.json(); if (!res.ok) {setStatus(res.status === 409 ? t.topicConflict : t.invalid); return;}
      if (archive) {reset();setStatus(t.topicArchived);} else {
        const saved: Prompt[] = data.prompts;
        if (!saved[0] || saved[0].part === "general") throw new Error("Invalid response");
        const drafts = saved.map(q => ({id:q.id,promptText:q.promptText,cueCard:q.cueCard ?? "",followUps:q.followUps,studySupport:studySupportSchema.parse(q.studySupport)}));
        setQuestions(drafts); show(drafts[active]!);
        setOriginal({part:saved[0]!.part,topic:saved[0]!.topic,bank:usesSharedSpeakingBank(saved[0]!.availableIn) ? "shared" : "ai",ids:[...new Set([...(original?.ids ?? []),...saved.map(q => q.id)])]});
        setStatus(t.published);
      }
      router.refresh();
    } catch {setStatus(t.saveFailed);} finally {setPending(false);}
  }
  return <section className="card space-y-4 p-5" data-speaking-composer>
    <label className="block">{t.module}<select className="input" disabled={pending} value={module} onChange={e => { const next = e.target.value; if (!["practice_alone", "live_partner"].includes(module) || !["practice_alone", "live_partner"].includes(next)) { reset(); } setModule(next); }}><option value="practice_alone">{t.practice}</option><option value="live_partner">{t.partner}</option><option value="ai">{t.ai}</option><option value="lessons">{t.lessons}</option></select></label>
    {module === "lessons" ? <NewMaterialForm dict={dict} /> : <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(false); }}>
      <label className="block">{t.part}<select className="input" value={part} disabled={pending || Boolean(original)} onChange={e => { reset(); setPart(e.target.value); }}>{[1,2,3].map(n => <option key={n} value={`part${n}`}>{t.part} {n}</option>)}</select></label>
      <label className="block">{t.topic}<input className="input" required maxLength={200} disabled={pending} value={topic} onChange={e => setTopic(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2" aria-label={t.questions}>{Array.from({length:Math.max(1,questions.length)},(_,i) => <button type="button" className="btn-secondary" key={i} disabled={pending} aria-pressed={i === active} onClick={() => {const rows=allQuestions();setQuestions(rows);setActive(i);show(rows[i]!);}}>{t.question} {i+1}</button>)}</div>
      <label className="block">{part === "part2" ? t.cueQuestion : t.question}<textarea className="input" required={part !== "part2"} maxLength={200} disabled={pending} value={question} onChange={e => setQuestion(e.target.value)} /></label>
      {part === "part2" && <label className="block">{t.cueInstructions}<textarea className="input min-h-28" disabled={pending} value={cue} onChange={e => setCue(e.target.value)} /></label>}
      {module === "practice_alone" && <div className="flex flex-wrap gap-2">{[["vocabularyHtml", t.addVocabulary], ["modelAnswerHtml", t.addSample], ["ideasHtml", t.addIdeas]].map(([key,label]) => <button key={key} type="button" className="btn-secondary" aria-expanded={open.includes(key!)} onClick={() => setOpen(old => old.includes(key!) ? old.filter(k => k !== key) : [...old, key!])}>{label}</button>)}</div>}
      {([["vocabularyHtml", t.vocabulary], ["modelAnswerHtml", t.sampleAnswer], ["ideasHtml", t.ideas]] as const).map(([key,label]) => module === "practice_alone" && open.includes(key) && <fieldset key={key} className="space-y-3"><legend className="font-semibold">{label}</legend><StudyRichEditor dict={dict} label={label} value={support[key]} onChange={html => setSupport(old => ({ ...old, [key]: html }))} />{key === "vocabularyHtml" && <><p className="text-sm text-ink-500">{t.wordHelp}</p>{support.vocabulary.map((word, index) => <div key={index} className="grid gap-2 rounded-xl border border-ink-100 p-3 sm:grid-cols-2">{([ ["term", t.word], ["definitionEn", t.meaningEn], ["translationUz", t.meaningUz], ["partOfSpeech", t.pos], ["exampleSentence", t.example]] as const).map(([field, label]) => <label key={field}>{label}<input className="input" required={field === "term" || field === "definitionEn"} value={word[field]} onChange={e => setSupport(old => ({ ...old, vocabulary: old.vocabulary.map((w,i) => i === index ? {...w, [field]: e.target.value} : w) }))} /></label>)}<button type="button" className="btn-secondary" onClick={() => setSupport(old => ({...old,vocabulary:old.vocabulary.filter((_,i) => i !== index)}))}>{t.remove}</button></div>)}<button type="button" className="btn-secondary" disabled={support.vocabulary.length >= 100} onClick={() => setSupport(old => ({ ...old, vocabulary: [...old.vocabulary, { term: "", definitionEn: "", translationUz: "", partOfSpeech: "", exampleSentence: "" }] }))}>{t.newWord}</button></>}</fieldset>)}
      {part !== "part2" && <button type="button" className="btn-secondary" disabled={pending || questions.length >= 100} onClick={() => {const rows=allQuestions();const next={promptText:"",cueCard:"",studySupport:blank()};setQuestions([...rows,next]);setActive(rows.length);show(next);}}>{t.nextQuestion}</button>}
      {questions.length > 1 && <button type="button" className="btn-secondary ml-2" disabled={pending} onClick={() => {const rows=allQuestions().filter((_,i) => i !== active);setQuestions(rows);setActive(0);show(rows[0]!);}}>{t.removeQuestion}</button>}
      <p className="text-sm text-ink-500">{t.topicUploadHelp}</p>
      <button type="submit" className="btn-primary" disabled={pending}>{pending ? dict.common.saving : original ? t.publishChanges : t.publish}</button>
      <button type="button" className="btn-secondary ml-2" disabled={pending} onClick={reset}>{t.newTopic}</button>
      {original && <button type="button" className="btn-secondary ml-2" disabled={pending} onClick={() => setArchiveConfirm(true)}>{t.removeTopic}</button>}
      {archiveConfirm && <div role="alert" className="space-y-2"><p>{t.archiveHelp}</p><button type="button" className="btn-secondary" disabled={pending} onClick={() => void save(true)}>{t.confirmArchive}</button><button type="button" className="btn-secondary ml-2" onClick={() => setArchiveConfirm(false)}>{t.cancel}</button></div>}
      {status && <p role="status">{status}</p>}
    </form>}
    <details><summary>{t.editExisting} ({groups.length})</summary><div className="space-y-3 pt-3"><div className="flex flex-wrap gap-2" aria-label={t.part}>{[1,2,3].map(n => <button key={n} type="button" className={browsePart === `part${n}` ? "btn-primary" : "btn-secondary"} aria-pressed={browsePart === `part${n}`} onClick={() => setBrowsePart(`part${n}`)}>PART {n}</button>)}</div><label className="block">{t.topic} / {t.question}<input type="search" className="input" value={topicSearch} onChange={e => setTopicSearch(e.target.value)} /></label><ul className="grid max-h-96 gap-2 overflow-auto sm:grid-cols-2">{visibleGroups.map(rows => <li key={rows[0]!.id}><button type="button" disabled={pending} className="btn-secondary w-full text-left" onClick={() => load(rows)}>{rows[0]!.part} · {rows[0]!.topic} · {rows.filter(q => q.publicationState !== "archived").length} {t.questions}{rows.every(q => q.publicationState === "archived") ? ` · ${t.archived}` : ""}</button></li>)}</ul><p role="status" className="text-sm text-ink-500">{visibleGroups.length} {t.topic}</p></div></details>
  </section>;
}
