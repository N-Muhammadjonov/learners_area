"use client";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartStealingButton({ modelTextId, label, errorLabel }: { modelTextId: string; label: string; errorLabel: string }) {
  const request = useScopedRequest();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const start = async () => {
    setBusy(true); setError(false);
    const res = await request<Record<string, unknown>>("/api/writing/stealing/sessions", {method: "POST", timeoutMs: 25000, body: { modelTextId }}).catch(() => null);
      if (!res) return;
    const data = res?.ok ? ((res.ok ? res.data : null) as { id: string }) : null;
    setBusy(false);
    if (data?.id) router.push(`/writing/language-stealing/${data.id}`); else { setError(true); setBusy(false); }
  };
  return (
    <span className="flex flex-col">
      <button type="button" className="btn-primary min-h-11" disabled={busy} onClick={() => void start()} data-stealing-start={modelTextId}>{label}</button>
      {error && <span role="alert" className="text-xs text-band-bad">{errorLabel}</span>}
    </span>
  );
}
