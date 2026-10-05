/**
 * Browser Speech Recognition — the live transcript for Practice with AI.
 *
 * Why this exists: a server SpeechToTextService bills the owner per audio
 * minute. The browser's own recognizer does not, so the default Practice-with-AI
 * path uses it and the owner's STT cost for that path stays $0.
 *
 * HONESTY (spec §72), and the reason this file is careful with its wording:
 * browser speech recognition is a BROWSER/VENDOR feature. Depending on the
 * browser it may send audio to a vendor service. Nothing here may claim the
 * transcription happened "locally", "offline" or "on device" — only that no
 * separate STT API is billed to Learners Area for it.
 *
 * Equally: browser recognition is NOT pronunciation assessment, and its output
 * is learner-side data. The server treats a submitted browser transcript with
 * the same trust as any learner-submitted text (§43) and records its origin as
 * "browser_stt" — never as server "stt", never as "manual".
 *
 * Deliberately framework-free: React binds to it in useBrowserSpeechRecognition,
 * which keeps the recognition lifecycle itself testable without a DOM renderer.
 */

/** Typed error codes, mapped to dictionary keys by the UI. */
export type BrowserSttErrorCode =
  | "unsupported"
  | "not-allowed"
  | "service-not-allowed"
  | "audio-capture"
  | "network"
  | "no-speech"
  | "aborted"
  | "unknown";

/**
 * The state contract from spec §38. `listening` carries interim and final text
 * separately so the UI can show the in-flight phrase without committing it to
 * the transcript the learner will review.
 */
export type BrowserSttState =
  | { kind: "unsupported" }
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "listening"; interim: string; final: string }
  | { kind: "stopped"; rawTranscript: string }
  | { kind: "error"; code: BrowserSttErrorCode };

