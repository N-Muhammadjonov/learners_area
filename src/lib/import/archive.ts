import { unzip, unzipSync } from "fflate";

const MAX_TOTAL = 200 * 1024 * 1024;
export function safeArchivePath(path: string) {
  return path.length > 0 && path.length <= 240 && !/^[\\/]|^[a-z]:/i.test(path)
    && !/[\\\x00-\x1f]/.test(path) && !path.split("/").some(p => p === ".." || p === ".");
}
function archiveFilter(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_TOTAL) throw new Error("ZIP exceeds 200 MB");
  let count = 0, total = 0;
  const seen = new Set<string>();
  return (file: { name: string; originalSize: number }) => {
    const key = file.name.normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate ZIP filename");
    seen.add(key);
    if (++count > 200 || !safeArchivePath(file.name)) throw new Error("Unsafe ZIP path or too many files");
    total += file.originalSize;
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || total > MAX_TOTAL) throw new Error("Expanded ZIP exceeds 200 MB");
    return !file.name.endsWith("/");
  };
}
export function readSafeArchive(bytes: Uint8Array) {
  return unzipSync(bytes, { filter: archiveFilter(bytes) });
}
/** Worker inflation, cancellable and bounded; adapters own semantic discovery. */
export function readSafeArchiveAsync(bytes: Uint8Array, signal?: AbortSignal): Promise<Record<string, Uint8Array>> {
  // Validate the complete central directory before launching any inflation
  // worker. A later invalid entry must never leave an earlier worker alive.
  const validate = archiveFilter(bytes);
  try { unzipSync(bytes, { filter: file => { validate(file); return false; } }); }
  catch (error) { return Promise.reject(error); }
  const filter = (file: { name: string }) => !file.name.endsWith("/");
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    let settled = false;
    let cancel: (() => void) | undefined;
    const finish = (error: unknown, entries?: Record<string, Uint8Array>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) { cancel?.(); reject(error); } else resolve(entries!);
    };
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(new Error("ZIP parsing timed out")), 30_000);
    signal?.addEventListener("abort", abort, { once: true });
    try { cancel = unzip(bytes, { filter }, (error, entries) => finish(error, entries)); }
    catch (error) { finish(error); }
  });
}
