import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import { listStealing, stealingLibrary, stealingSources, type StealingFilter } from "@/lib/services/writing/stealing";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { writingAiReady } from "@/lib/writing/ai-readiness";
import { PATTERN_FUNCTIONS, isPatternFunction } from "@/lib/writing/pattern-functions";
import { STEALING_STEPS } from "@/lib/writing/stealing-rules";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { SavePatternButton } from "@/components/writing/topic/SaveButtons";
import { PatternPractice } from "./PatternPractice";
import { StartStealingButton } from "./StartStealingButton";

export type StealingParams = { task?: string; fn?: string; topic?: string; band?: string; bank?: string };

function href(base: StealingParams, patch: StealingParams) {
  const q = new URLSearchParams({ tab: "language-stealing" });
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) q.set(k, v);
  return `/writing?${q.toString()}`;
}
function Pill({ href: h, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={h} aria-current={active ? "true" : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${active ? "border-signal-500 bg-signal-50 font-semibold text-ink-900 dark:bg-signal-950/40" : "border-ink-100 text-ink-700 hover:border-ink-300"}`}>{children}</Link>;
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2"><span className="w-24 text-sm font-semibold text-ink-700">{label}</span>{children}</div>;
}

/** Language Stealing (§44, PDF Language Stealing pages): 7-step workflow + filterable pattern library with adaptation practice. */
export async function WritingLanguageStealingTab({ dict, userId, params }: { dict: Dictionary; userId: string; params: StealingParams }) {
  const t = dict.writingWorkspace.stealing;
  const fns = dict.writingWorkspace.topicVocab.fns;
  const band = Number(params.band);
  const filter: StealingFilter = {
    task: params.task === "task1" || params.task === "task2" ? params.task : undefined,
    fn: isPatternFunction(params.fn) ? params.fn : undefined,
    topic: params.topic && params.topic.length <= 120 ? params.topic : undefined,
    band: Number.isInteger(band) && band >= 5 && band <= 9 ? band : undefined,
    saved: params.bank === "1",
  };
  const data = await safeWritingQuery(() => Promise.all([stealingLibrary(userId, filter), stealingSources(), listStealing(userId)]));
  if (!data.ok) return <NotMigrated dict={dict} />;
  const [lib, sources, sessions] = data.value;
  const cur: StealingParams = { task: filter.task, fn: filter.fn, topic: filter.topic, band: filter.band ? String(filter.band) : undefined, bank: filter.saved ? "1" : undefined };
  const aiReady = (await writingAiReady());
  const saveLabels = { save: t.save, saved: t.saved, error: t.saveError };

  return (
    <section className="flex flex-col gap-6" data-writing-language-stealing>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.eyebrow}</p>
        <h2 className="font-display text-xl text-ink-900">{t.title}</h2>
        <p className="mt-1 max-w-3xl text-base text-ink-500">{t.body}</p>
      </div>

      <div className="rounded-xl border border-ink-100 bg-paper-raised p-4" data-stealing-steps>
        <h3 className="font-display text-lg text-ink-900">{t.stepsTitle}</h3>
        <ol className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {STEALING_STEPS.map((s, i) => <li key={s} className="flex items-center gap-2 text-sm text-ink-700"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-signal-100 text-xs font-semibold text-signal-700 dark:bg-signal-900 dark:text-signal-200">{i + 1}</span>{t.steps[s]}</li>)}
        </ol>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="font-display text-lg text-ink-900">{t.sourcesTitle}</h3>
          {sources.length === 0 ? <p role="status" className="rounded-md bg-paper-sunken p-3 text-base text-ink-700">{t.noSources}</p> : sources.map((s) => {
            const mine = sessions.find((x) => x.modelTextId === s.id);
            return (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 bg-paper-raised p-4" data-stealing-source>
                <div>
                  <p className="font-semibold text-ink-900">{s.title}</p>
                  <p className="text-sm text-ink-500">{s.taskType === "task1" ? "Task 1" : "Task 2"} · {s.topic} · Band {s.targetBand} · {t.patternsCount.replace("{n}", String(s.patternCount))}</p>
                </div>
                {mine ? <Link href={`/writing/language-stealing/${mine.id}`} className="btn-secondary min-h-11">{mine.completedAt ? t.done : `${t.resume} · ${t.stepOf.replace("{n}", String(mine.step))}`}</Link>
                  : <StartStealingButton modelTextId={s.id} label={t.start} errorLabel={t.error} />}
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="font-display text-lg text-ink-900">{t.mySessions}</h3>
          {sessions.length === 0 ? <p className="text-base text-ink-500">—</p> : (
            <ul className="flex flex-col gap-2">{sessions.map((x) => {
              const src = sources.find((s) => s.id === x.modelTextId);
              return <li key={x.id}><Link href={`/writing/language-stealing/${x.id}`} className="flex min-h-11 items-center justify-between rounded-lg border border-ink-100 px-3 text-base text-ink-800 hover:border-ink-300"><span>{src?.title ?? "—"}</span><span className="text-sm text-ink-500">{x.completedAt ? t.done : t.stepOf.replace("{n}", String(x.step))}</span></Link></li>;
            })}</ul>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3" data-stealing-filters>
        <h3 className="font-display text-lg text-ink-900">{t.libraryTitle}</h3>
        <Row label={t.task}>
          <Pill href={href(cur, { task: undefined })} active={!filter.task}>{t.allTasks}</Pill>
          <Pill href={href(cur, { task: "task1" })} active={filter.task === "task1"}>Task 1</Pill>
          <Pill href={href(cur, { task: "task2" })} active={filter.task === "task2"}>Task 2</Pill>
        </Row>
        <Row label={t.fn}>
          <Pill href={href(cur, { fn: undefined })} active={!filter.fn}>{t.allFunctions}</Pill>
          {PATTERN_FUNCTIONS.map((f) => <Pill key={f} href={href(cur, { fn: f })} active={filter.fn === f}>{fns[f]}</Pill>)}
        </Row>
        {lib.topics.length > 0 && <Row label={t.topic}>
          <Pill href={href(cur, { topic: undefined })} active={!filter.topic}>{t.allTopics}</Pill>
          {lib.topics.map((x) => <Pill key={x} href={href(cur, { topic: x })} active={filter.topic?.toLowerCase() === x.toLowerCase()}>{x}</Pill>)}
        </Row>}
        {lib.bands.length > 0 && <Row label={t.band}>
          <Pill href={href(cur, { band: undefined })} active={!filter.band}>{t.allBands}</Pill>
          {lib.bands.map((b) => <Pill key={b} href={href(cur, { band: String(b) })} active={filter.band === b}>{b}</Pill>)}
        </Row>}
        <Row label="">
          <Pill href={href(cur, { bank: undefined })} active={!filter.saved}>{t.allPatterns}</Pill>
          <Pill href={href(cur, { bank: "1" })} active={Boolean(filter.saved)}>{t.bankOnly} ({lib.savedCount})</Pill>
        </Row>
      </div>

      {lib.patterns.length === 0 ? <p role="status" className="rounded-md bg-paper-sunken p-3 text-base text-ink-700" data-stealing-empty>{t.noPatterns}</p> : (
        <ul className="grid gap-4 md:grid-cols-2">
          {lib.patterns.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-ink-100 bg-paper-raised p-4 motion-lift" data-stealing-pattern={p.id}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-signal-600 dark:text-signal-400">{fns[p.fn]} · {p.taskType === "task1" ? "Task 1" : "Task 2"}{p.targetBand ? ` · Band ${p.targetBand}` : ""}{p.topic ? ` · ${p.topic}` : ""}</p>
              <p className="font-display text-lg text-ink-900">{p.pattern}</p>
              <p className="text-base text-ink-700"><span className="font-semibold">{t.example}:</span> {p.example}</p>
              {p.usageNote && <p className="text-sm text-ink-500"><span className="font-semibold">{t.usage}:</span> {p.usageNote}</p>}
              <div className="mt-1 flex flex-wrap items-start gap-2">
                <SavePatternButton id={p.id} initialSaved={p.saved} labels={saveLabels} />
              </div>
              <PatternPractice dict={dict} patternId={p.id} aiReady={aiReady} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
