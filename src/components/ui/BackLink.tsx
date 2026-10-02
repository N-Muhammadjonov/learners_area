"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { shouldUseHistory } from "@/lib/navigation/back";

/**
 * The one Back control for nested routes.
 *
 * It is a real link to `fallbackHref` (works without JS, in a new tab and for
 * a deep link opened cold). When the user arrived from another page of this
 * site, a plain click goes back in history instead, so filters and scroll on
 * the previous page survive. Modified clicks keep normal link behaviour.
 */
export function BackLink({ fallbackHref, label, className }: { fallbackHref: string; label: string; className?: string }) {
  const router = useRouter();
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!shouldUseHistory(document.referrer, window.location.origin, window.history.length)) return;
    event.preventDefault();
    router.back();
  }
  return (
    <Link
      href={fallbackHref}
      onClick={onClick}
      className={className ?? "btn-ghost inline-flex min-h-11 w-fit items-center gap-1"}
      data-back-link
    >
      <span aria-hidden>←</span>
      {label}
    </Link>
  );
}
