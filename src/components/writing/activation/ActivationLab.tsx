"use client";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

import { formatDate } from "@/lib/time";
import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";

type Item = { entryId: string | null; term: string; definitionEn: string | null; translationUz: string | null };
type Stats = { attempts: number; accepted: number; needsRevision: number; items: number; usageRecorded: number; averageBands: Record<string, number>; averageActivation: number | null };
type CheckBody = { bands: Record<string, number | null>; feedback: string | null; improved: string | null; fixes: string[] };
type Result = { verdict: "correct" | "acceptable" | "needs_revision"; itemMissing: boolean; usageRecorded: boolean; activationScore: number | null; uzbekApplied: boolean; result: CheckBody | null; stats: Stats };
export type ActivationOverviewView = { wordsActivated: number; averageActivation: number | null; dayStreak: number; lastSession: { at: string; stats: Stats } | null };
type Level = "5.5" | "6.0" | "6.5" | "7.0" | "7.5+";
type Task = "invent" | "uzbek" | "upgrade";
type Setup = { source: "own" | "random"; ownList: string; count: number; mode: "writing" | "speaking"; task: Task; level: Level; feedback: "instant" | "summary" };
type LogEntry = { item: Item; answer: string; r: Result | null };

const LEVELS: Level[] = ["5.5", "6.0", "6.5", "7.0", "7.5+"];
const CRITERIA = ["meaning", "form", "collocation", "naturalness", "grammar"] as const;
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function Choice({ checked, onSelect, title, desc, name, disabled, testId }: { checked: boolean; onSelect: () => void; title: string; desc?: string; name: string; disabled?: boolean; testId?: string }) {
  return (
    <label data-activation-choice={testId} className={`flex min-h-11 cursor-pointer flex-col gap-1 rounded-xl border p-4 transition-colors motion-lift ${checked ? "border-signal-500 bg-signal-50 dark:bg-signal-950/40" : "border-ink-100 bg-paper-raised hover:border-ink-300"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}>
      <span className="flex items-center gap-2 font-semibold text-ink-900"><input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} className="size-4" />{title}</span>
      {desc && <span className="text-sm text-ink-500">{desc}</span>}
    </label>
  );
}

/** Full per-item feedback — identical in "Ask & feedback" and in the end-of-session summary (no second AI call). */
function Feedback({ t, entry }: { t: Dictionary["writingWorkspace"]["activation"]; entry: LogEntry }) {
  const r = entry.r;
  if (!r) return <p className="text-sm text-ink-500">{t.skipped}</p>;
  const color = r.verdict === "needs_revision" ? "text-band-bad" : r.verdict === "acceptable" ? "text-band-warn" : "text-band-good";
  return (
    <div className="flex flex-col gap-2" data-activation-feedback={r.verdict}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={`font-semibold ${color}`}>{t.verdict[r.verdict]}</p>
        <p className="text-sm text-ink-600" data-activation-score>{t.score}: <b className="text-ink-900">{r.activationScore ?? "—"}</b>{r.activationScore != null && " / 100"}</p>
      </div>
      {r.itemMissing && <p className="text-base text-ink-700">{t.missing}</p>}
      {r.result && (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5" data-activation-criteria>
            {CRITERIA.map((k) => <div key={k} className="rounded-md bg-paper-sunken p-2"><dt className="text-ink-500">{t.criteria[k]}</dt><dd className="font-semibold text-ink-900">{r.result!.bands[k] ?? "—"}</dd></div>)}
          </dl>
          {r.result.feedback && <p className="text-base text-ink-700">{r.result.feedback}</p>}
          {r.result.improved && <p className="text-base text-ink-800"><span className="font-semibold">{t.better}:</span> {r.result.improved}</p>}
          {r.result.fixes.length > 0 && <div><p className="text-sm font-semibold text-ink-700">{t.fixes}</p><ul className="list-disc pl-5 text-base text-ink-700">{r.result.fixes.slice(0, 3).map((f) => <li key={f}>{f}</li>)}</ul></div>}
        </>
      )}
      {entry.item.entryId
        ? <p className={`text-sm ${r.usageRecorded ? "text-band-good" : "text-ink-500"}`}>{r.usageRecorded ? t.usageSaved : t.usageNotSaved}</p>
        : <p className="text-sm text-ink-500">{t.customNote}</p>}
    </div>
  );
}

/**
 * Activation Lab (§43, W5, PDF Activation page). Every judgement comes from
 * POST /api/writing/activation/check (external AI). Own lists are resolved
 * against MY Vocabulary on the server. Without AI: honest unavailable state.
 */
export function ActivationLab({ dict, aiReady, vocabularyCount, initialItem, overview, locale }: { dict: Dictionary; aiReady: boolean; vocabularyCount: number; initialItem?: string | null; overview: ActivationOverviewView; locale: "uz" | "en" }) {
  const request = useScopedRequest();
  const t = dict.writingWorkspace.activation;
  const [setup, setSetup] = useState<Setup>({ source: initialItem || vocabularyCount === 0 ? "own" : "random", ownList: initialItem ?? "", count: 10, mode: "writing", task: "invent", level: "6.5", feedback: "instant" });
  const [phase, setPhase] = useState<"setup" | "session" | "summary">("setup");
  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [plain, setPlain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Result | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
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
    if (busy) return;
    setError(null);
    const terms = setup.ownList.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 30);
    if (setup.source === "own" && !terms.length) {setError(t.noItems); return;}
    setBusy(true);
    const res = setup.source === "own"
      ? await request<{items: Item[]}>("/api/writing/activation/items", {body: {terms}})
      : await request<{items: Item[]}>(`/api/writing/activation/items?count=${setup.count}`, {method: "GET"});
    if (!res) return;
    setBusy(false);
    const data = res.ok ? res.data : null;
    if (!data || !Array.isArray(data.items)) {setError(t.error); return;}
    if (!data.items.length) {setError(setup.source === "own" ? t.noItems : t.noVocabulary); return;}
    sessionId.current = crypto.randomUUID();
    setItems(data.items); setIndex(0); setLog([]); setStats(null); setSeconds(0); setCurrent(null); setAnswer(""); setPlain("");
    setPhase("session");
  }

  async function check() {
    const item = items[index];
    if (!item || !answer.trim() || busy) return;
    setBusy(true); setError(null);
    const res = await request<Result>("/api/writing/activation/check", {
      timeoutMs: 60_000,
      body: {sessionId: sessionId.current, entryId: item.entryId, customTerm: item.entryId ? null : item.term, mode: setup.mode, targetLevel: setup.level, uzbekPrompt: setup.task === "uzbek", upgradeFrom: setup.task === "upgrade" ? plain : null, answer},
    });
    if (!res) return;
    setBusy(false);
    if (!res.ok || !res.data?.stats) {setError(t.error); return;}
    const r = res.data;
    setStats(r.stats);
    const entry = { item, answer, r };
    setLog((l) => [...l.filter((e) => e.item !== item), entry]);
    if (setup.feedback === "instant") setCurrent(r); else advance();
  }

  function advance() {
    setCurrent(null); setAnswer(""); setPlain("");
    if (index + 1 >= items.length) setPhase("summary"); else setIndex((i) => i + 1);
  }
  function skip() {
    const item = items[index]!;
    setLog((l) => (l.some((e) => e.item === item) ? l : [...l, { item, answer: "", r: null }]));
    advance();
  }

  const update = (p: Partial<Setup>) => setSetup((s) => ({ ...s, ...p }));
  const stepTitle = (n: number, label: string) => <legend className="mb-2 flex items-baseline gap-2"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.step.replace("{n}", String(n))}</span><span className="font-display text-lg text-ink-900">{label}</span></legend>;

  const statsBox = stats && (
    <dl className="grid grid-cols-3 gap-3 rounded-lg border border-ink-100 bg-paper-raised p-3 text-sm sm:grid-cols-7" data-activation-stats>
      {([[t.time, fmt(seconds)], [t.attempts, stats.attempts], [t.accepted, stats.accepted], [t.revisions, stats.needsRevision], [t.items, stats.items], [t.usage, stats.usageRecorded], [t.score, stats.averageActivation ?? "—"]] as const).map(([k, v]) => (
        <div key={k}><dt className="text-ink-500">{k}</dt><dd className="font-semibold text-ink-900">{v}</dd></div>
      ))}
    </dl>
  );

  if (phase === "setup") {
    const last = overview.lastSession;
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]" data-activation-setup>
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.eyebrow}</p>
            <h2 className="font-display text-2xl text-ink-900">{t.title}</h2>
            <p className="mt-1 max-w-3xl text-base text-ink-500">{t.body}</p>
          </div>
          <fieldset>{stepTitle(1, t.source)}
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice name="act-source" testId="own" checked={setup.source === "own"} onSelect={() => update({ source: "own" })} title={t.own} desc={t.ownDesc} />
              <Choice name="act-source" testId="random" checked={setup.source === "random"} disabled={vocabularyCount === 0} onSelect={() => update({ source: "random" })} title={`${t.random} (${vocabularyCount})`} desc={vocabularyCount === 0 ? t.noVocabulary : t.randomDesc} />
            </div>
            {setup.source === "own" && <textarea aria-label={t.ownHint} placeholder={t.ownHint} value={setup.ownList} onChange={(e) => update({ ownList: e.target.value })} rows={4} className="input mt-3 w-full" data-activation-own />}
            {setup.source === "random" && <label className="mt-3 flex items-center gap-2 text-base text-ink-800">{t.count}<input type="number" min={1} max={30} value={setup.count} onChange={(e) => update({ count: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} className="input w-24" /></label>}
          </fieldset>
          <fieldset>{stepTitle(2, t.mode)}
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice name="act-mode" checked={setup.mode === "writing"} onSelect={() => update({ mode: "writing" })} title={t.writing} desc={t.writingDesc} />
              <Choice name="act-mode" checked={setup.mode === "speaking"} onSelect={() => update({ mode: "speaking" })} title={t.speaking} desc={t.speakingDesc} />
            </div>
            {setup.mode === "speaking" && <p className="mt-2 text-sm text-ink-600" data-activation-speaking-note>{t.speakingHint}</p>}
          </fieldset>
          <fieldset>{stepTitle(3, t.task)}
            <div className="grid gap-3 sm:grid-cols-3">
              <Choice name="act-task" checked={setup.task === "invent"} onSelect={() => update({ task: "invent" })} title={t.taskInvent} />
              <Choice name="act-task" checked={setup.task === "uzbek"} onSelect={() => update({ task: "uzbek" })} title={t.taskUzbek} desc={t.taskUzbekDesc} />
              <Choice name="act-task" checked={setup.task === "upgrade"} onSelect={() => update({ task: "upgrade" })} title={t.taskUpgrade} desc={t.taskUpgradeDesc} />
            </div>
          </fieldset>
          <fieldset>{stepTitle(4, t.level)}
            <div className="flex flex-wrap gap-2" role="radiogroup" data-activation-levels>
              {LEVELS.map((l) => (
                <label key={l} className={`flex min-h-11 min-w-16 cursor-pointer items-center justify-center rounded-lg border px-4 font-semibold ${setup.level === l ? "border-signal-500 bg-signal-50 text-ink-900 dark:bg-signal-950/40" : "border-ink-100 text-ink-700"}`}>
                  <input type="radio" name="act-level" className="sr-only" checked={setup.level === l} onChange={() => update({ level: l })} />{l}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>{stepTitle(5, t.feedback)}
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice name="act-feedback" checked={setup.feedback === "instant"} onSelect={() => update({ feedback: "instant" })} title={t.instant} />
              <Choice name="act-feedback" checked={setup.feedback === "summary"} onSelect={() => update({ feedback: "summary" })} title={t.summary} />
            </div>
          </fieldset>
          {error && <p role="alert" className="text-base text-band-bad">{error}</p>}
          <button type="button" className="btn-primary min-h-11 self-start" disabled={busy} onClick={start} data-activation-start>{busy ? t.loading : t.start}</button>
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start" data-activation-rail>
          <section className="rounded-xl border border-ink-100 bg-paper-raised p-4">
            <h3 className="font-display text-lg text-ink-900">{t.howTitle}</h3>
            <ol className="mt-2 flex flex-col gap-2 text-base text-ink-700">
              {[t.how1, t.how2, t.how3, t.how4].map((s, i) => <li key={s} className="flex gap-2"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-signal-100 text-sm font-semibold text-signal-700 dark:bg-signal-900 dark:text-signal-200">{i + 1}</span>{s}</li>)}
            </ol>
          </section>
          <section className="rounded-xl border border-ink-100 bg-paper-raised p-4" data-activation-overview>
            <h3 className="font-display text-lg text-ink-900">{t.progressTitle}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-ink-500">{t.wordsActivated}</dt><dd className="text-xl font-semibold text-ink-900">{overview.wordsActivated}</dd></div>
              <div><dt className="text-ink-500">{t.averageActivation}</dt><dd className="text-xl font-semibold text-ink-900">{overview.averageActivation ?? "—"}</dd></div>
              <div><dt className="text-ink-500">{t.dayStreak}</dt><dd className="text-xl font-semibold text-ink-900">{overview.dayStreak}</dd></div>
              <div className="col-span-2"><dt className="text-ink-500">{t.lastSession}</dt><dd className="text-base text-ink-900">{last ? t.lastSessionLine.replace("{date}", formatDate(last.at, locale)).replace("{accepted}", String(last.stats.accepted)).replace("{attempts}", String(last.stats.attempts)) : t.noSessions}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    );
  }

  if (phase === "summary") return (
    <div className="flex flex-col gap-4" data-activation-summary>
      <h2 className="font-display text-xl text-ink-900">{t.summaryTitle}</h2>
      {statsBox}
      <ul className="flex flex-col gap-3">
        {log.map((e, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-paper-raised p-4" data-activation-summary-item>
            <p className="font-display text-lg text-ink-900">{e.item.term}</p>
            {e.answer && <p className="text-base text-ink-700">“{e.answer}”</p>}
            <Feedback t={t} entry={e} />
          </li>
        ))}
      </ul>
      <button type="button" className="btn-primary min-h-11 self-start" onClick={() => setPhase("setup")}>{t.again}</button>
    </div>
  );

  const item = items[index]!;
  const uzbekCue = setup.task === "uzbek" && Boolean(item.translationUz);
  const recallHidden = uzbekCue && !current;
  return (
    <div className="flex flex-col gap-4" data-activation-session>
      <div className="flex items-center justify-between text-sm text-ink-500"><span>{t.itemOf.replace("{n}", String(index + 1)).replace("{total}", String(items.length))}</span><span aria-label={t.time}>{fmt(seconds)}</span></div>
      <div className="rounded-xl border border-ink-100 bg-paper-raised p-4" data-activation-item data-activation-canonical={item.entryId ? "yes" : "no"}>
        {uzbekCue ? (
          <><p className="text-sm text-ink-500">{t.uzbekMeaning}</p><p className="font-display text-2xl text-ink-900" data-activation-uz-cue>{item.translationUz}</p>{!recallHidden && <p className="mt-1 text-base text-ink-700">{item.term}</p>}</>
        ) : (
          <><p className="font-display text-2xl text-ink-900">{item.term}</p>{item.definitionEn && <p className="mt-1 text-base text-ink-600">{t.meaning}: {item.definitionEn}</p>}</>
        )}
        {setup.task === "uzbek" && !item.translationUz && <p className="mt-2 text-sm text-ink-500" data-activation-uz-unavailable>{t.uzbekUnavailable}</p>}
        {!item.entryId && <p className="mt-2 text-sm text-ink-500">{t.customNote}</p>}
      </div>
      {setup.mode === "speaking" && <p className="text-sm text-ink-500">{t.speakingHint}</p>}
      {setup.task === "upgrade" && <label className="flex flex-col gap-1 text-base">{t.plain}<textarea value={plain} onChange={(e) => setPlain(e.target.value)} rows={2} maxLength={600} className="input" disabled={!!current} /></label>}
      <label className="flex flex-col gap-1 text-base">{t.yourSentence}<textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} maxLength={600} className="input" disabled={!!current} data-activation-answer /></label>
      {error && <p role="alert" className="text-base text-band-bad">{error}</p>}
      {current && <div className="rounded-xl border border-ink-100 p-4" role="status" data-activation-result={current.verdict}><Feedback t={t} entry={{ item, answer, r: current }} /></div>}
      <div className="flex flex-wrap gap-3">
        {current ? (
          <>
            {current.verdict === "needs_revision" && <button type="button" className="btn-secondary min-h-11" onClick={() => setCurrent(null)}>{t.tryAgain}</button>}
            <button type="button" className="btn-primary min-h-11" onClick={advance}>{index + 1 >= items.length ? t.finish : t.next}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn-primary min-h-11" disabled={busy || !answer.trim()} onClick={check} data-activation-check>{busy ? t.checking : t.check}</button>
            <button type="button" className="btn-secondary min-h-11" onClick={skip}>{t.skip}</button>
          </>
        )}
      </div>
      {statsBox}
    </div>
  );
}
