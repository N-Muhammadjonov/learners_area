"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** Retry the current RSC data region without leaving or remounting the shell. */
export function RegionRetryButton({ label, region }: { label: string; region: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn-secondary shrink-0"
      disabled={pending}
      aria-busy={pending || undefined}
      data-region-retry={region}
      onClick={() => {
        if (pending) return;
        startTransition(() => router.refresh());
      }}
    >
      {label}
    </button>
  );
}
