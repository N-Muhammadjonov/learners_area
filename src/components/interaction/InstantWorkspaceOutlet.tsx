"use client";

import { type ReactNode } from "react";
import { SectionEntryFrame } from "@/components/interaction/SectionEntryFrame";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";

/** Keep the CURRENT subtree mounted until Next commits the authorized destination.
 * This is not a keep-alive cache: outgoing content is discarded at route commit.
 * Never save RSC nodes, attempt payloads, or Retention text in a route registry.
 */
export function InstantWorkspaceOutlet({ children }: { children: ReactNode }) {
  const { navigation, currentLocation, stalled, retryNavigation, entryFrames, slowMessage, retryLabel } = useInstantInteraction();
  const pending = Boolean(navigation && currentLocation === navigation.from);
  // Render a safe, localized destination frame on the FIRST navigation paint.
  // The old page stays mounted for cancellation/back behaviour but is not shown
  // or interactive while a new authorized RSC response is being requested.
  // This reduces perceived click latency; it does NOT pretend DB reads finished.
  const frame = navigation ? entryFrames[navigation.routeKey] ?? entryFrames.other : undefined;
  const show = Boolean(pending && navigation && frame);
  return (
    <div className="workspace-transition" aria-busy={pending} data-workspace-transition>
      {/* Fixed position in the React tree: no pending ? frame : children branch. */}
      <div hidden={pending || undefined} data-outgoing-workspace>
        <div data-workspace-content inert={pending || undefined}>{children}</div>
      </div>
      {show && navigation && frame && (
        <SectionEntryFrame routeKey={navigation.routeKey} frame={frame} privateBoundary />
      )}
      {stalled && (
        <div className="workspace-transition__notice" role="status" aria-live="polite" data-workspace-loading data-navigation-pending>
          <span className="workspace-transition__pulse" aria-hidden="true" />
          <span>{slowMessage}</span>
          <button type="button" className="btn-secondary" onClick={retryNavigation}>{retryLabel}</button>
        </div>
      )}
    </div>
  );
}
