"use client";
import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { objectiveExplanationSchema, type ObjectiveExplanation as Explanation } from "@/lib/services/riwi/objective-explanation-schema";

export function ObjectiveExplanation({ domain, attemptId, questionId, dict }: {
  domain: "reading" | "listening"; attemptId: string; questionId: string; dict: Dictionary;
}) {
  const copy = dict.objectiveExplanation;
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Explanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setResult(null); setError(null); setBusy(false);
    return () => { request.current?.abort(); request.current = null; };
  }, [domain, attemptId, questionId]);
  async function load() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setResult(null); setError(null);
    try {
      const response = await fetch("/api/riwi/objective-explanation", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ domain, attemptId, questionId }),
      });
      const body: unknown = await response.json();
      if (controller.signal.aborted || request.current !== controller) return;
      const parsed = objectiveExplanationSchema.safeParse(body);
      if (!response.ok || !parsed.success || parsed.data.attemptId !== attemptId || parsed.data.questionId !== questionId || parsed.data.domain !== domain) {
        const code = body && typeof body === "object" && "error" in body ? body.error : null;
        setError(code === "locked" ? copy.locked : code === "source_changed" ? copy.changed : copy.unavailable);
      } else setResult(parsed.data);
    } catch {
      if (!controller.signal.aborted && request.current === controller) setError(copy.unavailable);
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  return <div className="mt-3 flex flex-col gap-2" data-objective-explanation>
    <button type="button" className="btn-secondary self-start" disabled={busy} onClick={() => void load()}>{busy ? copy.loading : copy.load}</button>
    <div aria-live="polite">
      {error && <p className="text-sm text-ink-500">{error}</p>}
      {result && <div className="flex flex-col gap-2 text-sm text-ink-700">
        <p className="text-xs text-ink-500">{copy.authored}</p>
        {result.explanation && <p className="whitespace-pre-wrap">{result.explanation}</p>}
        {result.evidence && <blockquote className="border-l-2 border-ink-200 pl-3"><span className="text-xs text-ink-500">{copy.evidence}</span><p>{result.evidence}</p></blockquote>}
        {result.status === "insufficient_evidence" && <p>{copy.missing}</p>}
      </div>}
    </div>
  </div>;
}
