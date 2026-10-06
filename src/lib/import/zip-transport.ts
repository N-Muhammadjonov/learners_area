import { strFromU8 } from "fflate";
import { readSafeArchiveAsync } from "./archive";

/**
 * A ZIP is a TRANSPORT CONTAINER, never an application.
 *
 * It may carry a canonical manifest plus the binaries the manifest declares
 * (`manifest.json`, `audio/full.mp3`, `images/map.webp`). Selecting such a ZIP is
 * equivalent to selecting the JSON and its assets individually — nothing inside
 * the archive is executed, and an archive that contains no canonical manifest is
 * refused here (legacy HTML packages use the separate conversion pipeline).
 */

export type TransportArchive = {
  manifest: unknown;
  manifestPath: string;
  /** Every file in the archive, keyed by its normalized path. */
  files: Record<string, Uint8Array>;
};

const MANIFEST_NAMES = ["manifest.json", "package.json", "data/package.json"];

export function findManifestPath(paths: string[]): string | null {
  const normalized = paths.map((path) => path.replace(/^\.\//, ""));
  for (const name of MANIFEST_NAMES) {
    const exact = normalized.find((path) => path.toLowerCase() === name);
    if (exact) return exact;
  }
  // One nested package folder (`listening-test-11/manifest.json`) is accepted.
  for (const name of MANIFEST_NAMES) {
    const nested = normalized.find((path) => path.toLowerCase().endsWith(`/${name}`));
    if (nested) return nested;
  }
  return null;
}

export async function readTransportArchive(bytes: Uint8Array, signal?: AbortSignal): Promise<TransportArchive> {
  const entries = await readSafeArchiveAsync(bytes, signal);
  const manifestPath = findManifestPath(Object.keys(entries));
  if (!manifestPath) throw new Error("Archive has no canonical manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(strFromU8(entries[manifestPath]!));
  } catch {
    throw new Error("Archive manifest is not valid JSON");
  }
  return { manifest, manifestPath, files: entries };
}

/** Case-insensitive lookup used when a declared asset path points into the archive. */
export function archiveFile(files: Record<string, Uint8Array>, path: string): Uint8Array | null {
  const wanted = path.replace(/^\.\//, "").toLowerCase();
  for (const [candidate, value] of Object.entries(files)) {
    const normalized = candidate.replace(/^\.\//, "").toLowerCase();
    if (normalized === wanted || normalized.endsWith(`/${wanted}`)) return value;
  }
  const base = wanted.split("/").pop();
  if (!base) return null;
  const matches = Object.entries(files).filter(([candidate]) => candidate.toLowerCase().endsWith(`/${base}`) || candidate.toLowerCase() === base);
  return matches.length === 1 ? matches[0]![1] : null;
}
