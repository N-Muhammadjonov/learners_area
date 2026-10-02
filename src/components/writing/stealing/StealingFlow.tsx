"use client";

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { StealingView } from "@/lib/services/writing/stealing";
import { MIN_BRAINSTORM_WORDS, MIN_COMPARE_WORDS, MIN_DRAFT_WORDS, STEALING_STEPS, wordCount } from "@/lib/writing/stealing-rules";

/** The 7-step Language Stealing workflow. Every step is validated and stored by the server; the next unlocks only then. */
export function StealingFlow({ dict, initial, locale }: { dict: Dictionary; initial: StealingView; locale: "uz" | "en" }) {
  const t = dict.writingWorkspace.stealing;
  const fns = dict.writingWorkspace.topicVocab.fns;
  const [v, setV] = useState(initial);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>(initial.selectedPatternIds);
  const [recall, setRecall] = useState<Record<string, string>>({});
  const [recallState, setRecallState] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/writing/stealing/sessions/${v.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    const data = res ? ((await res.json().catch(() => null)) as { view?: StealingView; recalled?: boolean; error?: { code: string } } | null) : null;
    if (!res?.ok || !data?.view) { setError(data?.error?.code === "too_short" ? t.tooShort : t.error); return null; }
    if (data.view.step !== v.step) setText("");
    setV(data.view);
    return data;
  }

  const min = v.step === 2 ? MIN_BRAINSTORM_WORDS : v.step === 5 ? MIN_COMPARE_WORDS : MIN_DRAFT_WORDS;
  const enough = wordCount(text) >= min;
  const textStep = (action: string, hint: string, rows = 8) => (
    <div className="flex flex-col gap-2">
      <p className="text-base text-ink-700">{hint.replace("{n}", String(min))}</p>
      <textarea className="input" rows={rows} value={text} onChange={(e) => setText(e.target.value)} maxLength={6000} data-stealing-text={action} />
      <p className="text-sm text-ink-500">{wordCount(text)} / {min}</p>
      <button type="button" className="btn-primary min-h-11 self-start" disabled={busy || !enough} onClick={() => void send({ action, text })}>{busy ? t.saving : t.continue}</button>
    </div>
  );
  const model = v.modelBody && <article className="whitespace-pre-line rounded-xl border border-ink-100 bg-paper-raised p-4 text-base leading-relaxed text-ink-800" data-stealing-model><h3 className="mb-2 font-display text-lg text-ink-900">{t.modelTitle}</h3>{v.modelBody}</article>;
  const current = v.completedAt ? 8 : v.step;

  return (
    <div className="flex flex-col gap-5" data-stealing-flow data-stealing-step={v.step}>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label={t.stepsTitle}>
        {STEALING_STEPS.map((s, i) => {
          const n = i + 1;
          const state = n < current ? "done" : n === current ? "current" : "locked";
          return <li key={s} aria-current={state === "current" ? "step" : undefined} data-step-state={state} className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-sm ${state === "current" ? "border-signal-500 bg-signal-50 font-semibold text-ink-900 dark:bg-signal-950/40" : state === "done" ? "border-band-good/40 text-ink-700" : "border-ink-100 text-ink-400"}`}><span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink-50 text-xs">{state === "done" ? "✓" : n}</span>{t.steps[s]}</li>;
        })}
      </ol>

      {error && <p role="alert" className="text-base text-band-bad">{error}</p>}

      {v.completedAt ? (
        <div className="flex flex-col gap-4" data-stealing-completed>
          <h2 className="font-display text-xl text-ink-900">{t.completedTitle}</h2>
          <p className="text-base text-ink-700">{t.usedPatterns.replace("{used}", String(v.rewritePatternIds.length)).replace("{total}", String(v.selectedPatternIds.length))}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-ink-100 p-4"><h3 className="font-display text-lg text-ink-900">{t.yourDraft}</h3><p className="whitespace-pre-line text-base text-ink-700">{v.draft}</p></div>
            <div className="rounded-xl border border-ink-100 p-4"><h3 className="font-display text-lg text-ink-900">{t.yourRewrite}</h3><p className="whitespace-pre-line text-base text-ink-700">{v.rewrite}</p></div>
          </div>
          {model}
        </div>
      ) : v.step === 1 ? (
        <div className="flex flex-col gap-3">
          <p className="text-base text-ink-700">{t.readTask}</p>
          <button type="button" className="btn-primary min-h-11 self-start" disabled={busy} onClick={() => void send({ action: "read" })}>{t.readDone}</button>
        </div>
      ) : v.step === 2 ? textStep("brainstorm", t.brainstormHint, 5)
        : v.step === 3 ? textStep("draft", t.draftHint, 12)
        : v.step === 4 ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            {model}
            <div className="flex flex-col gap-3">
              <p className="text-base text-ink-700">{t.analyseHint}</p>
              {(v.patterns ?? []).map((p) => (
                <label key={p.id} className={`flex min-h-11 cursor-pointer gap-3 rounded-xl border p-3 ${picked.includes(p.id) ? "border-signal-500 bg-signal-50 dark:bg-signal-950/40" : "border-ink-100"}`}>
                  <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked((x) => e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id))} className="mt-1 size-4" />
                  <span className="flex flex-col"><span className="text-xs font-semibold uppercase text-signal-600">{fns[p.fn]}</span><span className="font-semibold text-ink-900">{p.pattern}</span>{p.usageNote && <span className="text-sm text-ink-500">{p.usageNote}</span>}</span>
                </label>
              ))}
              <button type="button" className="btn-primary min-h-11 self-start" disabled={busy || picked.length === 0} onClick={() => void send({ action: "analyse", patternIds: picked })}>{t.continue}</button>
            </div>
          </div>
        ) : v.step === 5 ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-ink-100 p-4"><h3 className="font-display text-lg text-ink-900">{t.yourDraft}</h3><p className="whitespace-pre-line text-base text-ink-700">{v.draft}</p></div>
              {model}
            </div>
            {textStep("compare", t.compareHint, 5)}
          </div>
        ) : v.step === 6 ? (
          <div className="flex flex-col gap-3">
            <p className="text-base text-ink-700">{t.memoriseHint}</p>
            {(v.patterns ?? []).map((p) => {
              const done = v.memorisedPatternIds.includes(p.id);
              return (
                <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-ink-100 p-4" data-stealing-recall={p.id}>
                  <p className="text-xs font-semibold uppercase text-signal-600">{fns[p.fn]}</p>
                  <p className="text-base text-ink-700">{p.example}</p>
                  {done ? <p className="font-semibold text-band-good">{p.pattern} — {t.recallRight}</p> : (
                    <>
                      <input className="input" value={recall[p.id] ?? ""} onChange={(e) => setRecall((r) => ({ ...r, [p.id]: e.target.value }))} aria-label={t.recall} />
                      {recallState[p.id] === false && <p className="text-sm text-band-bad">{t.recallWrong}</p>}
                      <button type="button" className="btn-secondary min-h-11 self-start" disabled={busy || !(recall[p.id] ?? "").trim()} onClick={async () => { const d = await send({ action: "recall", patternId: p.id, attempt: recall[p.id] ?? "" }); if (d) setRecallState((s) => ({ ...s, [p.id]: Boolean(d.recalled) })); }}>{t.recall}</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : !v.rewriteUnlocked ? (
          <p role="status" className="rounded-md bg-paper-sunken p-4 text-base text-ink-700" data-stealing-rewrite-locked>{t.rewriteLocked.replace("{date}", v.rewriteAvailableAt ? new Date(v.rewriteAvailableAt).toLocaleString(locale === "uz" ? "uz-Latn-UZ" : "en-GB", { timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short" }) : "—")}</p>
        ) : textStep("rewrite", t.rewriteHint, 14)}
    </div>
  );
}
