"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartStealingButton({ modelTextId, label, errorLabel }: { modelTextId: string; label: string; errorLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const start = async () => {
    setBusy(true); setError(false);
    const res = await fetch("/api/writing/stealing/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelTextId }) }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { id: string }) : null;
    if (data) router.push(`/writing/language-stealing/${data.id}`); else { setError(true); setBusy(false); }
  };
  return (
    <span className="flex flex-col">
      <button type="button" className="btn-primary min-h-11" disabled={busy} onClick={() => void start()} data-stealing-start={modelTextId}>{label}</button>
      {error && <span role="alert" className="text-xs text-band-bad">{errorLabel}</span>}
    </span>
  );
}
