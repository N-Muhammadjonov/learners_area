"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { countEssayWords, MIN_GRADE_WORDS, MIN_WORDS, type WritingTask } from "@/lib/writing/grade-criteria";
import type { Dictionary } from "@/lib/i18n/en";

const DRAFT_KEY = "la-writing-grade-draft";

/**
 * Grade My Work input (W6). One POST per click; the idempotency key is kept
 * for this draft, so a learner-initiated resend can never create a second
 * request or a second provider call. The draft survives a reload locally.
 */
export function GradeForm({ dict }: { dict: Dictionary }) {
  const t = dict.writingWorkspace.grade;
  const router = useRouter();
  const [task, setTask] = useState<WritingTask>("task2");
  const [question, setQuestion] = useState("");
  const [essay, setEssay] = useState("");
  const [key, setKey] = useState("");
  // Restore the local draft after hydration (server HTML never contains it).
  useEffect(() => {
    try {
      const d = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null") as { task?: WritingTask; question?: string; essay?: string; key?: string } | null;
      if (!d) return;
      if (d.task === "task1" || d.task === "task2") setTask(d.task);
      setQuestion(d.question ?? ""); setEssay(d.essay ?? ""); setKey(d.key ?? "");
    } catch { /* unreadable draft: start clean */ }
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const words = countEssayWords(essay);

  const persist = (next: Partial<{ task: WritingTask; question: string; essay: string; key: string }>) => {
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ task, question, essay, key, ...next })); } catch { /* storage full or blocked: the form still works */ }
  };

  async function submit() {
    setError("");
    if (question.trim().length < 10) { setError(t.errors.question); return; }
    if (words < MIN_GRADE_WORDS) { setError(t.errors.tooShort.replace("{n}", String(MIN_GRADE_WORDS))); return; }
    const idem = key || crypto.randomUUID().replace(/-/g, "");
    if (!key) { setKey(idem); persist({ key: idem }); }
    setBusy(true);
    try {
      const res = await fetch("/api/writing/grade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskType: task, question, essay, idempotencyKey: idem }) });
      const data = await res.json().catch(() => ({})) as { id?: string; error?: { code?: string } };
      if (data.id) {
        try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
        router.push(`/writing/grade/${data.id}`);
        return;
      }
      setError(data.error?.code === "too_short" ? t.errors.tooShort.replace("{n}", String(MIN_GRADE_WORDS)) : t.errors.generic);
    } catch {
      // Not retried automatically: the essay is saved on the server if the request arrived — check My essays.
      setError(t.errors.network);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-5" data-grade-form>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-ink-900">{t.step1}</legend>
        <div className="flex flex-wrap gap-2">
          {(["task1", "task2"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={task === k} data-grade-task={k} onClick={() => { setTask(k); persist({ task: k }); }}
              className={`min-h-11 rounded-md border px-4 text-sm font-medium ${task === k ? "border-signal-600 bg-signal-600 text-signal-contrast" : "border-ink-200 text-ink-700 hover:bg-paper-sunken"}`}>
              {t.task[k].replace("{n}", String(MIN_WORDS[k]))}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink-900">{t.step2}</span>
        <textarea className="input min-h-24 text-base" value={question} maxLength={4000} placeholder={t.questionPlaceholder} data-grade-question
          onChange={(e) => { setQuestion(e.target.value); persist({ question: e.target.value }); }} />
        {task === "task1" && <span className="text-sm text-ink-500">{t.visualLimit}</span>}
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink-900">{t.step3}</span>
        <textarea className="input min-h-80 text-base leading-relaxed" value={essay} maxLength={20000} placeholder={t.essayPlaceholder} data-grade-essay
          onChange={(e) => { setEssay(e.target.value); persist({ essay: e.target.value }); }} />
        <span className={`text-sm ${words >= MIN_WORDS[task] ? "text-band-good" : "text-ink-500"}`} data-grade-words={words}>
          {t.wordCount.replace("{n}", String(words)).replace("{target}", String(MIN_WORDS[task]))}
        </span>
      </label>
      {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
      <div><Button onClick={() => void submit()} disabled={busy} data-grade-submit>{busy ? t.grading : t.submit}</Button></div>
    </div>
  );
}
