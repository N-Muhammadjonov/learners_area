"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  runMicrophoneCheck,
  type MicrophoneCheckErrorCode,
  type MicrophoneCheckStatus,
} from "@/lib/audio/microphone-check";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The microphone check gate before a Practice with AI session (spec §8).
 *
 * It must not be a formality. A learner who is told "microphone ready" and then
 * records silence loses their answer, so this panel measures real audio energy
 * and refuses to pass on room tone. The three outcomes are kept distinct in the
 * copy — unsupported browser, permission refused, no sound detected — because the
 * fix is different for each.
 *
 * The check is entirely local: nothing is uploaded, no attempt is created, and
 * the microphone is released before the child screen appears.
 */
export function MicrophoneCheckPanel({
  dict,
  onPassed,
  onSkip,
}: {
  dict: Dictionary;
  /** Called once the check has genuinely passed. */
  onPassed: () => void;
  /** Some browsers deny getUserMedia in embedded frames; the session still waits. */
  onSkip?: () => void;
}) {
  const t = dict.speakingAi.mic;
  const [status, setStatus] = useState<MicrophoneCheckStatus>("idle");
  const [level, setLevel] = useState(0);
  const [errorCode, setErrorCode] = useState<MicrophoneCheckErrorCode | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const run = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setErrorCode(null);
    setLevel(0);
    // The status vocabulary and its transitions belong to runMicrophoneCheck,
    // which reports "requesting_permission" itself before it touches
    // getUserMedia. Setting it here too would be a second source of truth for
    // the same state — and pushing a raw status literal into rendered state is
    // exactly what the UI-copy guard forbids.

    const outcome = await runMicrophoneCheck({
      signal: controller.signal,
      onStatus: (next) => { if (aliveRef.current) setStatus(next); },
      onLevel: (next) => { if (aliveRef.current) setLevel(next); },
    });
    if (!aliveRef.current || controller.signal.aborted) return;
    controllerRef.current = null;

    if (outcome.status === "passed") {
      setStatus("passed");
      setLevel(0);
      onPassed();
      return;
    }
    if (outcome.status === "denied") { setStatus("denied"); return; }
    if (outcome.status === "unsupported") { setStatus("unsupported"); return; }
    setErrorCode(outcome.code);
    setStatus(outcome.code === "aborted" ? "idle" : "error");
  }, [onPassed]);

  const running = status === "requesting_permission" || status === "checking";

  return (
    <Card className="flex flex-col gap-4" data-mic-check={status}>
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg text-ink-900">{t.title}</p>
        <p className="text-sm text-ink-500">{t.body}</p>
      </div>

      {status === "checking" && (
        <div className="flex flex-col gap-2" data-mic-level>
          <p className="text-sm text-ink-700">{t.speakNow}</p>
          {/* The meter is real measured RMS, not a decorative animation: it is how
              the learner can see their voice arriving without being recorded. */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-signal-500 transition-[width] duration-75"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
        </div>
      )}

      {status === "requesting_permission" && <p className="text-sm text-ink-500">{t.asking}</p>}

      {status === "denied" && (
        <div className="rounded-md border border-band-warn/40 bg-band-warn/10 p-3 text-sm text-ink-700" role="alert" data-mic-error="denied">
          <p className="font-medium text-ink-900">{t.deniedTitle}</p>
          <p className="mt-1">{t.deniedBody}</p>
        </div>
      )}

      {status === "unsupported" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-ink-700 dark:bg-amber-950/30" role="alert" data-mic-error="unsupported">
          <p className="font-medium text-ink-900">{t.unsupportedTitle}</p>
          <p className="mt-1">{t.unsupportedBody}</p>
        </div>
      )}

      {status === "error" && errorCode && (
        <div className="rounded-md border border-band-warn/40 bg-band-warn/10 p-3 text-sm text-ink-700" role="alert" data-mic-error={errorCode}>
          <p className="font-medium text-ink-900">{t.failedTitle}</p>
          <p className="mt-1">{errorCode === "no_input" ? t.msg.no_input : t.msg[errorCode]}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void run()} disabled={running} data-mic-start>
          {status === "idle" ? t.start : t.retry}
        </Button>
        {onSkip && status !== "passed" && (
          <Button variant="ghost" onClick={onSkip} disabled={running} data-mic-skip>
            {t.skip}
          </Button>
        )}
      </div>

      <p className="text-xs text-ink-300">{t.privacy}</p>
    </Card>
  );
}
