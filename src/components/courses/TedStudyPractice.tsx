"use client";
import { LocalReflectionRecorder } from "@/components/audio/LocalReflectionRecorder";
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import lessons from "@/lib/video/ted-study-pack.json";
const normalise = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function findTedStudyPack(title: string) { return lessons.find(lesson => normalise(lesson.title) === normalise(title)); }
type Task = { kind?: "summary"; name: string; prompt: string; key?: string };
export function TedStudyPractice({ title, initial, dict, save }: { title: string; initial: string; dict: Dictionary; save: (text: string) => Promise<boolean> }) {
  const pack = findTedStudyPack(title);
  const [active, setActive] = useState("B");
  const [answers, setAnswers] = useState<Record<string, string>>(() => { try { const raw = JSON.parse(initial); return raw.kind === "ted-study-pack-v1" && raw.answers && typeof raw.answers === "object" ? Object.fromEntries(Object.entries(raw.answers).filter(([key,value]) => /^[A-I]$/.test(key) && typeof value === "string" && value.length <= 1000)) as Record<string,string> : {}; } catch { return {}; } });
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  if (!pack) return null;
  const task = (pack.tasks as Record<string, Task>)[active]!;
  const labels = dict.videoLesson.studyPack;
  const rows = task.prompt.split("\n");
  const numbered = rows.filter(row => /^\d+\./.test(row));
  const definitions = rows.filter(row => /^[A-Z]\./.test(row));
  let fields: Record<string,string> = {};
  try { const value=JSON.parse(answers[active] ?? "{}"); if(value && typeof value === "object" && !Array.isArray(value)) fields=Object.fromEntries(Object.entries(value).filter((entry): entry is [string,string]=>typeof entry[1] === "string")); } catch { /* An older free-text response remains below. */ }
  const field=(key:string,value:string)=>setAnswers(old=>({...old,[active]:JSON.stringify({...fields,[key]:value})}));
  return <section className="card space-y-4 p-5" data-ted-study-pack>
    <h2 className="font-display text-xl">{labels.title}</h2><p className="text-sm text-ink-500">{labels.source}</p>
    {pack.sourceUrl && <a className="btn-secondary inline-flex" href={pack.sourceUrl} target="_blank" rel="noreferrer">{labels.official}</a>}
    <nav className="flex flex-wrap gap-2" aria-label={labels.title}>{["A","B","C","D","E","F","G","H","I"].map(key => <button key={key} type="button" className={active === key ? "btn-primary" : "btn-secondary"} aria-pressed={active === key} onClick={() => { setActive(key); setRevealed(false); setStatus(""); }}>{(pack.tasks as Record<string, Task>)[key]!.name}</button>)}</nav>
    <details className="rounded-xl border border-ink-100 p-4"><summary>{labels.glossary}</summary><p className="mt-3 whitespace-pre-line leading-6">{pack.glossary}</p></details>
    {(active === "D" || active === "E") && numbered.length ? <div className="space-y-3">
      {active === "E" && <p>{rows[0]}</p>}
      {numbered.map((row,i)=><label className="block rounded-xl border border-ink-100 p-4" key={row}><span>{row}</span>{active === "D" ? <select className="input mt-2" value={fields[i] ?? ""} onChange={event=>field(String(i),event.target.value)}><option value="">{dict.fullListeningHub.activity.choose}</option>{definitions.map(definition=><option key={definition} value={definition[0]}>{definition}</option>)}</select> : <input className="input mt-2" value={fields[i] ?? ""} maxLength={100} onChange={event=>field(String(i),event.target.value)}/>}</label>)}
    </div> : <><p className="whitespace-pre-line leading-7">{task.prompt}</p><label className="block">{labels.response}<textarea className="input mt-2 min-h-40" value={answers[active] ?? ""} maxLength={1000} onChange={event => setAnswers(old => ({...old,[active]:event.target.value}))} /></label></>}
    <LocalReflectionRecorder key={title} dict={dict} active={task.kind === "summary"} />
    <div className="flex flex-wrap gap-2"><button className="btn-primary" type="button" disabled={busy} onClick={async () => { const text = JSON.stringify({kind:"ted-study-pack-v1",answers}); if (text.length > 4000) { setStatus(labels.tooLong); return; } setBusy(true); setStatus(""); try { setStatus(await save(text) ? dict.videoLesson.saved : dict.common.error); } finally { setBusy(false); } }}>{busy ? dict.videoLesson.saving : dict.videoLesson.save}</button>{task.key && <button className="btn-secondary" type="button" aria-expanded={revealed} onClick={() => setRevealed(value => !value)}>{labels.key}</button>}</div>
    {revealed && task.key && <div className="rounded-xl border border-ink-100 p-4"><p className="text-sm text-ink-500">{labels.model}</p><p className="whitespace-pre-line">{task.key}</p></div>}
    {status && <p role="status">{status}</p>}
  </section>;
}
