"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExamMode } from "@/lib/writing/exam-modes";

/** Starts (or resumes) a paper. The server decides the deadline; we send only the mode. */
export function StartExamButton({ mode, label, busyLabel, errorLabel, otherOpenLabel, disabled }: {
  mode: ExamMode; label: string; busyLabel: string; errorLabel: string; otherOpenLabel: string; disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/writing/exam", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: { code?: string } } | null;
      if (res.ok && data?.id) { router.push(`/writing/exam/${data.id}`); return; }
      setError(data?.error?.code === "other_paper_open" ? otherOpenLabel : errorLabel);
    } catch { setError(errorLabel); }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className="btn-primary min-h-11" disabled={disabled || busy} onClick={() => void start()} data-exam-start={mode}>{busy ? busyLabel : label}</button>
      {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
    </div>
  );
}
