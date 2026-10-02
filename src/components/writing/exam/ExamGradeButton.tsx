"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Send one finished exam answer to Grade My Work (external AI only). The
 * idempotency key is derived from paper + position on the server side of the
 * contract, so pressing twice never creates a second grade or provider call.
 */
export function ExamGradeButton({ taskType, question, essay, idempotencyKey, labels }: {
  taskType: "task1" | "task2"; question: string; essay: string; idempotencyKey: string;
  labels: { grade: string; grading: string; failed: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const run = async () => {
    setBusy(true); setError(false);
    try {
      const res = await fetch("/api/writing/grade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskType, question, essay, idempotencyKey }) });
      const data = (await res.json().catch(() => null)) as { id?: string; ok?: boolean } | null;
      if (data?.id) { router.push(`/writing/grade/${data.id}`); return; }
      setError(true);
    } catch { setError(true); }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className="btn-primary min-h-11" disabled={busy} onClick={() => void run()} data-exam-grade>{busy ? labels.grading : labels.grade}</button>
      {error && <p role="alert" className="text-sm text-band-bad">{labels.failed}</p>}
    </div>
  );
}
