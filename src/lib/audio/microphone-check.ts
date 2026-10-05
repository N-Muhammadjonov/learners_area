/**
 * Microphone check — the gate before a Practice with AI session (spec §8).
 *
 * It must prove three separate things, and say honestly which one failed:
 *   1. this browser can capture audio at all            → "unsupported"
 *   2. the learner actually granted the microphone      → "denied"
 *   3. non-zero audio energy is arriving                → "error"/"no_input"
 *
 * A check that only asks for permission would pass on a muted or broken device,
 * so the level is really measured: the waveform is read from an AnalyserNode and
 * its RMS is compared against a floor. Silence is reported as silence.
 *
 * Two guarantees this module is written around:
 *   - the microphone is released on EVERY exit path (pass, fail, deny, abort,
 *     unexpected throw). A check that leaves the browser's recording light on is
 *     both a privacy bug and the reason learners distrust the next step.
 *   - it performs NO network call and creates NO speaking attempt. A microphone
 *     check is a local device test; nothing about it is uploaded or persisted.
 *
 * Dependencies are injectable so the lifecycle can be unit-tested without a real
 * device: `deps` defaults to the browser implementations.
 */

/** The status vocabulary from spec §8. */
export type MicrophoneCheckStatus =
  | "idle"
  | "requesting_permission"
  | "checking"
  | "passed"
  | "denied"
  | "unsupported"
  | "error";

export type MicrophoneCheckErrorCode = "no_input" | "no_microphone" | "aborted" | "unknown";

export type MicrophoneCheckOutcome =
  | { status: "passed"; peakLevel: number; sampleMs: number }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "error"; code: MicrophoneCheckErrorCode; peakLevel: number; sampleMs: number };

export type AnalyserLike = {
  fftSize: number;
  getByteTimeDomainData(target: Uint8Array): void;
};

export type AudioContextLike = {
  createAnalyser(): AnalyserLike;
  createMediaStreamSource(stream: unknown): { connect(node: unknown): void; disconnect(): void };
  close(): Promise<void> | void;
  resume?(): Promise<void>;
};

export type MediaStreamTrackLike = { stop(): void; readonly readyState?: string };
export type MediaStreamLike = { getTracks(): MediaStreamTrackLike[] };

export type MicrophoneCheckDeps = {
  isSupported(): boolean;
  getUserMedia(constraints: { audio: boolean }): Promise<MediaStreamLike>;
  createAudioContext(): AudioContextLike | null;
  now(): number;
  schedule(fn: () => void, intervalMs: number): unknown;
  cancel(handle: unknown): void;
};

export type RunMicrophoneCheckOptions = {
  /** How long to listen before concluding the input is silent. */
  durationMs?: number;
  /** RMS floor that counts as "the microphone is really picking you up". */
  threshold?: number;
  /** 0..1 level for the visual meter, on every sample. */
  onLevel?: (level: number) => void;
  onStatus?: (status: MicrophoneCheckStatus) => void;
  signal?: AbortSignal;
  deps?: Partial<MicrophoneCheckDeps>;
};

/** ~-36 dBFS. Below this is room tone, not a person speaking. */
export const DEFAULT_LEVEL_THRESHOLD = 0.02;
export const DEFAULT_CHECK_DURATION_MS = 4_000;
const SAMPLE_INTERVAL_MS = 60;

/** RMS of a byte-domain waveform (values centred on 128), normalized to 0..1. */
export function rmsLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const deviation = ((samples[i] ?? 128) - 128) / 128;
    sum += deviation * deviation;
  }
  return Math.sqrt(sum / samples.length);
}

function browserDeps(): MicrophoneCheckDeps {
  return {
    isSupported: () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints) as unknown as Promise<MediaStreamLike>,
    createAudioContext: () => {
      const Ctor =
        typeof window !== "undefined"
          ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
          : undefined;
      if (!Ctor) return null;
      return new Ctor() as unknown as AudioContextLike;
    },
    now: () => Date.now(),
    schedule: (fn, ms) => setInterval(fn, ms),
    cancel: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  };
}

/** Classifies a getUserMedia rejection onto the honest status, never a guess. */
export function classifyMicrophoneError(error: unknown): MicrophoneCheckOutcome {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return { status: "denied" };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return { status: "error", code: "no_microphone", peakLevel: 0, sampleMs: 0 };
  }
  return { status: "error", code: "unknown", peakLevel: 0, sampleMs: 0 };
}

