"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { countWords } from "@/lib/services/writing-evaluation/heuristics";
import type { Dictionary } from "@/lib/i18n/en";
import { apiErrorMessage } from "@/lib/api-error-message";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

export function Editor({
  dict,
  submissionId,
  initialContent,
  targetWordCount,
}: {
  dict: Dictionary;
  submissionId: string;
  initialContent: string;
  targetWordCount: number;
}) {
  const router = useRouter();
  const saveRequest = useScopedRequest();
  const submitRequest = useScopedRequest();
  const [content, setContent] = useState(initialContent);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaveState("idle");
    timer.current = setTimeout(async () => {
      setSaveState("saving");
      const res = await saveRequest(`/api/writing/submissions/${submissionId}`, {method: "PATCH", body: {content}});
      if (!res) return;
      setSaveState(res.ok ? "saved" : "idle");
      if (!res.ok) setError(apiErrorMessage(res.error, res.status, dict));
    }, 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const wordCount = countWords(content);

  async function onSubmit() {
    if (submitting) return;
    if (!confirm(dict.writing.submitConfirm)) return;
    if (timer.current) clearTimeout(timer.current);
    setSubmitting(true);
    setError("");
    // Flush the latest content before submitting.
    const saved = await saveRequest(`/api/writing/submissions/${submissionId}`, {method: "PATCH", body: {content}});
    if (!saved) return;
    if (!saved.ok) {setSubmitting(false); setError(apiErrorMessage(saved.error, saved.status, dict)); return;}
    const res = await submitRequest(`/api/writing/submissions/${submissionId}/submit`, {timeoutMs: 60_000});
    if (!res) return;
    setSubmitting(false);
    if (!res.ok) {
      setError(apiErrorMessage(res.error, res.status, dict, { too_short: dict.writing.tooShortSubmit }));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea disabled={submitting} value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[360px]" />
      <div className="flex items-center justify-between text-xs text-ink-300">
        <span>
          {dict.writing.wordCount}: {wordCount} / {targetWordCount}
          {"  ·  "}
          {saveState === "saving" ? dict.common.saving : saveState === "saved" ? dict.common.saved : ""}
        </span>
      </div>
      {error && <p className="text-sm text-band-bad">{error}</p>}
      <div>
        <Button onClick={onSubmit} disabled={submitting || wordCount < 20}>
          {submitting ? dict.common.loading : dict.writing.submit}
        </Button>
      </div>
    </div>
  );
}
