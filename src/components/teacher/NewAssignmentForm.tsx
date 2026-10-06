"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Dictionary } from "@/lib/i18n/en";
import { apiErrorMessage } from "@/lib/api-error-message";

/**
 * Assigning follow-up work to one student.
 *
 * Canonical content is the PRIMARY path: the picker is fed by
 * `/api/assignments/assignable`, which offers only content a learner could actually
 * open, and the choice is sent as (module, contentType, sourceRef, contentVersionId)
 * — the exact revision the service will pin (§24/§41). If canonical content is
 * chosen, the writing-prompt link is not sent at all, because the canonical
 * reference is what decides how the work is judged.
 *
 * The writing-prompt link stays as a COMPATIBILITY path for free-form follow-up:
 * with a prompt attached the assignment is delegated to WritingEvaluationService;
 * without one it is evaluated as a free-form response and never given a band.
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
  const requestResponse = useScopedResponse(25000);

  const t = dict.teacher;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [promptId, setPromptId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [contentKey, setContentKey] = useState("");
  const [items, setItems] = useState<AssignableItem[] | null>(null);
  const [contentFailed, setContentFailed] = useState(false);

  type AssignableItem = {
    module: string;
    contentType: string;
    sourceRef: string;
    title: string;
    versionId: string;
  };

  // Loaded when the form is opened, once: the list is what the service would pin,
  // so the teacher never picks something the learner could not open.
  useEffect(() => {
    if (!open || items !== null) return;
    let live = true;
    void fetch("/api/assignments/assignable", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("unavailable"))))
      .then((data: { items?: AssignableItem[] }) => {
        if (live) setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (live) {
          setItems([]);
          setContentFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [open, items]);

  const chosen = useMemo(
    () => (items ?? []).find((item) => `${item.module}:${item.contentType}:${item.sourceRef}` === contentKey) ?? null,
    [items, contentKey],
  );

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await requestResponse("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || null,
        targetUserId: studentId,
        // Canonical content wins: when one is chosen the legacy prompt link is not sent.
        ...(chosen
          ? {
              module: chosen.module,
              contentType: chosen.contentType,
              sourceRef: chosen.sourceRef,
              contentVersionId: chosen.versionId,
            }
          : { relatedWritingPromptId: promptId || null }),
      }),
    });
    if (!res) return;
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(apiErrorMessage(data.error, res.status, dict));
      return;
    }
    setSaved(true);
    setTitle("");
    setDescription("");
    setPromptId("");
    setContentKey("");
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

      <label htmlFor="assignment-content" className="text-sm text-ink-700">
        {t.assignmentCanonical}
      </label>
      <select
        id="assignment-content"
        className="input"
        data-assignment-content-select
        value={contentKey}
        disabled={busy || items === null}
        onChange={(e) => setContentKey(e.target.value)}
      >
        <option value="">{t.assignmentNoCanonical}</option>
        {(items ?? []).map((item) => (
          <option key={`${item.module}:${item.contentType}:${item.sourceRef}`} value={`${item.module}:${item.contentType}:${item.sourceRef}`}>
            {`${item.title} · ${item.module}/${item.contentType}`}
          </option>
        ))}
      </select>
      <p className="text-xs text-ink-300" data-assignment-content-hint>
        {items === null ? t.assignmentLoadingContent : items.length === 0 ? t.assignmentNoContent : t.assignmentCanonicalHint}
      </p>
      {contentFailed && <p className="text-xs text-ink-300" data-assignment-content-unavailable>{dict.common.error}</p>}

      {chosen && (
        <p className="text-xs text-ink-500" data-assignment-pinned-revision>
          {`${chosen.sourceRef} · ${chosen.versionId.slice(0, 8)}`}
        </p>
      )}

      <label htmlFor="assignment-prompt" className="text-sm text-ink-700">
        {t.assignmentPrompt}
      </label>
      <select
        id="assignment-prompt"
        className="input"
        value={promptId}
        disabled={busy || Boolean(chosen)}
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
