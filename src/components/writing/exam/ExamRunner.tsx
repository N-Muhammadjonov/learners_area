"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { ExamPaperView } from "@/lib/services/writing/exam";
import { countEssayWords } from "@/lib/writing/grade-criteria";
import { EXAM_AUTOSAVE_DEBOUNCE_MS, EXAM_MIN_WORDS, formatClock } from "@/lib/writing/exam-modes";

type SaveState = "idle" | "saving" | "saved" | "failed";
type EntryState = { text: string; revision: number; savedRevision: number };

const backupKey = (paperId: string, position: number) => `la:writing-exam:${paperId}:${position}`;
const RETRY_STEPS_MS = [2000, 4000, 8000, 15000, 30000];

/**
 * The exam room. The server's remainingSeconds (computed by Postgres) seeds a
 * monotonic countdown; the browser's wall clock is never read, so changing the
 * device time cannot add minutes. Autosave is debounced and revisioned; every
 * change is mirrored to localStorage first so a failed save never loses text.
 */
export function ExamRunner({ dict, paper, materials }: { dict: Dictionary; paper: ExamPaperView; materials: Record<number, ReactNode> }) {
  const t = dict.writingWorkspace.exam;
  const router = useRouter();
  const [active, setActive] = useState(paper.entries[0]!.position);
  const [entries, setEntries] = useState<Record<number, EntryState>>(() =>
    Object.fromEntries(paper.entries.map((e) => [e.position, { text: e.content, revision: e.revision, savedRevision: e.revision }])));
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [save, setSave] = useState<SaveState>("idle");
  const [remaining, setRemaining] = useState(paper.remainingSeconds);
  const [frozen, setFrozen] = useState(paper.remainingSeconds <= 0);
  const [busy, setBusy] = useState<null | "submit" | "leave">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timers = useRef<{ debounce?: ReturnType<typeof setTimeout>; retry?: ReturnType<typeof setTimeout>; attempt: number }>({ attempt: 0 });
  const inflight = useRef<Promise<boolean> | null>(null);

  // Restore a newer local copy (e.g. the last save never reached the server).
  useEffect(() => {
    const restored: Record<number, EntryState> = {};
    for (const e of paper.entries) {
      try {
        const raw = window.localStorage.getItem(backupKey(paper.id, e.position));
        const b = raw ? (JSON.parse(raw) as { text?: string; revision?: number }) : null;
        if (b && typeof b.text === "string" && typeof b.revision === "number" && b.revision > e.revision) {
          restored[e.position] = { text: b.text, revision: b.revision, savedRevision: e.revision };
        }
      } catch { /* storage blocked: server copy stands */ }
    }
    if (Object.keys(restored).length) setEntries((prev) => ({ ...prev, ...restored }));
  }, [paper.id, paper.entries]);

  // Display countdown from the server-provided remaining time (monotonic clock).
  useEffect(() => {
    if (paper.finalizedAt) return;
    const origin = performance.now();
    const start = paper.remainingSeconds;
    const id = window.setInterval(() => {
      const left = Math.max(0, start - Math.floor((performance.now() - origin) / 1000));
      setRemaining(left);
      if (left <= 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [paper.finalizedAt, paper.remainingSeconds]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    const dirty = Object.entries(entriesRef.current).filter(([, e]) => e.revision > e.savedRevision);
    if (!dirty.length) return true;
    setSave("saving");
    const run = (async () => {
      let allOk = true;
      for (const [pos, e] of dirty) {
        try {
          const res = await fetch(`/api/writing/exam/${paper.id}/draft`, {
            method: "PUT", headers: { "content-type": "application/json" },
            body: JSON.stringify({ position: Number(pos), content: e.text, revision: e.revision }),
          });
          if (res.status === 409) { allOk = false; setFrozen(true); continue; }
          if (!res.ok) { allOk = false; continue; }
          setEntries((prev) => ({ ...prev, [pos]: { ...prev[Number(pos)]!, savedRevision: Math.max(prev[Number(pos)]!.savedRevision, e.revision) } }));
        } catch { allOk = false; }
      }
      return allOk;
    })();
    inflight.current = run;
    const ok = await run;
    inflight.current = null;
    setSave(ok ? "saved" : "failed");
    if (ok) timers.current.attempt = 0;
    return ok;
  }, [paper.id]);

  const scheduleRetry = useCallback(() => {
    clearTimeout(timers.current.retry);
    const delay = RETRY_STEPS_MS[Math.min(timers.current.attempt, RETRY_STEPS_MS.length - 1)]!;
    timers.current.attempt += 1;
    timers.current.retry = setTimeout(async () => { if (!(await flush())) scheduleRetry(); }, delay);
  }, [flush]);

  const onChange = (position: number, text: string) => {
    if (frozen || paper.finalizedAt) return;
    setEntries((prev) => {
      const cur = prev[position]!;
      const next = { ...cur, text, revision: cur.revision + 1 };
      try { window.localStorage.setItem(backupKey(paper.id, position), JSON.stringify({ text, revision: next.revision })); } catch { /* ignore */ }
      return { ...prev, [position]: next };
    });
    clearTimeout(timers.current.debounce);
    timers.current.debounce = setTimeout(async () => { if (!(await flush())) scheduleRetry(); }, EXAM_AUTOSAVE_DEBOUNCE_MS);
  };

  // Time up: freeze editing, flush the visible text, then let the server close the paper.
  useEffect(() => {
    if (remaining > 0 || paper.finalizedAt) return;
    setFrozen(true);
    clearTimeout(timers.current.debounce);
    void (async () => {
      const ok = await flush();
      setNotice(ok ? t.timeUp : t.saveFailed);
      if (!ok) scheduleRetry();
      // Give the server's grace window a moment, then reload the closed paper.
      setTimeout(() => router.refresh(), 16_000);
    })();
  }, [remaining, paper.finalizedAt, flush, scheduleRetry, router, t.timeUp, t.saveFailed]);

  // Warn before unloading with unsaved text.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (Object.values(entriesRef.current).some((e) => e.revision > e.savedRevision)) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  useEffect(() => () => { clearTimeout(timers.current.debounce); clearTimeout(timers.current.retry); }, []);

  const finish = async (reason: "submitted" | "abandoned") => {
    if (!window.confirm(reason === "submitted" ? t.submitConfirm : t.leaveConfirm)) return;
    setBusy(reason === "submitted" ? "submit" : "leave");
    clearTimeout(timers.current.debounce);
    const ok = await flush();
    if (!ok && reason === "submitted") { setBusy(null); setNotice(t.saveFailed); scheduleRetry(); return; }
    const res = await fetch(`/api/writing/exam/${paper.id}/finalize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) { setNotice(t.saveFailed); return; }
    for (const e of paper.entries) { try { window.localStorage.removeItem(backupKey(paper.id, e.position)); } catch { /* ignore */ } }
    if (reason === "abandoned") router.push("/writing?tab=exam");
    else router.refresh();
  };

  const current = paper.entries.find((e) => e.position === active)!;
  const state = entries[active]!;
  const words = countEssayWords(state.text);
  const min = EXAM_MIN_WORDS[current.taskType];
  const low = remaining <= 300;

  return (
    <div className="flex flex-col gap-4" data-exam-runner data-exam-mode={paper.mode}>
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-paper-raised px-4 py-3 shadow-sm">
        <div role="timer" aria-live="off" aria-label={t.timeLeft} data-exam-timer
          className={`font-display text-2xl tabular-nums ${low ? "text-band-bad" : "text-ink-900"}`}>{formatClock(remaining)}</div>
        <span className="text-sm text-ink-500" data-exam-words>{words} {t.words} · {t.wordsOf.replace("{n}", String(min))}</span>
        <span role="status" className="text-sm text-ink-500" data-exam-save={save}>
          {save === "saving" ? t.saving : save === "saved" ? t.saved : save === "failed" ? t.saveFailed : ""}
        </span>
        {save === "failed" && <button type="button" className="btn-secondary min-h-11" onClick={() => void flush()}>{t.retryNow}</button>}
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary min-h-11" disabled={busy !== null} onClick={() => void finish("abandoned")} data-exam-leave>{t.leave}</button>
          <button type="button" className="btn-primary min-h-11" disabled={busy !== null || frozen} onClick={() => void finish("submitted")} data-exam-submit>{busy === "submit" ? t.saving : t.submit}</button>
        </div>
      </div>

      {notice && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-ink-700 dark:bg-amber-950/30">{notice}</p>}

      {paper.entries.length > 1 && (
        <div role="tablist" aria-label={t.modeLabel.full} className="flex gap-2">
          {paper.entries.map((e) => {
            const w = countEssayWords(entries[e.position]!.text);
            return (
              <button key={e.position} role="tab" type="button" aria-selected={active === e.position} onClick={() => setActive(e.position)}
                className={`min-h-11 rounded-lg border px-4 text-sm ${active === e.position ? "border-signal-600 bg-signal-50 font-semibold text-ink-900 dark:bg-signal-950/30" : "border-ink-100 text-ink-500"}`}
                data-exam-task-tab={e.taskType}>
                {t.modeLabel[e.taskType]} · {w}/{EXAM_MIN_WORDS[e.taskType]}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card flex flex-col gap-3 p-5" aria-labelledby="exam-question">
          <p id="exam-question" className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.question} · {t.modeLabel[current.taskType]}</p>
          <p className="whitespace-pre-line text-base leading-relaxed text-ink-900" data-exam-prompt>{current.prompt}</p>
          <p className="text-sm text-ink-500">{t.minWords} {min} {t.words}</p>
          {materials[current.position]}
        </section>
        <section className="card flex flex-col gap-2 p-5">
          <label htmlFor={`exam-answer-${active}`} className="text-sm font-semibold text-ink-900">{t.yourAnswer}</label>
          <textarea id={`exam-answer-${active}`} key={active} value={state.text} readOnly={frozen}
            onChange={(e) => onChange(active, e.target.value)} spellCheck={false} autoCorrect="off" autoCapitalize="sentences"
            className="input min-h-[24rem] flex-1 resize-y text-base leading-relaxed" data-exam-editor aria-describedby="exam-words-hint" />
          <p id="exam-words-hint" className={`text-sm ${words < min ? "text-ink-500" : "text-band-good"}`}>{words} {t.words} · {t.wordsOf.replace("{n}", String(min))}</p>
        </section>
      </div>
    </div>
  );
}
