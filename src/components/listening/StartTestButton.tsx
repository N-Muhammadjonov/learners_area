"use client";

import { useEffect, useRef, useState } from "react";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import { Button } from "@/components/ui/Button";
import { failureMessage, requestJson, type FailureMessages } from "@/lib/http/client-request";
import { isUuid } from "@/lib/validation/ids";

export function StartTestButton({ testId, label, messages }: { testId: string; label: string; messages: FailureMessages }) {
  const { navigate } = useInstantInteraction();
  const flight = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { flight.current?.abort(); }, []);
  async function start() {
    if (flight.current) return;
    const controller = new AbortController(); flight.current = controller;
    setPending(true); setError(null);
    try {
      const result = await requestJson<{ id: string }>("/api/listening/attempts", { body: { testId }, signal: controller.signal, timeoutMs: 12_000 });
      if (controller.signal.aborted) return;
      if (!result.ok) { setError(failureMessage(result, messages)); return; }
      if (!isUuid(result.data?.id)) { setError(messages.errorServer); return; }
      navigate(`/listening/attempts/${result.data.id}`);
    } finally {
      if (flight.current === controller) flight.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return <div className="flex flex-col gap-2">
    <Button variant="secondary" disabled={pending} onClick={() => void start()}>{pending ? "…" : label}</Button>
    {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
  </div>;
}
