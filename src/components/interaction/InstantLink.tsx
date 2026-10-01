"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";
import { eligibleIntentTarget, IntentPrefetchBudget } from "@/lib/interaction/intent-prefetch";
const budget = new IntentPrefetchBudget();
type ConnectionHint = { saveData?: boolean; effectiveType?: string };
type Props = ComponentProps<typeof Link> & { intentPrefetch?: boolean };
export function InstantLink({ intentPrefetch = false, prefetch, onMouseEnter, onMouseLeave, onFocus, onBlur, ...props }: Props) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancel() { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } }
  useEffect(() => cancel, [props.href]);
  function prepare() {
    cancel();
    if (!intentPrefetch || prefetch === false || typeof props.href !== "string" || props.download || (props.target && props.target !== "_self")) return;
    if (!navigator.onLine || document.visibilityState !== "visible") return;
    const hint = (navigator as Navigator & { connection?: ConnectionHint }).connection;
    if (hint?.saveData || hint?.effectiveType === "2g" || hint?.effectiveType === "slow-2g") return;
    const target = eligibleIntentTarget(props.href, window.location.origin, window.location.href);
    if (!target) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      if (!budget.take(target, Date.now())) return;
      // Next 15 API; no fictional completion/concurrency callback.
      try { router.prefetch(target); } catch { /* Navigation still works normally. */ }
    }, 90);
  }
  return <Link {...props} prefetch={prefetch ?? false} data-instant-navigation
    onMouseEnter={(event) => { onMouseEnter?.(event); if (!event.defaultPrevented) prepare(); }}
    onMouseLeave={(event) => { onMouseLeave?.(event); cancel(); }}
    onFocus={(event) => { onFocus?.(event); if (!event.defaultPrevented) prepare(); }}
    onBlur={(event) => { onBlur?.(event); cancel(); }} />;
}
