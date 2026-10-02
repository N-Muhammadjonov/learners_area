"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function GradeRetryButton({ id, label, busyLabel, failedLabel }: { id: string; label: string; busyLabel: string; failedLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button data-grade-retry disabled={busy} onClick={async () => {
        setBusy(true); setFailed(false);
        try {
          const res = await fetch(`/api/writing/grade/${id}`, { method: "POST" });
          const data = await res.json().catch(() => ({})) as { ok?: boolean };
          if (!data.ok) setFailed(true);
        } catch { setFailed(true); }
        setBusy(false);
        router.refresh();
      }}>{busy ? busyLabel : label}</Button>
      {failed && <span role="alert" className="text-sm text-band-bad">{failedLabel}</span>}
    </div>
  );
}
