"use client";

import { useEffect, useState } from "react";
import { useLinkStatus } from "next/link";
import { NAVIGATION_FEEDBACK_DELAY_MS } from "@/lib/nav/progress";

/** A Link child: follows the actual router transition, including cancellation. */
export function LinkPending({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  const [visible, setVisible] = useState(false);

  // Fast transitions should feel instant; only sustained waits earn feedback.
  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return;
    }
    const timeout = setTimeout(() => setVisible(true), NAVIGATION_FEEDBACK_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [pending]);

  if (!pending || !visible) return null;
  return (
    <span role="status" className="ml-auto shrink-0" data-navigation-pending>
      <span aria-hidden className="block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
