"use client";

import { usePathname } from "next/navigation";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import { SectionEntryFrame } from "@/components/interaction/SectionEntryFrame";
import { workspaceKey } from "@/lib/interaction/navigation";

/** Synchronous, data-free, route-aware fallback for cold loads and route commits. */
export function RouteEntryLoading() {
  const pathname = usePathname() ?? "/";
  const { entryFrames } = useInstantInteraction();
  const routeKey = workspaceKey(pathname);
  const frame = entryFrames[routeKey] ?? entryFrames.other;
  if (!frame) return null;
  return <SectionEntryFrame routeKey={routeKey} frame={frame} privateBoundary />;
}
