"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Label, Textarea } from "@/components/ui/Input";
import { failureMessage, requestJson } from "@/lib/http/client-request";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * "Ask to join" — the applicant's half of the admission workflow.
 *
 * The account id is never sent: the server reads it from the session, so a
 * crafted request cannot create an application for somebody else.
 */
export function AccessRequestForm({
  dict,
  alreadyRequested,
  canRequest,
}: {
  dict: Dictionary;
  alreadyRequested: boolean;
  canRequest: boolean;
}) {
  const t = dict.admission;
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!canRequest) {
    return <p className="text-sm text-ink-500">{t.requestOpen}</p>;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await requestJson("/api/admission/request", {
        body: { message: message.trim() || undefined },
      });
      if (!result.ok) {
        setError(failureMessage(result, { ...dict.auth, errorUnknown: dict.errors.unknown }));
        return;
      }
      setSent(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (sent || alreadyRequested) {
    return <p className="text-sm text-band-good">{t.requestSent}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="access-message">{t.messageLabel}</Label>
      <Textarea
        id="access-message"
        className="min-h-[90px]"
        placeholder={t.messagePlaceholder}
        value={message}
        disabled={busy}
        onChange={(event) => setMessage(event.target.value)}
      />
      <p className="text-xs text-ink-300">{t.contactHint}</p>
      {error && <p className="text-xs text-band-bad">{error}</p>}
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? dict.common.saving : t.requestButton}
      </Button>
    </div>
  );
}
