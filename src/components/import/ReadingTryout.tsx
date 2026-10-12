"use client";
import type { Dictionary } from "@/lib/i18n/en";
import { useState } from "react";
import { generalReadingBundle } from "@/lib/reading/import-schema";

export function ReadingTryout({ dict, bundle }: { dict: Pick<Dictionary, "importPreview">; bundle: unknown }) {
  const t = dict.importPreview;
  const parsed = generalReadingBundle.safeParse(bundle);
  const [passage, setPassage] = useState(0);
  const [answers, setAnswers] = useState<Record<string,string>>({});
  const [checked, setChecked] = useState(false);
  if (!parsed.success) return <p role="alert">{t.invalid}</p>;
  const rows = parsed.data.passages;
  const current = rows[passage] ?? rows[0]!;
  const fold = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");
  return <section className="space-y-4 rounded-2xl border border-ink-100 p-4" data-reading-tryout>
    <h2 className="text-xl font-semibold">{t.title}</h2><p className="text-sm text-ink-500">{t.hint}</p>
    <nav className="flex flex-wrap gap-2" aria-label={t.passages}>{rows.map((p,i) => <button type="button" key={p.passageNo} className={i === passage ? "btn-primary" : "btn-secondary"} onClick={() => { setPassage(i); setChecked(false); }}>{p.title}</button>)}</nav>
    <div className="grid gap-5 xl:grid-cols-2"><article className="whitespace-pre-wrap"><h3 className="font-semibold">{current.title}</h3>{current.body}</article><div className="space-y-4">{current.questions.map(q => { const key = `${current.passageNo}:${q.questionNo}`; const correct = [q.answer,...q.accepted].map(fold).includes(fold(answers[key] ?? "")); const options = q.options?.length ? q.options : q.type === "true_false_not_given" ? ["TRUE","FALSE","NOT GIVEN"] : q.type === "yes_no_not_given" ? ["YES","NO","NOT GIVEN"] : []; return <div className="space-y-2" key={key}><label>{q.questionNo}. {q.text}{options.length ? <select className="input mt-2" value={answers[key] ?? ""} onChange={e => setAnswers(old => ({...old,[key]:e.target.value}))}><option value="">{t.choose}</option>{options.map((o,i) => <option key={i} value={/^([A-Z])[.)\s]/.exec(o)?.[1] ?? o}>{o}</option>)}</select> : <input className="input mt-2" value={answers[key] ?? ""} onChange={e => setAnswers(old => ({...old,[key]:e.target.value}))} />}</label>{checked && <p>{correct ? "✓" : "✗"} {q.answer} {q.explanation}</p>}</div>; })}</div></div>
    {!!current.vocabulary.length && <details><summary>{t.vocabulary}</summary><ul>{current.vocabulary.map((w,i) => <li key={i} className="mt-2"><strong>{w.word}</strong> ({w.pos}) · {w.def} · {w.uz}<p>{w.ex}</p></li>)}</ul></details>}
    <button type="button" className="btn-secondary" onClick={() => setChecked(true)}>{t.check}</button><button type="button" className="btn-secondary ml-2" onClick={() => {setAnswers({});setChecked(false);}}>{t.reset}</button>
  </section>;
}
