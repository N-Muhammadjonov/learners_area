"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * Assigning follow-up work after reviewing feedback.
 *
 * The writing-prompt link is what decides how the work will later be judged:
 * with a prompt attached, the assignment is delegated to
 * WritingEvaluationService; without one it is a free-form response.
 */
export function NewAssignmentForm({
  dict,
  studentId,
  prompts,
}: {
  dict: Dictionary;
  studentId: string;
  prompts: { id: string; label: string }[];
}) {
  const t = dict.teacher;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [promptId, setPromptId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || null,
        targetUserId: studentId,
        relatedWritingPromptId: promptId || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(String(data.error ?? t.assignmentFailed));
      return;
    }
    setSaved(true);
    setTitle("");
    setDescription("");
    setPromptId("");
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t.newAssignment}
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm font-medium text-ink-900">{t.newAssignment}</p>

      <label htmlFor="assignment-title" className="text-sm text-ink-700">
        {t.assignmentTitle}
      </label>
      <input
        id="assignment-title"
        className="input"
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
      />

      <label htmlFor="assignment-description" className="text-sm text-ink-700">
        {t.assignmentDescription}
      </label>
      <textarea
        id="assignment-description"
        className="input min-h-[80px]"
        value={description}
        disabled={busy}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label htmlFor="assignment-prompt" className="text-sm text-ink-700">
        {t.assignmentPrompt}
      </label>
      <select
        id="assignment-prompt"
        className="input"
        value={promptId}
        disabled={busy}
        onChange={(e) => setPromptId(e.target.value)}
      >
        <option value="">{t.assignmentNoPrompt}</option>
        {prompts.map((prompt) => (
          <option key={prompt.id} value={prompt.id}>
            {prompt.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-ink-300">{t.assignmentPromptHint}</p>

      {error && <p className="text-xs text-band-bad">{error}</p>}
      {saved && <p className="text-xs text-band-good">{t.assignmentCreated}</p>}

      <div className="flex gap-2">
        <Button disabled={busy || title.trim().length < 3} onClick={() => void submit()}>
          {busy ? dict.common.saving : dict.common.save}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          {dict.common.cancel}
        </Button>
      </div>
    </Card>
  );
}
