"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { privateResources } from "@/lib/client/private-resource";
import { isAccountStatus } from "@/lib/auth/account-status";
import { isRole, type Role } from "@/lib/auth/roles";

/**
 * Event-driven with no periodic timers or repeated role/identity queries.
 * Server pushes an initial reconciliation after LISTEN is ready, then only
 * committed authority changes. An unchanged check never refreshes the shell.
 * A disconnected/reconnected stream rechecks once to avoid stale menus.
 */
export function AccessChangeListener({ enabled, role, expiresAt }: { enabled: boolean; role?: Role; expiresAt?: number }) {
  const router = useRouter();
  useEffect(() => {
    let stream: EventSource | null = null;
    let pending = false;
    let queued = false;
    let closed = false;
    let request: AbortController | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let currentRole = role;
    const initialScope = privateResources.scope;
    const logout = () => {
      if (closed || privateResources.scope !== initialScope) return;
      privateResources.setScope(null);
      stream?.close();
      window.location.replace("/login");
    };
    const scheduleExpiry = (seconds: number | undefined) => {
      if (expiryTimer) clearTimeout(expiryTimer);
      if (!seconds || !Number.isSafeInteger(seconds)) return;
      const remaining = seconds * 1000 - Date.now();
      if (remaining <= 0) { logout(); return; }
      // Browser timers cap at ~24 days; a 30-day session uses one bounded rearm.
      expiryTimer = setTimeout(() => scheduleExpiry(seconds), Math.min(remaining, 2_147_000_000));
    };
    const update = async () => {
      if (closed || privateResources.scope !== initialScope) return;
      if (pending) { queued = true; return; }
      pending = true;
      request = new AbortController();
      const deadline = setTimeout(() => request?.abort(), 8000);
      try {
        const response = await fetch("/api/auth/state", { cache: "no-store", credentials: "same-origin", signal: request.signal });
        if (closed || privateResources.scope !== initialScope) return;
        if (response.status === 401) {
          logout();
          return;
        }
        if (!response.ok) return; // never elevate on network failure
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") return;
        const { role: nextRole, accountStatus, expiresAt: nextExpiry } = payload as Record<string, unknown>;
        if (closed || privateResources.scope !== initialScope || !isRole(nextRole) || !isAccountStatus(accountStatus)) return;
        if (accountStatus !== "active") {
          logout();
          return;
        }
        if (typeof nextExpiry === "number") scheduleExpiry(nextExpiry);
        // An unchanged reconnect needs no second identity round trip/render.
        if (currentRole !== undefined && currentRole !== nextRole) {
          privateResources.clear("authority-change");
          router.refresh();
        }
        currentRole = nextRole;
      } catch {
        // A transient network error must not grant access or kill EventSource.
        // Authoritative server API/page gates remain active.
      } finally {
        clearTimeout(deadline);
        pending = false;
        request = null;
        if (queued && !closed) { queued = false; void update(); }
      }
    };
    // A sleeping laptop can miss a role downgrade. If the connection drops,
    // check ONCE, then wait for the next successful connection instead of
    // hammering PostgreSQL on the browser's automatic SSE retry timer.
    let checkedThisDisconnect = false;
    let hasOpened = false;
    const opened = () => {
      checkedThisDisconnect = false;
      if (hasOpened) void update();
      hasOpened = true;
    };
    const failed = () => {
      if (checkedThisDisconnect) return;
      checkedThisDisconnect = true;
      void update();
    };
    const unavailable = () => { stream?.close(); stream = null; void update(); };
    const connect = () => {
      if (!enabled || stream || typeof EventSource === "undefined" || closed || privateResources.scope !== initialScope) return;
      stream = new EventSource("/api/auth/changes", { withCredentials: true });
      stream.addEventListener("access-changed", update);
      stream.addEventListener("open", opened);
      stream.addEventListener("error", failed);
      stream.addEventListener("unavailable", unavailable);
    };
    const reconcile = () => { connect(); void update(); };
    const visible = () => { if (document.visibilityState === "visible") reconcile(); };
    scheduleExpiry(expiresAt);
    connect();
    window.addEventListener("online", reconcile);
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", visible);
    return () => {
      closed = true;
      request?.abort();
      if (expiryTimer) clearTimeout(expiryTimer);
      window.removeEventListener("online", reconcile);
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", visible);
      stream?.removeEventListener("access-changed", update);
      stream?.removeEventListener("open", opened);
      stream?.removeEventListener("error", failed);
      stream?.removeEventListener("unavailable", unavailable);
      stream?.close();
    };
  }, [enabled, role, expiresAt, router]);
  return null;
}
