import { unzip, unzipSync } from "fflate";

const DEFAULT_LIMIT = 200 * 1024 * 1024;
const DEFAULT_ENTRIES = 200;
const DEFAULT_TIMEOUT_MS = 30_000;

export type SafeArchiveLimits = {
  /** Maximum bytes in the compressed archive supplied by the caller. */
  maxCompressedBytes?: number;
  /** Maximum total uncompressed bytes across files. */
  maxExpandedBytes?: number;
  /** Maximum number of central-directory entries, including directories. */
  maxEntries?: number;
  /** Async inflation deadline. */
  timeoutMs?: number;
};

type ResolvedLimits = Required<SafeArchiveLimits>;

function resolveLimits(limits: SafeArchiveLimits = {}): ResolvedLimits {
  const resolved = {
    maxCompressedBytes: limits.maxCompressedBytes ?? DEFAULT_LIMIT,
    maxExpandedBytes: limits.maxExpandedBytes ?? DEFAULT_LIMIT,
    maxEntries: limits.maxEntries ?? DEFAULT_ENTRIES,
    timeoutMs: limits.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  if (Object.values(resolved).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError("Invalid safe archive limits");
  }
  return resolved;
}

export function safeArchivePath(path: string) {
  return path.length > 0 && path.length <= 240 && !/^[\\/]|^[a-z]:/i.test(path)
    && !/[\\\x00-\x1f]/.test(path) && !path.split("/").some(p => p === ".." || p === ".");
}

function archiveFilter(bytes: Uint8Array, limits: ResolvedLimits) {
  if (bytes.byteLength > limits.maxCompressedBytes) throw new Error("ZIP exceeds compressed size limit");
  let count = 0, total = 0;
  const seen = new Set<string>();
  return (file: { name: string; originalSize: number }) => {
    const key = file.name.normalize("NFC").toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) throw new Error("Duplicate ZIP filename");
    seen.add(key);
    if (++count > limits.maxEntries || !safeArchivePath(file.name)) throw new Error("Unsafe ZIP path or too many files");
    total += file.originalSize;
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || total > limits.maxExpandedBytes) {
      throw new Error("Expanded ZIP exceeds size limit");
    }
    return !file.name.endsWith("/");
  };
}

function assertExpandedBounds(entries: Record<string, Uint8Array>, limits: ResolvedLimits) {
  const values = Object.values(entries);
  if (values.length > limits.maxEntries) throw new Error("Unsafe ZIP path or too many files");
  const total = values.reduce((sum, value) => sum + value.byteLength, 0);
  if (!Number.isSafeInteger(total) || total > limits.maxExpandedBytes) throw new Error("Expanded ZIP exceeds size limit");
}

export function readSafeArchive(bytes: Uint8Array, requestedLimits?: SafeArchiveLimits) {
  const limits = resolveLimits(requestedLimits);
  const entries = unzipSync(bytes, { filter: archiveFilter(bytes, limits) });
  assertExpandedBounds(entries, limits);
  return entries;
}

/** Worker inflation, cancellable and bounded; adapters own semantic discovery. */
export function readSafeArchiveAsync(
  bytes: Uint8Array,
  signal?: AbortSignal,
  requestedLimits?: SafeArchiveLimits,
): Promise<Record<string, Uint8Array>> {
  const limits = resolveLimits(requestedLimits);
  // Validate the complete central directory before launching any inflation
  // worker. A later invalid entry must never leave an earlier worker alive.
  const validate = archiveFilter(bytes, limits);
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
      if (error) { cancel?.(); reject(error); } else {
        try {
          assertExpandedBounds(entries!, limits);
          resolve(entries!);
        } catch (boundsError) {
          cancel?.();
          reject(boundsError);
        }
      }
    };
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(new Error("ZIP parsing timed out")), limits.timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    try { cancel = unzip(bytes, { filter }, (error, entries) => finish(error, entries)); }
    catch (error) { finish(error); }
  });
}
