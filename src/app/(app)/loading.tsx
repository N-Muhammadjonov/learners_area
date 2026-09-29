import { RouteEntryLoading } from "@/components/interaction/RouteEntryLoading";

/**
 * No async locale, auth, or data work belongs in this fallback. The persistent
 * authenticated layout already provides the localized route-frame model.
 */
export default function Loading() {
  return <RouteEntryLoading />;
}
