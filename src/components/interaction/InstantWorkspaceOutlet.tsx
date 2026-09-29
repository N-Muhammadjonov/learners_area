"use client";

import type { ReactNode } from "react";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import { SectionEntryFrame } from "@/components/interaction/SectionEntryFrame";

/** Preserve the authenticated shell and reveal destination identity before RSC commits. */
export function InstantWorkspaceOutlet({ children }: { children: ReactNode }) {
  const { navigation, currentLocation, stalled, retryNavigation, entryFrames, slowMessage, retryLabel } = useInstantInteraction();
  const pending = Boolean(navigation && currentLocation === navigation.from);

  if (!pending || !navigation) return children;

  const frame = entryFrames[navigation.routeKey] ?? entryFrames.other;
  if (!frame) return children;

  return (
    <SectionEntryFrame
      routeKey={navigation.routeKey}
      frame={frame}
      stalled={stalled}
      slowMessage={slowMessage}
      retryLabel={retryLabel}
      onRetry={retryNavigation}
    />
  );
}
