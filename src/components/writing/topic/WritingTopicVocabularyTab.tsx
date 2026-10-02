import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/en";
import { topicVocabulary, type PatternView, type TopicFilter } from "@/lib/services/writing/topic-vocabulary";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { PATTERN_FUNCTIONS, PATTERN_SECTION, isPatternFunction } from "@/lib/writing/pattern-functions";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { SavePatternButton, SaveWordButton } from "./SaveButtons";

type Params = { topic?: string; task?: string; fn?: string };

function href(base: Params, patch: Params) {
  const q = new URLSearchParams({ tab: "topic-vocabulary" });
  const merged = { ...base, ...patch };
  for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
  return `/writing?${q.toString()}`;
}

/** Topic Vocabulary (PDF p.13): filters → words, collocations, power phrases, frames — each with model use and actions. */
export async function WritingTopicVocabularyTab({ dict, userId, locale, params }: { dict: Dictionary; userId: string; locale: string; params: Params }) {
  const t = dict.writingWorkspace.topicVocab;
  const filter: TopicFilter = {
    topic: params.topic && /^[a-z0-9_]{1,60}$/.test(params.topic) ? params.topic : undefined,
    task: params.task === "task1" || params.task === "task2" ? params.task : undefined,
    fn: isPatternFunction(params.fn) ? params.fn : undefined,
  };
  const data = await safeWritingQuery(() => topicVocabulary(userId, filter));
  if (!data.ok) return <NotMigrated dict={dict} />;
  const { topics, words, patterns } = data.value;
  const cur: Params = { topic: filter.topic, task: filter.task, fn: filter.fn };
  const lang = locale === "uz" ? "uz" : "en";
  const bySection = (s: "collocations" | "powerPhrases" | "frames") => patterns.filter((p) => PATTERN_SECTION[p.fn] === s);
  const saveLabels = { save: t.save, saved: t.saved, saving: t.saving, error: t.saveError };

  return (
    <section className="flex flex-col gap-5" data-writing-topic-vocabulary>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.eyebrow}</p>
        <h2 className="font-display text-xl text-ink-900">{t.title}</h2>
        <p className="mt-1 max-w-3xl text-base text-ink-500">{t.body}</p>
      </div>

      <div className="flex flex-col gap-3" data-topic-filters>
        <FilterRow label={t.topic}>
          <Pill href={href(cur, { topic: undefined })} active={!filter.topic}>{t.allTopics}</Pill>
          {topics.map((x) => <Pill key={x.id} href={href(cur, { topic: x.id })} active={filter.topic === x.id}>{x.label[lang]}</Pill>)}
        </FilterRow>
        <FilterRow label={t.task}>
          <Pill href={href(cur, { task: undefined })} active={!filter.task}>{t.allTasks}</Pill>
          <Pill href={href(cur, { task: "task1" })} active={filter.task === "task1"}>Task 1</Pill>
          <Pill href={href(cur, { task: "task2" })} active={filter.task === "task2"}>Task 2</Pill>
        </FilterRow>
        <FilterRow label={t.fn}>
          <Pill href={href(cur, { fn: undefined })} active={!filter.fn}>{t.allFunctions}</Pill>
          {PATTERN_FUNCTIONS.map((f) => <Pill key={f} href={href(cur, { fn: f })} active={filter.fn === f}>{t.fns[f]}</Pill>)}
        </FilterRow>
      </div>

      {words.length > 0 && (
        <div>
          <h3 className="mb-3 font-display text-lg text-ink-900">{t.sections.words}</h3>
          <ul className="grid gap-3 md:grid-cols-2" data-topic-words>
            {words.map((w) => (
              <li key={`${w.packId}:${w.term}`} className="card flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-lg text-ink-900">{w.term}</span>
                  <span className="text-sm italic text-ink-500">{w.partOfSpeech}</span>
                </div>
                <p className="text-base text-ink-700">{w.definitionEn}</p>
                <p className="text-sm text-ink-500">{w.translationUz}</p>
                {w.collocations && <p className="text-sm text-ink-700"><span className="font-semibold">{t.collocationsLabel}:</span> {w.collocations}</p>}
                <p className="rounded-md bg-paper-sunken p-2 text-sm text-ink-700"><span className="font-semibold">{t.inContext}:</span> {w.example}</p>
                <div className="mt-auto flex flex-wrap gap-2">
                  <SaveWordButton word={w} packId={w.packId} initialSaved={w.saved} labels={saveLabels} />
                  <Link className="btn-secondary min-h-11" href="/vocabulary/review">{t.practice}</Link>
                  <Link className="btn-secondary min-h-11" href={`/writing?tab=activation&item=${encodeURIComponent(w.term)}`} data-topic-activate>{t.activate}</Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(["collocations", "powerPhrases", "frames"] as const).map((s) => {
        const list = bySection(s);
        if (!list.length) return null;
        return (
          <div key={s}>
            <h3 className="mb-3 font-display text-lg text-ink-900">{t.sections[s]}</h3>
            <ul className="grid gap-3 md:grid-cols-2" data-topic-patterns={s}>
              {list.map((p) => <PatternCard key={p.id} p={p} dict={dict} />)}
            </ul>
          </div>
        );
      })}

      {patterns.length === 0 && <p role="status" className="rounded-md border border-ink-100 bg-paper-sunken p-4 text-base text-ink-700">{words.length ? t.noPatterns : t.empty}</p>}
    </section>
  );
}

function PatternCard({ p, dict }: { p: PatternView; dict: Dictionary }) {
  const t = dict.writingWorkspace.topicVocab;
  return (
    <li className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <span className="badge bg-signal-100 text-signal-700">{t.fns[p.fn]}</span>
        <span>{p.taskType === "task1" ? "Task 1" : "Task 2"}</span>
        {p.targetBand != null && <span>{t.band} {p.targetBand}</span>}
        {p.topic && <span>· {p.topic}</span>}
      </div>
      <p className="font-display text-lg text-ink-900">{p.pattern}</p>
      <p className="rounded-md bg-paper-sunken p-2 text-sm text-ink-700"><span className="font-semibold">{t.inContext}:</span> {p.example}</p>
      {p.usageNote && <p className="text-sm text-ink-500"><span className="font-semibold">{t.usage}:</span> {p.usageNote}</p>}
      <div className="mt-auto flex flex-wrap gap-2">
        <SavePatternButton id={p.id} initialSaved={p.saved} labels={{ save: t.savePattern, saved: t.patternSaved, error: t.saveError }} />
        <Link className="btn-secondary min-h-11" href={`/writing?tab=activation&item=${encodeURIComponent(p.pattern)}`}>{t.activate}</Link>
      </div>
    </li>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="w-full text-sm font-semibold text-ink-900 sm:w-36">{label}</span>
      {children}
    </div>
  );
}

function Pill({ href: h, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={h} scroll={false} aria-current={active ? "true" : undefined}
      className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${active ? "border-signal-600 bg-signal-50 font-semibold text-ink-900 dark:bg-signal-950/30" : "border-ink-100 text-ink-700"}`}>
      {children}
    </Link>
  );
}
