"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { speakingPrompts } from "@/db/schema";
import { sharedSpeakingChannels, studySupportSchema, type SpeakingStudySupport } from "@/lib/speaking/study-support";
import { StudyRichEditor } from "@/components/ui/StudyRichEditor";
import { NewMaterialForm } from "./NewMaterialForm";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

type Prompt = typeof speakingPrompts.$inferSelect;
const blank = () => studySupportSchema.parse({});
export function SpeakingPromptComposer({ dict, prompts }: { dict: Dictionary; prompts: Prompt[] }) {
  const t = dict.speakingStudy;
  const [module, setModule] = useState("practice_alone");
  const [channels, setChannels] = useState<string[]>([]);
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
  function load(p: Prompt) {
    const destination = p.availableIn.includes("practice_alone") ? "practice_alone" : p.availableIn[0] ?? "practice_alone";
    setId(p.id); setPart(p.part); setChannels(p.availableIn); setModule(destination); setTopic(p.topic ?? ""); setQuestion(p.promptText); setCue(p.cueCard ?? ""); setSupport(studySupportSchema.parse(p.studySupport)); setOpen(["vocabularyHtml", "modelAnswerHtml", "ideasHtml"]);
    setStatus("");
  }
  async function save() {
    if (pending) return; setPending(true); setStatus("");
    try { const res = await request("/api/speaking/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, part, topic, promptText: question, cueCard: cue, availableIn: sharedSpeakingChannels([...channels, module]), studySupport: support }) });
      if (!res) return;
      const data = await res.json(); if (!res.ok) { setStatus(t.invalid); return; }
      setId(data.prompt.id); setStatus(t.published); router.refresh();
    } catch { setStatus(t.saveFailed); } finally { setPending(false); }
  }
  return <section className="card space-y-4 p-5" data-speaking-composer>
    <label className="block">{t.module}<select className="input" disabled={pending} value={module} onChange={e => { const next = e.target.value; if (!["practice_alone", "live_partner"].includes(module) || !["practice_alone", "live_partner"].includes(next)) { setId(undefined); setChannels([]); } setModule(next); }}><option value="practice_alone">{t.practice}</option><option value="live_partner">{t.partner}</option><option value="ai">{t.ai}</option><option value="lessons">{t.lessons}</option></select></label>
    {module === "lessons" ? <NewMaterialForm dict={dict} /> : <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className="block">{t.part}<select className="input" value={part} disabled={pending} onChange={e => setPart(e.target.value)}>{[1,2,3].map(n => <option key={n} value={`part${n}`}>{t.part} {n}</option>)}</select></label>
      <label className="block">{t.topic}<input className="input" required maxLength={200} disabled={pending} value={topic} onChange={e => setTopic(e.target.value)} /></label>
      <label className="block">{part === "part2" ? t.cueQuestion : t.question}<textarea className="input" required maxLength={200} disabled={pending} value={question} onChange={e => setQuestion(e.target.value)} /></label>
      {part === "part2" && <label className="block">{t.cueInstructions}<textarea className="input min-h-28" disabled={pending} value={cue} onChange={e => setCue(e.target.value)} /></label>}
      {module === "practice_alone" && <div className="flex flex-wrap gap-2">{[["vocabularyHtml", t.addVocabulary], ["modelAnswerHtml", t.addSample], ["ideasHtml", t.addIdeas]].map(([key,label]) => <button key={key} type="button" className="btn-secondary" aria-expanded={open.includes(key!)} onClick={() => setOpen(old => old.includes(key!) ? old.filter(k => k !== key) : [...old, key!])}>{label}</button>)}</div>}
      {([["vocabularyHtml", t.vocabulary], ["modelAnswerHtml", t.sampleAnswer], ["ideasHtml", t.ideas]] as const).map(([key,label]) => module === "practice_alone" && open.includes(key) && <fieldset key={key} className="space-y-3"><legend className="font-semibold">{label}</legend><StudyRichEditor dict={dict} label={label} value={support[key]} onChange={html => setSupport(old => ({ ...old, [key]: html }))} />{key === "vocabularyHtml" && <><p className="text-sm text-ink-500">{t.wordHelp}</p>{support.vocabulary.map((word, index) => <div key={index} className="grid gap-2 rounded-xl border border-ink-100 p-3 sm:grid-cols-2">{([ ["term", t.word], ["definitionEn", t.meaningEn], ["translationUz", t.meaningUz], ["partOfSpeech", t.pos], ["exampleSentence", t.example]] as const).map(([field, label]) => <label key={field}>{label}<input className="input" required={field === "term" || field === "definitionEn"} value={word[field]} onChange={e => setSupport(old => ({ ...old, vocabulary: old.vocabulary.map((w,i) => i === index ? {...w, [field]: e.target.value} : w) }))} /></label>)}<button type="button" className="btn-secondary" onClick={() => setSupport(old => ({...old,vocabulary:old.vocabulary.filter((_,i) => i !== index)}))}>{t.remove}</button></div>)}<button type="button" className="btn-secondary" disabled={support.vocabulary.length >= 100} onClick={() => setSupport(old => ({ ...old, vocabulary: [...old.vocabulary, { term: "", definitionEn: "", translationUz: "", partOfSpeech: "", exampleSentence: "" }] }))}>{t.newWord}</button></>}</fieldset>)}
      <button type="submit" className="btn-primary" disabled={pending}>{pending ? dict.common.saving : id ? t.publishChanges : t.publish}</button>{id && <button type="button" className="btn-secondary ml-2" disabled={pending} onClick={() => {setId(undefined); setChannels([]); setQuestion(""); setCue(""); setSupport(blank()); setOpen([]);}}>{t.nextQuestion}</button>}
      {status && <p role="status">{status}</p>}
    </form>}
    <details><summary>{t.editExisting} ({prompts.length})</summary><ul className="max-h-80 space-y-2 overflow-auto pt-3">{prompts.map(p => <li key={p.id}><button type="button" disabled={pending} className="btn-secondary w-full text-left" onClick={() => load(p)}>{p.part} · {p.topic} · {p.promptText}</button></li>)}</ul></details>
  </section>;
}
