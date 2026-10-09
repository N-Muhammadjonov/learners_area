import type { RiwiActor } from "./capabilities";
import { PORTABLE_SCHEMA_VERSION, RIWI_CORE_VERSION } from "@/lib/portability/types";

/** The portable broker depends on this authority boundary, never feature tables.
 * Site implementations resolve current persisted identity. Request roles are not authority.
 */
export type RiwiSiteAdapter = {
  portableSchemaVersion: string;
  riwiCoreVersion: string;
  resolveActor(userId: string): Promise<RiwiActor | null>;
};

export function assertRiwiSiteAdapterCompatibility(adapter: RiwiSiteAdapter): void {
  if (adapter.portableSchemaVersion !== PORTABLE_SCHEMA_VERSION || adapter.riwiCoreVersion !== RIWI_CORE_VERSION || typeof adapter.resolveActor !== "function") {
    throw new Error("riwi_site_adapter_incompatible");
  }
}

export async function currentAdapterActor(adapter: RiwiSiteAdapter, claimed: RiwiActor, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const unavailable = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      onAbort = () => resolve(null);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    const actual = await Promise.race([Promise.resolve().then(() => adapter.resolveActor(claimed.id)), unavailable]);
    if (signal?.aborted) return false;
    return actual?.id === claimed.id && actual.role === claimed.role && actual.accountStatus === "active" && claimed.accountStatus === "active";
  } catch { return false; }
  finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