/** Minimal shape of the non-standard Web Speech API. TS lib.dom does not ship it. */
type SpeechRecognitionAlternative = { transcript: string; confidence?: number };
type SpeechRecognitionResult = { isFinal: boolean; length: number; [index: number]: SpeechRecognitionAlternative };
type SpeechRecognitionResultList = { length: number; [index: number]: SpeechRecognitionResult };
type SpeechRecognitionEventLike = { resultIndex: number; results: SpeechRecognitionResultList };
type SpeechRecognitionErrorLike = { error?: string; message?: string };

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type WindowLike = {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

/** Recognizer constructor, or null when this browser genuinely has none. */
export function resolveSpeechRecognition(win: unknown = typeof window === "undefined" ? undefined : window): SpeechRecognitionCtor | null {
  const w = win as WindowLike | undefined;
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

/** Capability probe. False must produce a truthful "not supported" state, never a fake transcript. */
export function isBrowserSttSupported(win?: unknown): boolean {
  return resolveSpeechRecognition(win) !== null;
}

/** Maps the vendor's error string onto our closed vocabulary; unknown stays unknown. */
export function toBrowserSttErrorCode(raw: string | undefined): BrowserSttErrorCode {
  switch (raw) {
    case "not-allowed": return "not-allowed";
    case "service-not-allowed": return "service-not-allowed";
    case "audio-capture": return "audio-capture";
    case "network": return "network";
    case "no-speech": return "no-speech";
    case "aborted": return "aborted";
    default: return "unknown";
  }
}

/**
 * Joins recognized chunks into one transcript.
 *
 * Only whitespace is normalized. Punctuation and capitalisation are left exactly
 * as the recognizer produced them (§16): "light formatting" that changes a
 * sentence's meaning would put words in the learner's mouth before an evaluator
 * judges them.
 */
export function joinTranscript(chunks: readonly string[]): string {
  return chunks.map((chunk) => chunk.trim()).filter(Boolean).join(" ").replace(/\s{2,}/g, " ");
}

export type BrowserSttController = {
  /** Begin recognizing. Safe to call once; a second call is ignored. */
  start(): void;
  /** Stop recognizing and freeze the transcript for review. Returns the raw text. */
  stop(): string;
  /** Stop and DISCARD (used by Clear / re-record). Returns nothing. */
  abort(): void;
  /** Detach every listener and drop the instance. Idempotent; safe after stop(). */
  release(): void;
  rawTranscript(): string;
  state(): BrowserSttState;
  /** True while the recognizer is meant to be running. */
  isActive(): boolean;
};

export type BrowserSttOptions = {
  /** BCP-47 tag. IELTS Speaking is assessed in English, so en-US is the default. */
  lang?: string;
  onChange?: (state: BrowserSttState) => void;
  /** Injectable for tests; defaults to the real browser constructor. */
  createRecognition?: () => SpeechRecognitionLike | null;
  /**
   * Chrome ends a continuous session on its own after a pause. Restarting keeps
   * the live transcript alive during a long Part 2 answer. Bounded so a browser
   * that refuses to start cannot spin: past the limit we report the truth.
   */
  maxRestarts?: number;
};

const DEFAULT_MAX_RESTARTS = 6;

export function createBrowserStt(options: BrowserSttOptions = {}): BrowserSttController {
  const lang = options.lang ?? "en-US";
  const maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  // `new` is required: the Web Speech API ships a class, and calling it as a
  // plain function throws in every engine that implements it.
  const create = options.createRecognition ?? ((): SpeechRecognitionLike | null => {
    const Ctor = resolveSpeechRecognition();
    return Ctor ? new Ctor() : null;
  });

  let recognition: SpeechRecognitionLike | null = null;
  let active = false;
  let stoppedByCaller = false;
  let restarts = 0;
  let started = false;
  const finalChunks: string[] = [];
  let interim = "";
  /**
   * An unsupported browser starts in "unsupported" so no live-transcript panel
   * can ever be rendered that will not work (§78: never display a fake live
   * transcript). When a factory is injected — tests, or an embedding that knows
   * better than the global probe — the check is skipped and start() reports the
   * truth from what the factory returns.
   */
  let current: BrowserSttState = options.createRecognition || isBrowserSttSupported()
    ? { kind: "idle" }
    : { kind: "unsupported" };

  const emit = (next: BrowserSttState) => {
    current = next;
    options.onChange?.(next);
  };

  const listening = (): BrowserSttState => ({
    kind: "listening",
    interim,
    final: joinTranscript(finalChunks),
  });

  function attach(instance: SpeechRecognitionLike) {
    instance.lang = lang;
    instance.continuous = true;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onresult = (event) => {
        // An interim result is the provisional form of the segment that is about
        // to become final. Each event therefore rebuilds the interim from scratch
        // rather than appending to it: when the final for that segment arrives the
        // interim is superseded, and keeping both would duplicate the words in the
        // transcript the learner reviews before sending.
        let nextInterim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? "";
        if (!text) continue;
        if (result.isFinal) finalChunks.push(text.trim());
        else nextInterim += text;
      }
      interim = nextInterim.trim();
      if (active) emit(listening());
    };

    instance.onerror = (event) => {
      const code = toBrowserSttErrorCode(event?.error);
      // "no-speech" is not fatal: the learner may simply be pausing mid-answer.
      // The audio recording carries on and the transcript stays available.
      if (code === "no-speech" || code === "aborted") return;
      active = false;
      detach(instance);
      emit({ kind: "error", code });
    };

    instance.onend = () => {
      if (!active) return;
      // Ended on its own while we still wanted to listen (Chrome does this after
      // a silence). Restart within the bound, otherwise say so truthfully.
      if (!stoppedByCaller && restarts < maxRestarts) {
        restarts += 1;
        try {
          instance.start();
          return;
        } catch {
          /* fall through to the honest stopped state */
        }
      }
      active = false;
      detach(instance);
      emit({ kind: "stopped", rawTranscript: joinTranscript(finalChunks) });
    };
  }

  function detach(instance: SpeechRecognitionLike) {
    instance.onresult = null;
    instance.onerror = null;
    instance.onend = null;
    instance.onstart = null;
    if (recognition === instance) recognition = null;
  }

  return {
    start() {
      if (started || active) return; // starts exactly once per take
      started = true;
      stoppedByCaller = false;
      const instance = (() => { try { return create(); } catch { return null; } })();
      if (!instance) {
        emit({ kind: "unsupported" });
        return;
      }
      recognition = instance;
      emit({ kind: "starting" });
      attach(instance);
      active = true;
      try {
        instance.start();
      } catch {
        // Already started, or the engine refused. Either way: no live transcript,
        // stated plainly — never simulated.
        active = false;
        detach(instance);
        emit({ kind: "error", code: "unknown" });
        return;
      }
      emit(listening());
    },

    stop() {
      stoppedByCaller = true;
      const instance = recognition;
      active = false;
      if (instance) {
        try { instance.stop(); } catch { /* stopping an idle recognizer is harmless */ }
        detach(instance);
      }
      interim = "";
      const raw = joinTranscript(finalChunks);
      emit({ kind: "stopped", rawTranscript: raw });
      return raw;
    },

    abort() {
      stoppedByCaller = true;
      const instance = recognition;
      active = false;
      if (instance) {
        // abort() discards pending results — correct for Clear / re-record, where
        // the learner has thrown this take away.
        try { instance.abort(); } catch { /* already idle */ }
        detach(instance);
      }
      // Reset the take: "Clear" and "Re-record" end with the learner starting
      // again, and if `started` were left true that next take would silently
      // produce no transcript at all.
      finalChunks.length = 0;
      interim = "";
      started = false;
      restarts = 0;
      emit({ kind: "idle" });
    },

    release() {
      stoppedByCaller = true;
      active = false;
      const instance = recognition;
      recognition = null;
      if (instance) {
        try { instance.abort(); } catch { /* already idle */ }
        detach(instance);
      }
      // Same reason as abort(): a released controller is spent, but leaving the
      // take flags dirty would make a reused controller useless rather than
      // obviously finished.
      finalChunks.length = 0;
      interim = "";
      started = false;
      restarts = 0;
    },

    rawTranscript: () => joinTranscript(finalChunks),
    state: () => current,
    isActive: () => active,
  };
}
