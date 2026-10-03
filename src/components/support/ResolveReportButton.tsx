"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function ResolveReportButton({ id, label, errorLabel }: { id: string; label: string; errorLabel: string }) {
  const requestResponse = useScopedResponse(25000);

  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function resolve() {
    setError(false); setBusy(true);
    const res = await requestResponse(`/api/support/reports/${id}`, { method: "PATCH" });
    if (!res) return;
    setBusy(false);
    if (res.ok) router.refresh(); else setError(true);
  }

  return (
    <div className="mt-2">
      {error && <p role="alert" className="text-sm text-band-bad">{errorLabel}</p>}
      <Button variant="secondary" disabled={busy} onClick={() => void resolve()} data-report-resolve={id}>
        {label}
      </Button>
    </div>
  );
}
