import { unzip, unzipSync, strFromU8 } from "fflate";
import { safePackagePath } from "./package";
import { isIgnoredEntry, isTextEntry, packageRoot } from "./discover";
const MAX_TOTAL = 200 * 1024 * 1024;
/** Check declared uncompressed sizes before inflation, and bound count and total output. */
export function readListeningZip(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_TOTAL) throw new Error("ZIP exceeds 200 MB");
  let total = 0,
    count = 0;
  const seen = new Set<string>();
  const entries = unzipSync(bytes, {
    filter(file) {
      if (seen.has(file.name)) throw new Error("Duplicate ZIP filename");
      seen.add(file.name);
      if (++count > 200 || !safePackagePath(file.name))
        throw new Error("Unsafe ZIP path or too many files");
      if (!file.name.endsWith("/")) total += file.originalSize;
      if (file.originalSize > MAX_TOTAL || total > MAX_TOTAL)
        throw new Error("Expanded ZIP exceeds 200 MB");
      return !file.name.endsWith("/");
    },
  });
  return normalizeEntries(entries);
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

/** Browser decompression uses fflate workers; large MP3 inflation does not block the UI. */
export async function readListeningZipAsync(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_TOTAL) throw new Error("ZIP exceeds 200 MB");
  let total = 0,
    count = 0;
  const seen = new Set<string>();
  return new Promise<ReturnType<typeof readListeningZip>>((resolve, reject) => {
    try {
      unzip(
        bytes,
        {
          filter(file) {
            if (seen.has(file.name)) throw new Error("Duplicate ZIP filename");
            seen.add(file.name);
            if (++count > 200 || !safePackagePath(file.name))
              throw new Error("Unsafe ZIP path or too many files");
            total += file.originalSize;
            if (file.originalSize > MAX_TOTAL || total > MAX_TOTAL)
              throw new Error("Expanded ZIP exceeds 200 MB");
            return !file.name.endsWith("/");
          },
        },
        (error, entries) => {
          if (error) reject(error);
          else {
            try {
              resolve(normalizeEntries(entries));
            } catch (e) {
              reject(e);
            }
          }
        },
      );
    } catch (e) {
      reject(e);
    }
  });
}
