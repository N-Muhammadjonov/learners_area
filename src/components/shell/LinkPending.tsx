"use client";

import { useLinkStatus } from "next/link";

/** A Link child: follows the actual router transition, including cancellation. */
export function LinkPending({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span role="status" className="ml-auto shrink-0" data-navigation-pending>
      <span aria-hidden className="block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
