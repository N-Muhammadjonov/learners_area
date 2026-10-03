"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { speakingPrompts } from "@/db/schema";
import { groupByTopic, parsePart, partCounts, PRACTICE_PARTS, resolveTopic, type PracticePart } from "@/lib/speaking/practice-browse";
import { QuestionRecorder } from "./QuestionRecorder";

type Prompt = typeof speakingPrompts.$inferSelect;

/**
 * Practice on your own: Part → Topic → Questions. The selection lives in the
 * URL (?part=&topic=) so Back, reload and shared links land on the same step.
 * Steps use history.pushState (which Next's router observes through
 * useSearchParams), so changing step costs no server round trip.
 * Each question renders its own QuestionRecorder; only one may hold the
 * microphone at a time.
 */
export function PracticeStudio({ dict, prompts }: { dict: Dictionary; prompts: Prompt[] }) {
  const t = dict.speakingPractice;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const part = parsePart(searchParams.get("part"));
  const topicKey = searchParams.get("topic");
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => partCounts(prompts), [prompts]);
  const groups = useMemo(() => (part ? groupByTopic(prompts, part) : []), [prompts, part]);
  const topic = resolveTopic(groups, topicKey);

  const go = useCallback((nextPart: PracticePart | null, nextTopic: string | null) => {
    const qs = new URLSearchParams();
    if (nextPart) qs.set("part", nextPart);
    if (nextTopic) qs.set("topic", nextTopic);
    const query = qs.toString();
    window.history.pushState(null, "", query ? `${pathname}?${query}` : pathname);
  }, [pathname]);

  const onBusyChange = useCallback((id: string, busy: boolean) => {
    setBusyId((current) => (busy ? id : current === id ? null : current));
  }, []);

  const locked = busyId !== null;
  const step = !part ? "part" : !topic ? "topic" : "questions";

  return (
    <div className="flex flex-col gap-5" data-practice-step={step}>
      <nav aria-label={t.stepsLabel} className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
        <button type="button" className="min-h-11 rounded-md px-2 hover:text-ink-900 disabled:opacity-50" disabled={locked} onClick={() => go(null, null)} data-practice-crumb="part">{t.choosePart}</button>
        {part && <><span aria-hidden>›</span><button type="button" className="min-h-11 rounded-md px-2 hover:text-ink-900 disabled:opacity-50" disabled={locked} onClick={() => go(part, null)} data-practice-crumb="topic">{t.part[part]}</button></>}
        {topic && <><span aria-hidden>›</span><span className="px-2 text-ink-900" aria-current="page">{topic.title ?? t.untitledTopic}</span></>}
      </nav>

      {step === "part" && (
        <div className="motion-enter-stagger grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4" data-practice-parts>
          {PRACTICE_PARTS.map((p, index) => (
            <button key={p} type="button" disabled={counts[p] === 0} onClick={() => go(p, null)} data-practice-part={p}
              className="practice-part-card motion-lift relative flex min-h-64 flex-col items-start gap-3 overflow-hidden rounded-3xl border p-6 text-left disabled:cursor-not-allowed disabled:opacity-50">
              <span aria-hidden="true" className="practice-part-number">{index + 1}</span>
              <span className="practice-part-mic" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/></svg></span>
              <span className="practice-part-label text-sm font-bold uppercase tracking-widest">{t.part[p]}</span>
              <span className="relative font-display text-3xl font-bold text-ink-900">{t.partTitle[p]}</span>
              <span className="relative text-base text-ink-500">{t.partBody[p]}</span>
              <span className="mt-auto text-xs text-ink-500">{t.questionCount.replace("{n}", String(counts[p]))}</span>
            </button>
          ))}
        </div>
      )}

      {step === "topic" && part && (
        groups.length === 0 ? (
          <p className="text-sm text-ink-500">{t.noQuestionsInPart}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" data-practice-topics>
            {groups.map((g) => (
              <li key={g.key}>
                <button type="button" onClick={() => go(part, g.key)} data-practice-topic={g.key}
                  className="card flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left hover:bg-paper-sunken">
                  <span className="text-base text-ink-900">{g.title ?? t.untitledTopic}</span>
                  <span className="shrink-0 text-xs text-ink-500">{t.questionCount.replace("{n}", String(g.prompts.length))}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {step === "questions" && topic && (
        <ol className="flex flex-col gap-4" data-practice-questions={topic.key}>
          {topic.prompts.map((p, i) => (
            <li key={p.id}>
              <QuestionRecorder dict={dict} prompt={p} index={i + 1} lockedBy={busyId} onBusyChange={onBusyChange} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
