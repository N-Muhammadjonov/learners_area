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
      {/* Fixed position in the React tree: no pending ? frame : children branch. */}
      <div data-workspace-content inert={pending || undefined}>{children}</div>
      {show && (
        <div className="workspace-transition__notice" role="status" aria-live="polite" data-workspace-loading data-navigation-pending>
          <span className="workspace-transition__pulse" aria-hidden="true" />
          <span>{stalled ? slowMessage : frame?.title}</span>
          {stalled && <button type="button" className="btn-secondary" onClick={retryNavigation}>{retryLabel}</button>}
        </div>
      )}
    </div>
  );
}
