"use client";

import type { ReactNode } from "react";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";

type WorkspaceLabels = {
  opening: string;
  slow: string;
  retry: string;
  destinations: Record<string, string>;
};

/** Replaces only the workspace outlet while keeping the authenticated shell mounted. */
export function InstantWorkspaceOutlet({
  children,
  labels,
}: {
  children: ReactNode;
  labels: WorkspaceLabels;
}) {
  const { navigation, currentLocation, stalled, retryNavigation } = useInstantInteraction();
  const pending = Boolean(navigation && currentLocation === navigation.from);

  if (!pending || !navigation) return children;

  const destination = labels.destinations[navigation.routeKey] ?? labels.destinations.other ?? labels.opening;
  return (
    <section
      className="workspace-route-feedback"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
      data-route-loading
      data-workspace-loading
    >
      <h1 className="workspace-route-feedback__title" tabIndex={-1}>{destination}</h1>
      <p className="workspace-route-feedback__copy">{labels.opening}</p>
      <div className="workspace-route-feedback__skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {stalled ? (
        <div className="workspace-route-feedback__error" role="alert" data-app-error>
          <p>{labels.slow}</p>
          <button type="button" className="btn-secondary" onClick={retryNavigation}>
            {labels.retry}
          </button>
        </div>
      ) : null}
    </section>
  );
}
