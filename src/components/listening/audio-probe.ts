/**
 * Audio metadata probing, isolated from the import screens so both the legacy
 * ZIP/HTML flow and the canonical package flow share one implementation.
 *
 * The URL object and the media element are released in every path — success,
 * error and abort — so leaving an import screen never leaks a decoded file.
 */
export async function probeAudio(file: File, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.preload = "metadata";
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    };
    const onAbort = () => {cleanup(); reject(new DOMException("Aborted", "AbortError"));};
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Audio metadata timeout"));
    }, 15000);
    audio.onloadedmetadata = () => {
      const seconds = audio.duration;
      cleanup();
      Number.isFinite(seconds) && seconds > 0
        ? resolve(seconds)
        : reject(new Error("Audio duration invalid"));
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("Audio unreadable"));
    };
    signal?.addEventListener("abort", onAbort, {once: true});
    audio.src = url;
  });
}
