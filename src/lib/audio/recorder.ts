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

/** Cancellable permission acquisition shared by recording and local microphone checks. */
export async function acquireMicrophoneStream(options: { signal?: AbortSignal; permissionTimeoutMs?: number } = {}): Promise<MediaStream> {
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

  return stream;
}

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

  const stream = await acquireMicrophoneStream(options);

  if (options.signal?.aborted) {
    for (const track of stream.getTracks()) track.stop();
    throw new RecorderError("unknown", "Microphone request was cancelled.");
  }
  let recorder: MediaRecorder;
  try { recorder = new window.MediaRecorder(stream, chosen.mimeType ? { mimeType: chosen.mimeType } : undefined); }
  catch { for (const track of stream.getTracks()) track.stop(); throw new RecorderError("unknown", "Could not create the audio recorder."); }
  const chunks: Blob[] = [];
  let startedAt: number | null = null;
  let stoppedAt: number | null = null;
  let closed = false;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let stopPromise: Promise<RecordingResult | null> | null = null;
  let settleStop: ((value: RecordingResult | null) => void) | null = null;

  const elapsedMs = () => startedAt === null ? 0 : Math.max(0, (stoppedAt ?? Date.now()) - startedAt);
  const finish = (keep: boolean) => {
    if (closed) return;
    closed = true;
    stoppedAt ??= Date.now();
    const blob = keep && chunks.length ? new Blob(chunks, { type: recorder.mimeType || chosen.mimeType || "audio/webm" }) : null;
    const result = blob ? { blob, mimeType: blob.type, durationMs: elapsedMs(), size: blob.size } : null;
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
    recorder.removeEventListener("dataavailable", onData);
    recorder.removeEventListener("stop", onStop);
    recorder.removeEventListener("error", onError);
    options.signal?.removeEventListener("abort", cancel);
    try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* release tracks even if the native recorder fails */ }
    for (const track of stream.getTracks()) track.stop();
    chunks.length = 0;
    settleStop?.(result); settleStop = null;
    stopPromise ??= Promise.resolve(result);
  };
  function onData(event: BlobEvent) { if (!closed && event.data?.size) chunks.push(event.data); }
  function onStop() { finish(true); }
  function onError() { finish(false); }
  function cancel() { finish(false); }
  recorder.addEventListener("dataavailable", onData);
  recorder.addEventListener("stop", onStop);
  recorder.addEventListener("error", onError);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();

  return {
    async start() {
      if (closed || startedAt !== null) throw new RecorderError("unknown", "Recording cannot be started again.");
      startedAt = Date.now();
      try { recorder.start(250); }
      catch { finish(false); throw new RecorderError("unknown", "Could not start the audio recorder."); }
    },
    stop(): Promise<RecordingResult | null> {
      if (stopPromise) return stopPromise;
      stopPromise = new Promise((resolve) => { settleStop = resolve; });
      stoppedAt = Date.now();
      if (startedAt === null || recorder.state === "inactive") { finish(false); return stopPromise; }
      deadline = setTimeout(() => finish(false), 5_000);
      try { recorder.stop(); } catch { finish(false); }
      return stopPromise;
    },
    cancel,
    elapsedMs,
  };
}

/** "1:05" style label for a duration in milliseconds. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
