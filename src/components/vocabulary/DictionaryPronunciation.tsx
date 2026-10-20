"use client";

import { useEffect, useRef, useState } from "react";

export function DictionaryPronunciation({ word, label, unavailable }: { word: string; label: string; unavailable: string }) {
  const [state, setState] = useState<"idle" | "playing" | "unavailable">("idle");
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  useEffect(() => () => {
    if (!current.current) return;
    current.current.onend = null;
    current.current.onerror = null;
    window.speechSynthesis?.cancel();
    current.current = null;
  }, []);

  function pronounce() {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setState("unavailable");
      return;
    }
    try {
      const synthesis = window.speechSynthesis;
      const utterance = new window.SpeechSynthesisUtterance(word);
      utterance.lang = "en-GB";
      const voices = synthesis.getVoices();
      const voice = voices.find(item => item.localService && /^en[-_]GB$/i.test(item.lang))
        ?? voices.find(item => item.localService && /^en\b/i.test(item.lang));
      if (voice) utterance.voice = voice;
      utterance.onend = () => {
        if (current.current !== utterance) return;
        current.current = null;
        setState("idle");
      };
      utterance.onerror = event => {
        if (current.current !== utterance) return;
        current.current = null;
        setState(event.error === "canceled" || event.error === "interrupted" ? "idle" : "unavailable");
      };
      synthesis.cancel();
      current.current = utterance;
      setState("playing");
      synthesis.speak(utterance);
    } catch {
      current.current = null;
      setState("unavailable");
    }
  }

  return <span className="dictionary-pronunciation">
    <button type="button" className="dictionary-pronounce" aria-label={`${label}: ${word}`} title={`${label}: ${word}`} aria-pressed={state === "playing"} onClick={pronounce}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></svg>
    </button>
    {state === "unavailable" && <span role="status">{unavailable}</span>}
  </span>;
}
