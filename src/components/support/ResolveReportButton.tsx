"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function ResolveReportButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    const res = await fetch(`/api/support/reports/${id}`, { method: "PATCH" });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="mt-2">
      <Button variant="secondary" disabled={busy} onClick={() => void resolve()} data-report-resolve={id}>
        {label}
      </Button>
    </div>
  );
}
