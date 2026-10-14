"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";

/** Keep the CURRENT subtree mounted until Next commits the authorized destination.
 * This is not a keep-alive cache: outgoing content is discarded at route commit.
 * Never save RSC nodes, attempt payloads, or Retention text in a route registry.
 */
export function InstantWorkspaceOutlet({ children }: { children: ReactNode }) {
  const { navigation, currentLocation, stalled, retryNavigation, entryFrames, slowMessage, retryLabel } = useInstantInteraction();
  const pending = Boolean(navigation && currentLocation === navigation.from);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  useEffect(() => {
    if (!pending || !navigation) { setVisibleId(null); return; }
    const timer = window.setTimeout(() => setVisibleId(navigation.id), 120);
    return () => window.clearTimeout(timer);
  }, [navigation, pending]);
  const show = pending && navigation && (visibleId === navigation.id || stalled);
  const frame = navigation ? entryFrames[navigation.routeKey] ?? entryFrames.other : undefined;
  return (
    <div className="workspace-transition" aria-busy={pending} data-workspace-transition>
      {/* Keep pending feedback in the content flow rather than a fixed bottom-right
          bubble covering practice buttons. It must never trigger extra requests. */}
      {show && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-ink-100 bg-paper-raised px-3 py-2 text-xs text-ink-500" role="status" aria-live="polite" data-workspace-loading data-navigation-pending>
          <span className="workspace-transition__pulse" aria-hidden="true" />
          <span>{stalled ? slowMessage : frame?.title}</span>
          {stalled && <button type="button" className="btn-secondary" onClick={retryNavigation}>{retryLabel}</button>}
        </div>
      )}
      {/* Preserve the outgoing route until the real authorized destination commits. */}
      <div data-workspace-content inert={pending || undefined}>{children}</div>
    </div>
  );
}
