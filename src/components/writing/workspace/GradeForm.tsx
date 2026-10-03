"use client";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

import { useEffect, useState, type ReactNode } from "react";
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
type PublishedPrompt = { id: string; category: string; prompt: string };

export function GradeForm({ dict, task1Prompts = [], visuals = {} }: { dict: Dictionary; task1Prompts?: PublishedPrompt[]; visuals?: Record<string, ReactNode> }) {
  const request = useScopedRequest();
  const t = dict.writingWorkspace.grade;
  const gx = dict.writingWorkspace.gradeExtra;
  const [promptId, setPromptId] = useState<string>("");
  const [draftSaved, setDraftSaved] = useState(false);
  const router = useRouter();
  const [task, setTask] = useState<WritingTask>("task2");
  const [question, setQuestion] = useState("");
  const [essay, setEssay] = useState("");
  const [key, setKey] = useState("");
  // Restore the local draft after hydration (server HTML never contains it).
  useEffect(() => {
    try {
      const d = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null") as { task?: WritingTask; question?: string; essay?: string; key?: string; promptId?: string } | null;
      if (!d) return;
      if (typeof d.promptId === "string") setPromptId(d.promptId);
      if (d.task === "task1" || d.task === "task2") setTask(d.task);
      setQuestion(d.question ?? ""); setEssay(d.essay ?? ""); setKey(d.key ?? "");
    } catch { /* unreadable draft: start clean */ }
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const words = countEssayWords(essay);

  const persist = (next: Partial<{ task: WritingTask; question: string; essay: string; key: string; promptId: string }>) => {
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ task, question, essay, key, promptId, ...next })); setDraftSaved(true); } catch { /* storage full or blocked: the form still works */ }
  };
  const usePublished = task === "task1" && Boolean(promptId) && task1Prompts.some((p) => p.id === promptId);
  const choosePrompt = (id: string) => {
    const p = task1Prompts.find((x) => x.id === id);
    setPromptId(id);
    if (p) { setQuestion(p.prompt); persist({ promptId: id, question: p.prompt }); } else persist({ promptId: id });
  };

  async function submit() {
    setError("");
    if (question.trim().length < 10) { setError(t.errors.question); return; }
    if (words < MIN_GRADE_WORDS) { setError(t.errors.tooShort.replace("{n}", String(MIN_GRADE_WORDS))); return; }
    const idem = key || crypto.randomUUID().replace(/-/g, "");
    if (!key) { setKey(idem); persist({ key: idem }); }
    setBusy(true);
    try {
      const res = await request<{id?: string}>("/api/writing/grade", {method: "POST", timeoutMs: 60000, body: { taskType: task, question, essay, idempotencyKey: idem, ...(usePublished ? { promptId } : {}) }});
      if (!res) return;
      const data = res.ok ? res.data : null;
      if (res.ok && data?.id) {
        try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
        router.push(`/writing/grade/${data.id}`);
        return;
      }
      setError(!res.ok && res.error === "too_short" ? t.errors.tooShort.replace("{n}", String(MIN_GRADE_WORDS)) : t.errors.generic);
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
      {task === "task1" && task1Prompts.length > 0 && (
        <fieldset className="flex flex-col gap-2" data-grade-source>
          <legend className="mb-2 text-sm font-semibold text-ink-900">{gx.source}</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!usePublished} onClick={() => { setPromptId(""); persist({ promptId: "" }); }} className={`min-h-11 rounded-md border px-4 text-sm ${!usePublished ? "border-signal-600 bg-signal-50 font-semibold text-ink-900 dark:bg-signal-950/30" : "border-ink-200 text-ink-700"}`}>{gx.ownQuestion}</button>
            <button type="button" aria-pressed={usePublished} onClick={() => choosePrompt(promptId || task1Prompts[0]!.id)} className={`min-h-11 rounded-md border px-4 text-sm ${usePublished ? "border-signal-600 bg-signal-50 font-semibold text-ink-900 dark:bg-signal-950/30" : "border-ink-200 text-ink-700"}`} data-grade-use-published>{gx.published}</button>
          </div>
          {usePublished && (
            <>
              <label className="flex flex-col gap-1 text-sm text-ink-700">{gx.pick}
                <select className="input min-h-11" value={promptId} onChange={(e) => choosePrompt(e.target.value)} data-grade-prompt-select>
                  {task1Prompts.map((p) => <option key={p.id} value={p.id}>{p.category} — {p.prompt.slice(0, 80)}</option>)}
                </select>
              </label>
              <div data-grade-visual>{visuals[promptId]}</div>
              <p className="text-sm text-ink-500">{gx.visualNote}</p>
            </>
          )}
        </fieldset>
      )}
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink-900">{t.step2}</span>
        <textarea className="input min-h-24 text-base" value={question} maxLength={4000} placeholder={t.questionPlaceholder} data-grade-question readOnly={usePublished}
          onChange={(e) => { setQuestion(e.target.value); persist({ question: e.target.value }); }} />
        {task === "task1" && !usePublished && <span className="text-sm text-ink-500">{t.visualLimit}</span>}
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink-900">{t.step3}</span>
        <textarea className="input min-h-80 text-base leading-relaxed" value={essay} maxLength={20000} placeholder={t.essayPlaceholder} data-grade-essay
          onChange={(e) => { setEssay(e.target.value); persist({ essay: e.target.value }); }} />
        <span className={`text-sm ${words >= MIN_WORDS[task] ? "text-band-good" : "text-ink-500"}`} data-grade-words={words}>
          {t.wordCount.replace("{n}", String(words)).replace("{target}", String(MIN_WORDS[task]))}
        </span>
      </label>
      {draftSaved && <p role="status" className="text-sm text-ink-500" data-grade-draft-saved>{gx.draftSaved}</p>}
      {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
      <div><Button onClick={() => void submit()} disabled={busy} data-grade-submit>{busy ? t.grading : t.submit}</Button></div>
    </div>
  );
}
