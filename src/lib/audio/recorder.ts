/**
 * Microphone recording via MediaRecorder.
 *
 * Deliberately conservative:
 *  - it picks the first container/codec pair the browser actually supports, so
 *    it works on Chrome, Firefox and Safari rather than assuming webm
 *  - it reports real elapsed time and real byte size, never an estimate
 *  - it surfaces a typed error when the API is unavailable or permission is
 *    denied, instead of leaving the user staring at a dead button
 *  - `stop()` always resolves, even if nothing was recorded
 */

export type RecorderState = "idle" | "requesting" | "recording" | "stopped" | "error";

export type RecordingResult = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  size: number;
};

export type RecorderErrorCode = "unsupported" | "permission_denied" | "no_microphone" | "unknown";

export class RecorderError extends Error {
  constructor(public code: RecorderErrorCode, message: string) {
    super(message);
    this.name = "RecorderError";
  }
}

/** Preference order; the first supported pair wins. */
const CANDIDATES: { mimeType: string; extension: string }[] = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/webm", extension: "webm" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  { mimeType: "audio/mp4", extension: "m4a" },
  { mimeType: "audio/aac", extension: "aac" },
  { mimeType: "", extension: "webm" },
];

export function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Picks the container the browser will really produce, or null if none do. */
export function pickMimeType(): { mimeType: string; extension: string } | null {
  if (typeof window === "undefined" || !window.MediaRecorder) return null;
  for (const candidate of CANDIDATES) {
    if (!candidate.mimeType) return candidate;
    if (window.MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate;
  }
  return null;
}

export function extensionForMime(mimeType: string): string {
  const found = CANDIDATES.find((c) => c.mimeType === mimeType);
  if (found) return found.extension;

  // Not a container this module negotiates, so fall back to the subtype the
  // browser declared rather than always claiming .webm — a wrong extension
  // makes the object key lie about what the file is.
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (["mp4", "mp4a", "m4a", "aac", "adts"].includes(subtype)) return "m4a";
  if (["mpeg", "mp3", "mpga"].includes(subtype)) return "mp3";
  if (["ogg", "opus", "oga", "weba"].includes(subtype)) return "ogg";
  if (["wav", "x-wav", "wave"].includes(subtype)) return "wav";
  if (["webm", "weba"].includes(subtype)) return "webm";
  return "webm";
}

export type Recorder = {
  start: () => Promise<void>;
  stop: () => Promise<RecordingResult | null>;
  cancel: () => void;
  readonly elapsedMs: () => number;
};

/**
 * Creates a recorder bound to a fresh getUserMedia stream. The stream is
 * stopped on stop()/cancel() — leaving a microphone indicator light on after
 * recording is both a privacy bug and a battery drain.
 */
export async function createRecorder(options: {signal?: AbortSignal; permissionTimeoutMs?: number} = {}): Promise<Recorder> {
  if (!isRecordingSupported()) {
    throw new RecorderError("unsupported", "This browser cannot record audio.");
  }
  const chosen = pickMimeType();
  if (!chosen) {
    throw new RecorderError("unsupported", "No supported audio container in this browser.");
  }

  let stream: MediaStream;
  try {
    stream = await new Promise<MediaStream>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => fail(), options.permissionTimeoutMs ?? 30_000);
      const cleanup = () => {clearTimeout(timeout); options.signal?.removeEventListener("abort", fail);};
      const fail = () => {if (settled) return; settled = true; cleanup(); reject(new RecorderError("unknown", "Microphone request was cancelled or timed out."));};
      if (options.signal?.aborted) {fail(); return;}
      options.signal?.addEventListener("abort", fail, {once: true});
      navigator.mediaDevices.getUserMedia({audio: true}).then(value => {
        if (settled) {for (const track of value.getTracks()) track.stop(); return;}
        settled = true; cleanup(); resolve(value);
      }, error => {if (settled) return; settled = true; cleanup(); reject(error);});
    });
  } catch (err) {
    if (err instanceof RecorderError) throw err;
    const name = (err as { name?: string } | null)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new RecorderError("permission_denied", "Microphone permission was denied.");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new RecorderError("no_microphone", "No microphone was found.");
    }
    throw new RecorderError("unknown", "Could not start the microphone.");
  }

  let recorder: MediaRecorder;
  try {recorder = new MediaRecorder(stream, chosen.mimeType ? { mimeType: chosen.mimeType } : undefined);}
  catch {for (const track of stream.getTracks()) track.stop(); throw new RecorderError("unknown", "Could not create the audio recorder.");}
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let stoppedAt: number | null = null;

  recorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });

  function releaseStream() {
    for (const track of stream.getTracks()) track.stop();
  }

  return {
    async start() {
      // 250ms timeslice so a long recording produces several chunks rather
      // than one giant buffer held entirely in memory.
      recorder.start(250);
    },
    stop(): Promise<RecordingResult | null> {
      if (recorder.state === "inactive") {
        releaseStream();
        return Promise.resolve(null);
      }
      return new Promise<RecordingResult | null>((resolve) => {
        const deadline = setTimeout(() => {releaseStream(); resolve(null);}, 5_000);
        recorder.addEventListener(
          "stop",
          () => {
            clearTimeout(deadline);
            stoppedAt = Date.now();
            releaseStream();
            if (chunks.length === 0) {
              resolve(null);
              return;
            }
            const blob = new Blob(chunks, { type: recorder.mimeType || chosen.mimeType || "audio/webm" });
            resolve({
              blob,
              mimeType: blob.type,
              durationMs: (stoppedAt ?? Date.now()) - startedAt,
              size: blob.size,
            });
          },
          { once: true }
        );
        try {recorder.stop();} catch {clearTimeout(deadline); releaseStream(); resolve(null);}
      });
    },
    cancel() {
      try {if (recorder.state !== "inactive") recorder.stop();}
      catch { /* Track release must still succeed if the recorder has failed. */ }
      finally {releaseStream();}
    },
    elapsedMs: () => (stoppedAt ?? Date.now()) - startedAt,
  };
}

/** "1:05" style label for a duration in milliseconds. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
