"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";

type Item = { entryId: string | null; term: string; definitionEn: string | null; translationUz: string | null };
type Stats = { attempts: number; accepted: number; needsRevision: number; items: number; usageRecorded: number; averageBands: Record<string, number> };
type Result = { verdict: "correct" | "acceptable" | "needs_revision"; itemMissing: boolean; usageRecorded: boolean; result: { bands: Record<string, number | null>; feedback: string | null; improved: string | null; fixes: string[] } | null; stats: Stats };
type Setup = { source: "own" | "random"; ownList: string; count: number; mode: "writing" | "speaking"; uzbek: boolean; upgrade: boolean; level: "6" | "7" | "8"; feedback: "instant" | "summary" };

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Activation Lab (§44, PDF p.18). One item at a time; every judgement comes
 * from POST /api/writing/activation/check (external AI). Without AI the lab
 * shows an honest unavailable state and grades nothing.
 */
export function ActivationLab({ dict, aiReady, vocabularyCount, initialItem }: { dict: Dictionary; aiReady: boolean; vocabularyCount: number; initialItem?: string | null }) {
  const t = dict.writingWorkspace.activation;
  const [setup, setSetup] = useState<Setup>({ source: initialItem || vocabularyCount === 0 ? "own" : "random", ownList: initialItem ?? "", count: 10, mode: "writing", uzbek: false, upgrade: false, level: "7", feedback: "instant" });
  const [phase, setPhase] = useState<"setup" | "session" | "summary">("setup");
  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [plain, setPlain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [log, setLog] = useState<{ term: string; answer: string; r: Result }[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [seconds, setSeconds] = useState(0);
  const sessionId = useRef<string>("");

  useEffect(() => {
    if (phase !== "session") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  if (!aiReady) return <p role="status" className="rounded-md border border-ink-100 bg-paper-sunken p-4 text-base text-ink-700" data-activation-unavailable>{t.aiUnavailable}</p>;

  async function start() {
    setError(null);
    let list: Item[];
    if (setup.source === "own") {
      list = setup.ownList.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 30).map((term) => ({ entryId: null, term, definitionEn: null, translationUz: null }));
    } else {
      setBusy(true);
      const res = await fetch(`/api/writing/activation/items?count=${setup.count}`, { cache: "no-store" }).catch(() => null);
      setBusy(false);
      const data = res?.ok ? ((await res.json()) as { items: Item[] }) : null;
      if (!data) { setError(t.error); return; }
      list = data.items;
    }
    if (list.length === 0) { setError(setup.source === "own" ? t.noItems : t.noVocabulary); return; }
    sessionId.current = crypto.randomUUID();
    setItems(list); setIndex(0); setLog([]); setStats(null); setSeconds(0); setResult(null); setAnswer(""); setPlain("");
    setPhase("session");
  }

  async function check() {
    const item = items[index];
    if (!item || !answer.trim() || busy) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/writing/activation/check", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId.current, entryId: item.entryId, customTerm: item.entryId ? null : item.term, mode: setup.mode, targetLevel: setup.level, uzbekPrompt: setup.uzbek, upgradeFrom: setup.upgrade ? plain : null, answer }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) { setError(t.error); return; }
    const r = (await res.json()) as Result;
    setStats(r.stats);
    setLog((l) => [...l, { term: item.term, answer, r }]);
    if (setup.feedback === "instant") setResult(r); else next();
  }

  function next() {
    setResult(null); setAnswer(""); setPlain("");
    if (index + 1 >= items.length) setPhase("summary"); else setIndex((i) => i + 1);
  }

  const update = (p: Partial<Setup>) => setSetup((s) => ({ ...s, ...p }));
  const radio = "flex min-h-11 items-center gap-2 text-base text-ink-800";

  const header = (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.eyebrow}</p>
      <h2 className="font-display text-xl text-ink-900">{t.title}</h2>
      <p className="mt-1 max-w-3xl text-base text-ink-500">{t.body}</p>
    </div>
  );

  const statsBox = stats && (
    <dl className="grid grid-cols-3 gap-3 rounded-lg border border-ink-100 bg-paper-raised p-3 text-sm sm:grid-cols-6" data-activation-stats>
      {([[t.time, fmt(seconds)], [t.attempts, stats.attempts], [t.accepted, stats.accepted], [t.revisions, stats.needsRevision], [t.items, stats.items], [t.usage, stats.usageRecorded]] as const).map(([k, v]) => (
        <div key={k}><dt className="text-ink-500">{k}</dt><dd className="font-semibold text-ink-900">{v}</dd></div>
      ))}
    </dl>
  );

  if (phase === "setup") return (
    <div className="flex flex-col gap-5" data-activation-setup>
      {header}
      <fieldset className="flex flex-col gap-2"><legend className="font-semibold text-ink-900">{t.source}</legend>
        <label className={radio}><input type="radio" checked={setup.source === "random"} disabled={vocabularyCount === 0} onChange={() => update({ source: "random" })} />{t.random} ({vocabularyCount})</label>
        {vocabularyCount === 0 && <p className="text-sm text-ink-500">{t.noVocabulary}</p>}
        {setup.source === "random" && <label className="flex items-center gap-2 text-base">{t.count}<input type="number" min={1} max={30} value={setup.count} onChange={(e) => update({ count: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} className="input w-24" /></label>}
        <label className={radio}><input type="radio" checked={setup.source === "own"} onChange={() => update({ source: "own" })} />{t.own}</label>
        {setup.source === "own" && <textarea aria-label={t.ownHint} placeholder={t.ownHint} value={setup.ownList} onChange={(e) => update({ ownList: e.target.value })} rows={4} className="input" data-activation-own />}
      </fieldset>
      <fieldset className="flex flex-wrap gap-4"><legend className="font-semibold text-ink-900">{t.mode}</legend>
        <label className={radio}><input type="radio" checked={setup.mode === "writing"} onChange={() => update({ mode: "writing" })} />{t.writing}</label>
        <label className={radio}><input type="radio" checked={setup.mode === "speaking"} onChange={() => update({ mode: "speaking" })} />{t.speaking}</label>
      </fieldset>
      <fieldset className="flex flex-col gap-1"><legend className="font-semibold text-ink-900">{t.options}</legend>
        <label className={radio}><input type="checkbox" checked={setup.uzbek} onChange={(e) => update({ uzbek: e.target.checked })} />{t.uzbek}</label>
        <label className={radio}><input type="checkbox" checked={setup.upgrade} onChange={(e) => update({ upgrade: e.target.checked })} />{t.upgrade}</label>
      </fieldset>
      <fieldset className="flex flex-wrap gap-4"><legend className="font-semibold text-ink-900">{t.level}</legend>
        {(["6", "7", "8"] as const).map((l) => <label key={l} className={radio}><input type="radio" checked={setup.level === l} onChange={() => update({ level: l })} />Band {l}</label>)}
      </fieldset>
      <fieldset className="flex flex-wrap gap-4"><legend className="font-semibold text-ink-900">{t.feedback}</legend>
        <label className={radio}><input type="radio" checked={setup.feedback === "instant"} onChange={() => update({ feedback: "instant" })} />{t.instant}</label>
        <label className={radio}><input type="radio" checked={setup.feedback === "summary"} onChange={() => update({ feedback: "summary" })} />{t.summary}</label>
      </fieldset>
      {error && <p role="alert" className="text-base text-band-bad">{error}</p>}
      <button type="button" className="btn-primary min-h-11 self-start" disabled={busy} onClick={start} data-activation-start>{busy ? t.loading : t.start}</button>
    </div>
  );

  if (phase === "summary") return (
    <div className="flex flex-col gap-4" data-activation-summary>
      <h2 className="font-display text-xl text-ink-900">{t.summaryTitle}</h2>
      {statsBox}
      <ul className="flex flex-col gap-3">
        {log.map((e, i) => (
          <li key={i} className="rounded-lg border border-ink-100 p-3">
            <p className="font-semibold text-ink-900">{e.term} — {t.verdict[e.r.verdict]}</p>
            <p className="text-base text-ink-700">{e.answer}</p>
            {e.r.itemMissing && <p className="text-sm text-band-warn">{t.missing}</p>}
            {e.r.result?.improved && <p className="text-sm text-ink-600">{t.better}: {e.r.result.improved}</p>}
          </li>
        ))}
      </ul>
      <button type="button" className="btn-primary min-h-11 self-start" onClick={() => setPhase("setup")}>{t.again}</button>
    </div>
  );

  const item = items[index]!;
  const verdictColor = result?.verdict === "needs_revision" ? "text-band-bad" : result?.verdict === "acceptable" ? "text-band-warn" : "text-band-good";
  return (
    <div className="flex flex-col gap-4" data-activation-session>
      <div className="flex items-center justify-between text-sm text-ink-500"><span>{t.itemOf.replace("{n}", String(index + 1)).replace("{total}", String(items.length))}</span><span aria-label={t.time}>{fmt(seconds)}</span></div>
      <div className="rounded-xl border border-ink-100 bg-paper-raised p-4" data-activation-item>
        {setup.uzbek && item.translationUz ? (
          <><p className="text-sm text-ink-500">{t.uzbekMeaning}</p><p className="font-display text-2xl text-ink-900">{item.translationUz}</p>{result && <p className="mt-1 text-base text-ink-700">{item.term}</p>}</>
        ) : (
          <><p className="font-display text-2xl text-ink-900">{item.term}</p>{item.definitionEn && <p className="mt-1 text-base text-ink-600">{t.meaning}: {item.definitionEn}</p>}</>
        )}
      </div>
      {setup.mode === "speaking" && <p className="text-sm text-ink-500">{t.speakingHint}</p>}
      {setup.upgrade && <label className="flex flex-col gap-1 text-base">{t.plain}<textarea value={plain} onChange={(e) => setPlain(e.target.value)} rows={2} maxLength={600} className="input" disabled={!!result} /></label>}
      <label className="flex flex-col gap-1 text-base">{t.yourSentence}<textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} maxLength={600} className="input" disabled={!!result} data-activation-answer /></label>
      {error && <p role="alert" className="text-base text-band-bad">{error}</p>}
      {result && (
        <div className="rounded-lg border border-ink-100 p-3" role="status" data-activation-result={result.verdict}>
          <p className={`font-semibold ${verdictColor}`}>{t.verdict[result.verdict]}</p>
          {result.itemMissing && <p className="text-base text-ink-700">{t.missing}</p>}
          {result.result && (
            <>
              <ul className="mt-2 flex flex-wrap gap-3 text-sm">{Object.entries(result.result.bands).map(([k, v]) => <li key={k}>{t.criteria[k as keyof typeof t.criteria] ?? k}: <b>{v ?? "—"}</b></li>)}</ul>
              {result.result.feedback && <p className="mt-2 text-base text-ink-700">{result.result.feedback}</p>}
              {result.result.fixes.length > 0 && <ul className="mt-1 list-disc pl-5 text-base text-ink-700">{result.result.fixes.map((f) => <li key={f}>{f}</li>)}</ul>}
              {result.result.improved && <p className="mt-2 text-base text-ink-800">{t.better}: {result.result.improved}</p>}
            </>
          )}
          {result.usageRecorded && <p className="mt-2 text-sm text-band-good">{t.usageSaved}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {result ? (
          <>
            {result.verdict === "needs_revision" && <button type="button" className="btn-secondary min-h-11" onClick={() => setResult(null)}>{t.check}</button>}
            <button type="button" className="btn-primary min-h-11" onClick={next}>{index + 1 >= items.length ? t.finish : t.next}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn-primary min-h-11" disabled={busy || !answer.trim()} onClick={check} data-activation-check>{busy ? t.checking : t.check}</button>
            <button type="button" className="btn-secondary min-h-11" onClick={next}>{t.skip}</button>
          </>
        )}
      </div>
      {statsBox}
    </div>
  );
}