export async function runMicrophoneCheck(options: RunMicrophoneCheckOptions = {}): Promise<MicrophoneCheckOutcome> {
  const deps = { ...browserDeps(), ...(options.deps ?? {}) };
  const durationMs = options.durationMs ?? DEFAULT_CHECK_DURATION_MS;
  const threshold = options.threshold ?? DEFAULT_LEVEL_THRESHOLD;
  const status = options.onStatus ?? (() => {});

  if (options.signal?.aborted) return { status: "error", code: "aborted", peakLevel: 0, sampleMs: 0 };
  if (!deps.isSupported()) {
    status("unsupported");
    return { status: "unsupported" };
  }

  status("requesting_permission");
  let stream: MediaStreamLike;
  try {
    stream = await deps.getUserMedia({ audio: true });
  } catch (error) {
    const outcome = classifyMicrophoneError(error);
    status(outcome.status);
    return outcome;
  }
  if (options.signal?.aborted) {
    releaseTracks(stream);
    return { status: "error", code: "aborted", peakLevel: 0, sampleMs: 0 };
  }

  // Audio graph. If it cannot be built the permission was still granted, so this
  // is reported as an error rather than "denied" — the learner did nothing wrong.
  let context: AudioContextLike | null = null;
  let source: { connect(node: unknown): void; disconnect(): void } | null = null;
  let analyser: AnalyserLike | null = null;
  try {
    context = deps.createAudioContext();
    if (!context) {
      releaseTracks(stream);
      status("error");
      return { status: "error", code: "unknown", peakLevel: 0, sampleMs: 0 };
    }
    await context.resume?.();
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);
  } catch {
    await teardown(context, source, stream);
    status("error");
    return { status: "error", code: "unknown", peakLevel: 0, sampleMs: 0 };
  }

  status("checking");
  const samples = new Uint8Array(analyser.fftSize);
  const startedAt = deps.now();
  let peak = 0;

  try {
    const result = await new Promise<MicrophoneCheckOutcome>((resolve) => {
      let handle: unknown = null;
      let settled = false;
      const finish = (outcome: MicrophoneCheckOutcome) => {
        if (settled) return;
        settled = true;
        if (handle !== null) deps.cancel(handle);
        handle = null;
        resolve(outcome);
      };
      const onAbort = () => finish({ status: "error", code: "aborted", peakLevel: peak, sampleMs: deps.now() - startedAt });
      options.signal?.addEventListener("abort", onAbort, { once: true });

      handle = deps.schedule(() => {
        if (settled) return;
        let level = 0;
        try {
          analyser!.getByteTimeDomainData(samples);
          level = rmsLevel(samples);
        } catch {
          finish({ status: "error", code: "unknown", peakLevel: peak, sampleMs: deps.now() - startedAt });
          return;
        }
        if (level > peak) peak = level;
        options.onLevel?.(Math.min(1, level / 0.35));

        // Enough real energy arrived: stop listening immediately rather than
        // holding the microphone open for the rest of the window.
        if (peak >= threshold) {
          finish({ status: "passed", peakLevel: peak, sampleMs: deps.now() - startedAt });
          return;
        }
        if (deps.now() - startedAt >= durationMs) {
          // The full window elapsed with only room tone. Reported as a failure:
          // pretending this passed would send the learner into a session that
          // cannot record them.
          finish({ status: "error", code: "no_input", peakLevel: peak, sampleMs: deps.now() - startedAt });
        }
      }, SAMPLE_INTERVAL_MS);
    });
    return result;
  } finally {
    // Every path releases the device: pass, silence, abort and unexpected throw.
    await teardown(context, source, stream);
    status("idle");
  }
}

function releaseTracks(stream: MediaStreamLike) {
  try {
    for (const track of stream.getTracks()) track.stop();
  } catch {
    /* a track that is already gone must not fail the release of the others */
  }
}

async function teardown(
  context: AudioContextLike | null,
  source: { connect(node: unknown): void; disconnect(): void } | null,
  stream: MediaStreamLike,
): Promise<void> {
  releaseTracks(stream);
  try { source?.disconnect(); } catch { /* already disconnected */ }
  try { await context?.close(); } catch { /* already closed */ }
}
