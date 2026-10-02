"use client";

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";

type Practice = { verdict: "correct" | "acceptable" | "needs_revision"; copy: { nearCopy: boolean }; canSave: boolean; saved: boolean; result: { bands: Record<string, number | null>; feedback: string | null; improved: string | null; fixes: string[] } | null };

/** Adapt one pattern to a NEW server-chosen topic. Copy guard + external AI run on the server. */
export function PatternPractice({ dict, patternId, aiReady }: { dict: Dictionary; patternId: string; aiReady: boolean }) {
  const t = dict.writingWorkspace.stealing;
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<Practice | null>(null);
  const [saved, setSaved] = useState(false);

  async function openPractice() {
    setOpen(true); setError(null);
    if (topic) return;
    const res = await fetch(`/api/writing/stealing/practice?patternId=${patternId}`, { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { newTopic: string }) : null;
    if (data) setTopic(data.newTopic); else setError(t.error);
  }
  async function check() {
    if (!topic || !answer.trim() || busy) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/writing/stealing/practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patternId, newTopic: topic, answer }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) { setError(t.error); return; }
    const data = (await res.json()) as Practice;
    setR(data); setSaved(data.saved);
  }
  async function save() {
    const res = await fetch(`/api/writing/patterns/${patternId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ saved: true }) }).catch(() => null);
    if (res?.ok) setSaved(true); else setError(t.saveError);
  }

  if (!open) return <button type="button" className="btn-secondary min-h-11" onClick={() => void openPractice()} data-stealing-practise={patternId}>{t.practise}</button>;
  if (!aiReady) return <p role="status" className="rounded-md bg-paper-sunken p-3 text-sm text-ink-700" data-stealing-unavailable>{t.aiUnavailable}</p>;
  const color = r?.verdict === "needs_revision" ? "text-band-bad" : r?.verdict === "acceptable" ? "text-band-warn" : "text-band-good";
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ink-100 p-3" data-stealing-practice>
      <p className="text-sm text-ink-600">{t.newTopic}: <b className="text-ink-900" data-stealing-topic>{topic ?? "…"}</b></p>
      <p className="text-sm text-ink-500">{t.adaptHint}</p>
      <label className="flex flex-col gap-1 text-base">{t.yourSentence}
        <textarea className="input" rows={3} maxLength={800} value={answer} onChange={(e) => { setAnswer(e.target.value); setR(null); }} />
      </label>
      {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
      {r && (
        <div role="status" className="flex flex-col gap-1" data-stealing-result={r.verdict}>
          <p className={`font-semibold ${color}`}>{t.verdict[r.verdict]}</p>
          {r.copy.nearCopy && <p className="text-base text-ink-700" data-stealing-near-copy>{t.nearCopy}</p>}
          {r.result && (
            <>
              <ul className="flex flex-wrap gap-3 text-sm">{(["grammar", "meaning", "pattern", "adaptation"] as const).map((k) => <li key={k}>{t.criteria[k]}: <b>{r.result!.bands[k] ?? "—"}</b></li>)}</ul>
              {r.result.feedback && <p className="text-base text-ink-700">{r.result.feedback}</p>}
              {r.result.improved && <p className="text-base text-ink-800"><b>{t.better}:</b> {r.result.improved}</p>}
              {r.result.fixes.length > 0 && <ul className="list-disc pl-5 text-sm text-ink-700">{r.result.fixes.slice(0, 3).map((f) => <li key={f}>{f}</li>)}</ul>}
            </>
          )}
          {r.canSave && (saved ? <span className="badge self-start bg-signal-100 text-signal-700">{t.saved}</span> : <button type="button" className="btn-secondary min-h-11 self-start" onClick={() => void save()}>{t.save}</button>)}
        </div>
      )}
      <button type="button" className="btn-primary min-h-11 self-start" disabled={busy || !answer.trim() || !topic} onClick={() => void check()}>{busy ? t.checking : t.check}</button>
    </div>
  );
}
