"use client";

import Link from "next/link";
import { LinkPending } from "./LinkPending";
import { useEffect, useState } from "react";
import { IconBell } from "@/components/ui/icons";
import { requestJson } from "@/lib/http/client-request";

export const NOTIFICATIONS_CHANGED = "learners-area:notifications-changed";

export function publishNotificationCount(unread: number) {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED, { detail: unread }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(NOTIFICATIONS_CHANGED);
    channel.postMessage("refresh");
    channel.close();
  }
}

export function NotificationBell({ initialCount, label, loadingLabel }: { initialCount: number; label: string; loadingLabel: string }) {
  const [count, setCount] = useState(initialCount);
  useEffect(() => setCount(initialCount), [initialCount]);
  useEffect(() => {
    let controller: AbortController | undefined;
    let revision = 0;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const current = ++revision;
      controller?.abort();
      controller = new AbortController();
      const result = await requestJson<{ unread: number }>("/api/notifications?count=1", { method: "GET", signal: controller.signal });
      if (current === revision && result.ok) setCount(result.data.unread);
    };
    const changed = (event: Event) => {
      revision++;
      controller?.abort();
      setCount((event as CustomEvent<number>).detail);
    };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(NOTIFICATIONS_CHANGED) : null;
    if (channel) channel.onmessage = refresh;
    window.addEventListener(NOTIFICATIONS_CHANGED, changed);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      revision++;
      controller?.abort();
      channel?.close();
      window.removeEventListener(NOTIFICATIONS_CHANGED, changed);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <Link href="/notifications" aria-label={`${label} (${count})`} className="relative flex shrink-0 items-center justify-center rounded-[10px] border border-ink-100 text-ink-500 hover:bg-paper-sunken hover:text-ink-900" style={{ width: "var(--icon-btn)", height: "var(--icon-btn)" }}>
      <IconBell />
      <span className="absolute bottom-0 right-0 rounded-full bg-paper-raised"><LinkPending label={loadingLabel} /></span>
      {count > 0 && <span data-unread-count={count} className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-600 px-1 text-[0.6875rem] font-medium text-signal-contrast">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}
