"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBrowserStt,
  isBrowserSttSupported,
  type BrowserSttController,
  type BrowserSttState,
} from "@/lib/audio/browser-stt";

/**
 * React binding for the browser speech-recognition controller.
 *
 * The controller itself is framework-free and unit-tested; this only owns its
 * lifetime. Two details matter:
 *
 *  - CAPABILITY IS PROBED AFTER MOUNT. Reading `window.SpeechRecognition` during
 *    render would make the server and the first client render disagree
 *    ("unsupported" on the server, real support in the browser) and React would
 *    report a hydration mismatch. `supported` therefore stays false until the
 *    effect runs, and `mounted` lets the UI withhold a verdict until then.
 *
 *  - THE CONTROLLER IS ALWAYS RELEASED. On unmount every recognition listener is
 *    detached and any live recognizer is aborted, so a learner who navigates away
 *    mid-answer does not leave a listening session running.
 */
export function useBrowserTranscript() {
  const [mounted, setMounted] = useState(false);
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<BrowserSttState>({ kind: "idle" });
  const controllerRef = useRef<BrowserSttController | null>(null);

  useEffect(() => {
    setMounted(true);
    setSupported(isBrowserSttSupported());
  }, []);

  useEffect(
    () => () => {
      controllerRef.current?.release();
      controllerRef.current = null;
    },
    [],
  );

  const ensure = useCallback((): BrowserSttController => {
    if (!controllerRef.current) {
      controllerRef.current = createBrowserStt({ onChange: (next) => setState(next) });
    }
    return controllerRef.current;
  }, []);

  const start = useCallback(() => { ensure().start(); }, [ensure]);
  const stop = useCallback((): string => ensure().stop(), [ensure]);
  const abort = useCallback(() => { controllerRef.current?.abort(); }, []);
  const raw = useCallback((): string => controllerRef.current?.rawTranscript() ?? "", []);

  /** Drops the current take entirely and forgets the controller (Clear/re-record). */
  const discard = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current?.release();
    controllerRef.current = null;
    setState({ kind: "idle" });
  }, []);

  return { mounted, supported, state, start, stop, abort, raw, discard };
}
