"use client";
import type { Dictionary } from "@/lib/i18n/en";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { gradePackage, normalized, type ListeningPackage } from "@/lib/listening/package";
import { ListeningMap } from "@/components/listening/ListeningMap";

/** In-memory author preview: no upload, attempt, progress or vocabulary writes. */
export function ListeningTryout({ dict, payload, audioFile, image }: { dict: Pick<Dictionary, "importPreview">; payload: ListeningPackage; audioFile: File; image: File | null }) {
  const t = dict.importPreview;
  const [activity, setActivity] = useState(1);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);
  const [url, setUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const player = useRef<HTMLAudioElement>(null);
  const clipEnd = useRef<number | null>(null);
  useEffect(() => { const url = URL.createObjectURL(audioFile); setUrl(url); return () => { URL.revokeObjectURL(url); }; }, [audioFile]);
  useEffect(() => { if (!image) { setImageUrl(""); return; } const url = URL.createObjectURL(image); setImageUrl(url); return () => URL.revokeObjectURL(url); }, [image]);
  function pick(n: number) { player.current?.pause(); clipEnd.current = null; setActivity(n); setAnswers({}); setChecked(false); }
  function clip(at: number, end: number) { if (player.current) { clipEnd.current = end; player.current.currentTime = at; void player.current.play().catch(() => {}); } }
  const grade = checked ? gradePackage(payload, answers) : [];
  const labels = [t.full, t.review, t.keyword1, t.keyword2, t.vocabulary];
  return <section className="space-y-4 rounded-2xl border border-ink-100 p-4" data-listening-tryout>
    <h2 className="text-xl font-semibold">{t.title}</h2>
    <p className="text-sm text-ink-500">{t.hint}</p>
    <nav aria-label={t.tabs} className="flex flex-wrap gap-2">{labels.map((label,i) => ((i < 2) || (i === 2 && payload.keyword1.length) || (i === 3 && payload.keyword2.length) || (i === 4 && payload.vocabulary.length)) ? <button type="button" key={label} className={activity === i + 1 ? "btn-primary" : "btn-secondary"} onClick={() => pick(i + 1)}>{label}</button> : null)}</nav>
    {url && activity !== 5 && <audio ref={player} src={url} controls className="max-w-full" onTimeUpdate={() => { if (clipEnd.current !== null && player.current && player.current.currentTime >= clipEnd.current) { player.current.pause(); clipEnd.current = null; } }} />}
    {activity < 3 && <>{payload.mapDiagram && <ListeningMap diagram={payload.mapDiagram} />}{imageUrl && <Image src={imageUrl} alt={t.image} width={1000} height={600} unoptimized className="h-auto max-h-96 w-auto max-w-full" />}{payload.questions.map(q => <div key={q.number} className="space-y-2 rounded-xl border border-ink-100 p-3"><p className="text-sm text-ink-500">{q.instruction}</p><label className="block">{q.number}. {q.text}{q.options.length ? <select className="input mt-2" value={answers[q.number] ?? ""} onChange={e => setAnswers(old => ({...old,[q.number]:e.target.value}))}><option value="">{t.choose}</option>{q.options.map((o,i) => <option key={i} value={/^([A-Z])[.)\s]/.exec(o)?.[1] ?? o}>{o}</option>)}</select> : <input className="input mt-2" value={answers[q.number] ?? ""} onChange={e => setAnswers(old => ({...old,[q.number]:e.target.value}))} />}</label>{checked && <p>{grade.find(g => g.number === q.number)?.correct ? "✓" : "✗"} {q.key}</p>}{activity === 2 && q.evidence.why && <p>{q.evidence.why}</p>}</div>)}{activity === 2 && payload.sections.filter(s => s.transcript.trim()).map(s => <div className="whitespace-pre-wrap" key={s.number}><h3 className="font-semibold">{s.title}</h3>{s.transcript}</div>)}</>}
    {activity === 3 && payload.keyword1.map(row => <div key={row.q} className="space-y-2"><p>{row.text}</p><button type="button" className="btn-secondary" onClick={() => clip(row.at,row.end)}>▶ {t.playMoment}</button><blockquote>{row.heard}</blockquote><input aria-label={`Keyword ${row.q}`} className="input" value={answers[row.q] ?? ""} onChange={e => setAnswers(old => ({...old,[row.q]:e.target.value}))} />{checked && <p>{normalized(answers[row.q] ?? "") === normalized(row.link.split(";")[0]!) ? "✓" : "✗"} {row.link}</p>}</div>)}
    {activity === 4 && payload.keyword2.map(row => <div key={row.q} className="space-y-2"><button type="button" className="btn-secondary" onClick={() => clip(row.at,row.end)}>▶ {t.hearMoment} {row.q}</button>{"options" in row ? <select aria-label={`Meaning ${row.q}`} className="input" value={answers[row.q] ?? ""} onChange={e => setAnswers(old => ({...old,[row.q]:e.target.value}))}><option value="">{t.choose}</option>{row.options.map((o,i) => <option key={i} value={i}>{o}</option>)}</select> : <input aria-label={`Meaning ${row.q}`} className="input" value={answers[row.q] ?? ""} onChange={e => setAnswers(old => ({...old,[row.q]:e.target.value}))} />}{checked && <p>{row.heard} · {row.link} · {"answer" in row ? row.answer : row.options[row.correct]}</p>}</div>)}
    {activity === 5 && <ul className="space-y-3">{payload.vocabulary.map((w,i) => <li key={i}><strong>{w.word}</strong> ({w.pos})<p>{w.def}</p><p>{w.uz}</p><p>{w.ex}</p>{w.quiz && <label>{w.quiz.q}<select className="input" value={answers[i] ?? ""} onChange={e => setAnswers(old => ({...old,[i]:e.target.value}))}><option value="">{t.choose}</option>{w.quiz.options.map((o,n) => <option key={n} value={n}>{o}</option>)}</select>{checked && <p>{w.quiz.options[w.quiz.correct]}</p>}</label>}</li>)}</ul>}
    <button type="button" className="btn-secondary" onClick={() => setChecked(true)}>{t.check}</button><button type="button" className="btn-secondary ml-2" onClick={() => { setAnswers({}); setChecked(false); }}>{t.reset}</button>
  </section>;
}
