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
  | { kind: "stopped"; rawTranscript: string }
  | { kind: "error"; code: string; rawTranscript: string };

const join = (left: string, right: string) => `${left.trim()} ${right.trim()}`.trim();

/** Browser speech recognition only. It never sends interim or final text to our server. */
export function useBrowserSpeechRecognition(language = "en-US") {
  const supported = typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const [state, setState] = useState<BrowserSttState>(supported ? { kind: "idle" } : { kind: "unsupported" });
  const recognitionRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const stoppingRef = useRef(false);

  const cleanup = useCallback((abort: boolean) => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { abort ? recognition.abort() : recognition.stop(); } catch { /* already stopped */ }
  }, []);

  const start = useCallback(() => {
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor || recognitionRef.current) return false;
    stoppingRef.current = false;
    finalRef.current = "";
    setState({ kind: "starting" });
    const recognition = new Constructor();
    recognitionRef.current = recognition;
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalRef.current = join(finalRef.current, text);
        else interim = join(interim, text);
      }
      setState({ kind: "listening", final: finalRef.current, interim });
    };
    recognition.onerror = (event) => {
      const rawTranscript = finalRef.current;
      cleanup(true);
      setState({ kind: "error", code: event.error || "recognition_error", rawTranscript });
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!stoppingRef.current) setState({ kind: "error", code: "recognition_ended", rawTranscript: finalRef.current });
    };
    try {
      recognition.start();
      setState({ kind: "listening", final: "", interim: "" });
      return true;
    } catch {
      cleanup(true);
      setState({ kind: "error", code: "start_failed", rawTranscript: finalRef.current });
      return false;
    }
  }, [cleanup, language]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    const rawTranscript = finalRef.current;
    cleanup(false);
    setState({ kind: "stopped", rawTranscript });
    return rawTranscript;
  }, [cleanup]);

  const reset = useCallback(() => {
    stoppingRef.current = true;
    cleanup(true);
    finalRef.current = "";
    setState(supported ? { kind: "idle" } : { kind: "unsupported" });
  }, [cleanup, supported]);

  useEffect(() => () => {
    stoppingRef.current = true;
    cleanup(true);
  }, [cleanup]);

  const liveTranscript = state.kind === "listening" ? join(state.final, state.interim)
    : state.kind === "stopped" || state.kind === "error" ? state.rawTranscript : "";
  return { state, supported, liveTranscript, start, stop, reset };
}
