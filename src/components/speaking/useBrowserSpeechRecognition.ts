"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionError = { error?: string };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionConstructor = new () => Recognition;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}

export type BrowserSttState =
  | { kind: "unsupported" }
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "listening"; interim: string; final: string }
  | { kind: "stopping"; final: string; interim: string }
  | { kind: "stopped"; rawTranscript: string }
  | { kind: "error"; code: string; rawTranscript: string };

const join = (left: string, right: string) => `${left.trim()} ${right.trim()}`.trim();

/** Browser speech recognition only. It never sends interim or final text to our server. */
export function useBrowserSpeechRecognition(language = "en-US") {
  const supported = typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const [state, setState] = useState<BrowserSttState>(supported ? { kind: "idle" } : { kind: "unsupported" });
  const recognitionRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const pendingStopRef = useRef<{ promise: Promise<string>; resolve: (text: string) => void; timer: number } | null>(null);

  const cleanup = useCallback((abort: boolean) => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (abort) try { recognition.abort(); } catch { /* already ended */ }
    }
    const pending = pendingStopRef.current;
    pendingStopRef.current = null;
    if (pending) { window.clearTimeout(pending.timer); pending.resolve(finalRef.current); }
  }, []);

  const start = useCallback(() => {
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor || recognitionRef.current) return false;
    finalRef.current = "";
    setState({ kind: "starting" });
    try {
      const recognition = new Constructor();
      recognitionRef.current = recognition;
      recognition.lang = language;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        if (recognitionRef.current !== recognition) return;
        // The browser supplies a complete current result snapshot. Rebuild by
        // index so repeated finals and interim replacements never append twice.
        let final = ""; let interim = "";
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0]?.transcript ?? "";
          if (result?.isFinal) final = join(final, text);
          else interim = join(interim, text);
        }
        finalRef.current = final;
        setState({ kind: pendingStopRef.current ? "stopping" : "listening", final, interim });
      };
      recognition.onerror = (event) => {
        if (recognitionRef.current !== recognition) return;
        const rawTranscript = finalRef.current;
        cleanup(true);
        setState({ kind: "error", code: event.error || "recognition_error", rawTranscript });
      };
      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        const rawTranscript = finalRef.current;
        cleanup(false);
        setState(rawTranscript ? { kind: "stopped", rawTranscript }
          : { kind: "error", code: "no_speech", rawTranscript });
      };
      setState({ kind: "listening", final: "", interim: "" });
      recognition.start();
      return true;
    } catch {
      cleanup(true);
      setState({ kind: "error", code: "start_failed", rawTranscript: finalRef.current });
      return false;
    }
  }, [cleanup, language]);

  const stop = useCallback((): Promise<string> => {
    if (pendingStopRef.current) return pendingStopRef.current.promise;
    const recognition = recognitionRef.current;
    if (!recognition) return Promise.resolve(finalRef.current);
    let resolve!: (text: string) => void;
    const promise = new Promise<string>((done) => { resolve = done; });
    const timer = window.setTimeout(() => {
      if (recognitionRef.current !== recognition) return;
      const rawTranscript = finalRef.current;
      cleanup(true);
      setState({ kind: "error", code: "stop_timeout", rawTranscript });
    }, 2000);
    pendingStopRef.current = { promise, resolve, timer };
    setState({ kind: "stopping", final: finalRef.current, interim: "" });
    try { recognition.stop(); }
    catch {
      const rawTranscript = finalRef.current;
      cleanup(true);
      setState({ kind: "error", code: "stop_failed", rawTranscript });
    }
    return promise;
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup(true);
    finalRef.current = "";
    setState(supported ? { kind: "idle" } : { kind: "unsupported" });
  }, [cleanup, supported]);

  useEffect(() => () => { cleanup(true); }, [cleanup]);

  const liveTranscript = state.kind === "listening" || state.kind === "stopping" ? join(state.final, state.interim)
    : state.kind === "stopped" || state.kind === "error" ? state.rawTranscript : "";
  return { state, supported, liveTranscript, start, stop, reset };
}
