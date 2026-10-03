import { strFromU8 } from "fflate";
import { readSafeArchive, readSafeArchiveAsync } from "../import/archive";
import { isIgnoredEntry, isTextEntry, packageRoot } from "./discover";

export function readListeningZip(bytes: Uint8Array) {
  return normalizeEntries(readSafeArchive(bytes));
}
function normalizeEntries(entries: Record<string, Uint8Array>) {
  // System junk (__MACOSX/, ._files, .DS_Store) used to count as a second
  // "package root" and failed the whole import. It is ignored, not trusted.
  const names = Object.keys(entries).filter((n) => !isIgnoredEntry(n));
  const root = packageRoot(names);
  const normalized: Record<string, Uint8Array> = {};
  for (const path of names) {
    // Files outside the canonical folder are still offered (e.g. audio kept
    // next to a nested package folder) under their full path.
    const relative = root && path.toLowerCase().startsWith(root.toLowerCase()) ? path.slice(root.length) : path;
    if (normalized[relative]) throw new Error("Duplicate ZIP filename");
    normalized[relative] = entries[path]!;
  }
  const textFiles: Record<string, string> = {};
  for (const [path, value] of Object.entries(normalized))
    if (isTextEntry(path)) {
      if (value.byteLength > 5 * 1024 * 1024)
        throw new Error("Text asset too large");
      textFiles[path] = strFromU8(value);
    }
  return { entries: normalized, textFiles, root };
}

/** Shared worker decompression keeps large media off the UI thread. */
export async function readListeningZipAsync(bytes: Uint8Array, signal?: AbortSignal) {
  return normalizeEntries(await readSafeArchiveAsync(bytes, signal));
}
