"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { failureMessage, requestJson, type FailureMessages } from "@/lib/http/client-request";

/**
 * Start a NEW attempt on the same section.
 *
 * The learner stays on the section's own address — one section is one exercise, and its URL is
 * the section, not the attempt. The API's `POST /api/listening/attempts` resumes an open attempt
 * and creates one otherwise, so a retake after a finished attempt is exactly one new attempt and
 * a retake while one is open simply returns to it. `refresh()` re-reads the server view, which is
 * what switches the screen back to the exercise.
 *
 * Truthful by construction: the button reports nothing until the server has answered, and a
 * failure shows the real message instead of pretending the attempt started.
 */
export function SectionRetakeButton({
  sectionId,
  label,
  messages,
}: {
  sectionId: string;
  label: string;
  messages: FailureMessages;
}) {
  const router = useRouter();
  const flight = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { flight.current?.abort(); }, []);

  async function retake() {
    if (flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setPending(true);
    setError(null);
    try {
      const result = await requestJson<{ id: string }>("/api/listening/attempts", {
        body: { testId: sectionId },
        signal: controller.signal,
        timeoutMs: 12_000,
      });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setError(failureMessage(result, messages));
        return;
      }
      router.refresh();
    } finally {
      if (flight.current === controller) flight.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" disabled={pending} onClick={() => void retake()} data-listening-section-retake>
        {pending ? "…" : label}
      </Button>
      {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
    </div>
  );
}
