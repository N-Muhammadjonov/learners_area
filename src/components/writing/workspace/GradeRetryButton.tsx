"use client";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function GradeRetryButton({ id, label, busyLabel, failedLabel }: { id: string; label: string; busyLabel: string; failedLabel: string }) {
  const request = useScopedRequest();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button data-grade-retry disabled={busy} onClick={async () => {
        setBusy(true); setFailed(false);
        try {
          const res = await request<{ok?: boolean}>(`/api/writing/grade/${id}`, {method: "POST", timeoutMs: 60000});
      if (!res) return;
          const data = res.ok ? res.data : null;
          if (!res.ok || !data?.ok) setFailed(true);
        } catch { setFailed(true); }
        setBusy(false);
        router.refresh();
      }}>{busy ? busyLabel : label}</Button>
      {failed && <span role="alert" className="text-sm text-band-bad">{failedLabel}</span>}
    </div>
  );
}
