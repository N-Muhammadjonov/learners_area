/** Human-readable byte size, e.g. 1.4 MB. Used by the resource composer UI. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Short extension label for a file row, e.g. "PDF". */
export function extensionLabel(filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop()! : "";
  return ext ? ext.toUpperCase().slice(0, 5) : "FILE";
}

/** Estimated duration label for an audio/video element, once it is known. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
