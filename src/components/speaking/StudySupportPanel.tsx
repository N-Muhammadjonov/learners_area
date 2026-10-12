"use client";
import type { Dictionary } from "@/lib/i18n/en";
import { privateResources } from "@/lib/client/private-resource";
import { useEffect, useRef, useState } from "react";
import type { SpeakingStudySupport } from "@/lib/speaking/study-support";
import { cleanStudyHtml } from "@/lib/speaking/rich-text";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

export function StudySupportPanel({ dict, promptId, support }: { dict: Dictionary; promptId: string; support: SpeakingStudySupport }) {
  const t = dict.speakingStudy;
  const [tab, setTab] = useState<"vocabulary" | "modelAnswer" | "ideas">("vocabulary");
  const [revealed, setRevealed] = useState(false);
  const [holding, setHolding] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useScopedResponse(20000);
  function cancel() { if (timer.current) clearTimeout(timer.current); timer.current = null; setHolding(false); }
  function hold() { if (timer.current || revealed) return; setHolding(true); timer.current = setTimeout(() => { timer.current = null; setHolding(false); setRevealed(true); }, 3000); }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function save(indices: number[]) {
    if (saving) return; setSaving(true); setMessage("");
    try { const res = await request("/api/speaking/prompts/vocabulary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptId, indices }) });
      if (!res) return;
      const data = await res.json(); if (res.ok) privateResources.invalidate("vocabulary:"); setMessage(res.ok ? t.savedWords.replace("{added}", String(data.added)).replace("{duplicates}", String(data.duplicates)).replace("{folder}", data.folder?.name ?? "") : t.saveFailed);
    } catch { setMessage(t.saveFailed); } finally { setSaving(false); }
  }
  const html = tab === "vocabulary" ? support.vocabularyHtml : tab === "modelAnswer" ? support.modelAnswerHtml : support.ideasHtml;
  return <section className="card relative min-h-96 space-y-5 p-5" data-study-support>
    <div role="tablist" aria-label={t.supportLabel} className="flex flex-wrap gap-2">
      {[["vocabulary", t.vocabulary], ["modelAnswer", t.modelAnswer], ["ideas", t.ideas]].map(([id, label]) => <button type="button" role="tab" aria-selected={tab === id} key={id} className={tab === id ? "btn-primary" : "btn-secondary"} onClick={() => setTab(id as typeof tab)}>{label}</button>)}
    </div>
    {!revealed ? <div className="flex min-h-72 items-center justify-center"><button type="button" className="rounded-3xl border-2 border-accent-500 bg-paper p-8 text-center text-xl font-semibold select-none" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); hold(); }} onPointerUp={cancel} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel} onContextMenu={e => e.preventDefault()} onKeyDown={e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); hold(); } }} onKeyUp={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); cancel(); } }}><span className="block text-sm uppercase tracking-widest">{t.answerFirst}</span><span className="mt-3 block">{holding ? t.holding : t.hold}</span></button></div> : <div role="tabpanel" className="space-y-4">
      {html && <div className="study-rich-text break-words" dangerouslySetInnerHTML={{ __html: cleanStudyHtml(html) }} />}
      {tab === "vocabulary" && support.vocabulary.length > 0 && <><button type="button" className="btn-primary" disabled={saving} onClick={() => void save(support.vocabulary.map((_, i) => i))}>{t.saveAll}</button><ul className="space-y-3">{support.vocabulary.map((word, i) => <li key={i} className="rounded-xl border border-ink-100 p-3"><strong>{word.term}</strong> {word.partOfSpeech && <em>({word.partOfSpeech})</em>}<p>{word.definitionEn}</p>{word.translationUz && <p>{word.translationUz}</p>}{word.exampleSentence && <p className="text-ink-500">{word.exampleSentence}</p>}<button type="button" className="btn-secondary mt-2" disabled={saving} onClick={() => void save([i])}>{t.addWord}</button></li>)}</ul></>}
      {!html && (tab !== "vocabulary" || !support.vocabulary.length) && <p className="text-ink-500">{t.empty}</p>}
    </div>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
