"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  eligibleIntentTarget,
  IDLE_SHELL_PREFETCH_ROUTES,
  sharedIntentPrefetchBudget,
} from "@/lib/interaction/intent-prefetch";

/**
 * A tiny, bounded prewarm of the canonical learning doorways.
 *
 * Mounted ONLY below the DB-verified /app access gate. Next owns the private,
 * transient router prefetch cache; no user, answer or exam data is persisted.
 * Avoid network contention with the initial dashboard and respect Save-Data,
 * slow connections, offline and background tabs. Never prefetch arbitrary ids.
 */
export function IdleShellPrefetch() {
  const router = useRouter();
  useEffect(() => {
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (!navigator.onLine || connection?.saveData ||
      connection?.effectiveType === "2g" || connection?.effectiveType === "slow-2g") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let index = 0;
    const warmNext = () => {
      if (cancelled || !navigator.onLine || document.visibilityState !== "visible") return;
      const href = IDLE_SHELL_PREFETCH_ROUTES[index++];
      if (!href) return;
      const target = eligibleIntentTarget(href, window.location.origin, window.location.href);
      if (target && sharedIntentPrefetchBudget.take(target, Date.now())) {
        try { router.prefetch(target); } catch { /* Never block real navigation. */ }
      }
      if (index < IDLE_SHELL_PREFETCH_ROUTES.length) timer = setTimeout(warmNext, 1100);
    };
    // Yield to user interactions, hydration and the first authorized page query.
    timer = setTimeout(warmNext, 2500);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [router]);
  return null;
}
