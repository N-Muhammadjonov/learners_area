"use client";

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * Read the passage aloud with the browser's own voice.
 *
 * This is a reading aid, not an assessment: it uses the local speech synthesiser,
 * so there is no pronunciation score attached to it and it works offline. If the
 * browser has no voice, the control says so instead of pretending.
 */
export function ReadAloud({ dict, text }: { dict: Dictionary; text: string }) {
  const [state, setState] = useState<"idle" | "speaking" | "unsupported">("idle");

  if (state === "unsupported") {
    return <span className="text-xs text-ink-300">{dict.reading.readAloudUnsupported}</span>;
  }

  return (
    <button
      type="button"
      className="btn-ghost min-h-[44px] text-xs"
      data-read-aloud
      title={dict.readingPractice.readAloudHint}
      onClick={() => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) {
          setState("unsupported");
          return;
        }
        if (state === "speaking") {
          window.speechSynthesis.cancel();
          setState("idle");
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-GB";
        utterance.onend = () => setState("idle");
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        setState("speaking");
      }}
    >
      {state === "speaking" ? dict.reading.readAloudStop : dict.reading.readAloud}
    </button>
  );
}
