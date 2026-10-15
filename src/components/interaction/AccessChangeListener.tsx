"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { privateResources } from "@/lib/client/private-resource";
import { isAccountStatus } from "@/lib/auth/account-status";
import { isRole } from "@/lib/auth/roles";

/**
 * Event-driven, no setInterval and no repeated role/identity queries.
 * Server pushes only after an actual owner/admin access mutation commits.
 * A disconnected/reconnected stream rechecks once to avoid stale menus.
 */
export function AccessChangeListener({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const stream = new EventSource("/api/auth/changes", { withCredentials: true });
    let pending = false;
    let closed = false;
    const update = async () => {
      if (closed || pending) return;
      pending = true;
      try {
        const response = await fetch("/api/auth/state", { cache: "no-store", credentials: "same-origin" });
        if (response.status === 401) {
          privateResources.setScope(null);
          window.location.replace("/login");
          return;
        }
        if (!response.ok) return; // never elevate on network failure
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") return;
        const { role, accountStatus } = payload as Record<string, unknown>;
        if (!isRole(role) || !isAccountStatus(accountStatus)) return;
        if (accountStatus !== "active") {
          privateResources.setScope(null);
          window.location.replace("/pending");
          return;
        }
        // Fetch the server-authorized shell and menu once on role change.
        // Existing notes/exam progress are still stored under the same account.
        router.refresh();
      } finally {
        pending = false;
      }
    };
    const unavailable = () => stream.close();
    stream.addEventListener("access-changed", update);
    stream.addEventListener("unavailable", unavailable);
    return () => {
      closed = true;
      stream.removeEventListener("access-changed", update);
      stream.removeEventListener("unavailable", unavailable);
      stream.close();
    };
  }, [enabled, router]);
  return null;
}
