"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/http/client-request";
import { publishNotificationCount } from "./NotificationBell";

/** Only rows actually visible in the inbox are automatically acknowledged. */
export function NotificationRead({ ids, label, errorLabel }: { ids: string[]; label: string; errorLabel: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const key = ids.join(",");
  useEffect(() => {
    const unread = new Set(key.split(",").filter(Boolean));
    if (!unread.size) return;
    const queued = new Set<string>();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const send = async () => {
      if (document.visibilityState !== "visible" || !queued.size) return;
      const batch = [...queued];
      queued.clear();
      const result = await requestJson<{ unread: number }>("/api/notifications", { body: { ids: batch } });
      if (stopped) return;
      if (result.ok) {
        publishNotificationCount(result.data.unread);
      } else {
        setError(true);
      }
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.notificationId!;
        if (entry.isIntersecting && unread.has(id)) {
          queued.add(id);
          observer.unobserve(entry.target);
        }
      }
      clearTimeout(timer);
      timer = setTimeout(send, 300);
    }, { threshold: 0.5 });
    document.querySelectorAll<HTMLElement>("[data-notification-id]").forEach((node) => observer.observe(node));
    document.addEventListener("visibilitychange", send);
    return () => { stopped = true; observer.disconnect(); clearTimeout(timer); document.removeEventListener("visibilitychange", send); };
  }, [key]);
  return <div className="flex flex-col items-start gap-2">
    <button type="button" className="btn-secondary" disabled={pending} onClick={async () => {
      setPending(true); setError(false);
      const result = await requestJson<{ unread: number }>("/api/notifications", { body: { all: true } });
      if (result.ok) publishNotificationCount(result.data.unread);
      else setError(true);
      setPending(false);
    }}>{label}</button>
    {error && <p role="alert" className="text-sm text-band-bad">{errorLabel}</p>}
  </div>;
}
