"use client";

import { useEffect } from "react";

/** A visible, connected private tab counts as online, even without navigation. */
export function OnlineActivity() {
  useEffect(() => {
    let pending: AbortController | null = null;
    let deadline: number | null = null;
    const touch = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || pending) return;
      const controller = new AbortController();
      pending = controller;
      const requestDeadline = window.setTimeout(() => {
        if (pending === controller) { pending = null; deadline = null; }
        controller.abort();
      }, 15_000);
      deadline = requestDeadline;
      void fetch("/api/riwi/presence", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal })
        .catch(() => {})
        .finally(() => {
          window.clearTimeout(requestDeadline);
          if (pending === controller) { pending = null; deadline = null; }
        });
    };
    touch();
    const timer = window.setInterval(touch, 60_000);
    document.addEventListener("visibilitychange", touch);
    window.addEventListener("online", touch);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", touch);
      window.removeEventListener("online", touch);
      if (deadline !== null) window.clearTimeout(deadline);
      pending?.abort();
    };
  }, []);
  return null;
}
