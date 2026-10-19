"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOptionalInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import { Button } from "@/components/ui/Button";
import { requestJson, failureMessage } from "@/lib/http/client-request";
import { dictionaryForDocument } from "@/lib/i18n/client";

/**
 * Starts (or restarts) an attempt on one passage.
 *
 * The button has exactly two jobs: never leave the reader looking at a spinner
 * that will not end, and never let a failure pass silently. Both come from the
 * same rule — the request goes through `requestJson`, which cannot throw, and
 * the pending state is cleared in `finally`, which runs whatever happened.
 */
export function StartPassageButton({
  passageId,
  setId,
  label,
  requestedType,
  variant = "secondary",
}: {
  passageId?: string;
  setId?: string;
  label: string;
  requestedType?:string;
  variant?: "primary" | "secondary";
}) {
  const interaction = useOptionalInstantInteraction();
  const router = useRouter();
  const dict = dictionaryForDocument();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex flex-col items-start gap-1">
      <Button
        variant={variant}
        disabled={pending}
        data-passage-action="start"
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const result = await requestJson<{ id: string }>(setId ? "/api/reading/academic" : "/api/reading/attempts", {
              method: "POST",
              body: setId ? { setId } : { passageId },
            });
            if (result.ok && result.data?.id) {
              const href = `/app/reading/attempts/${result.data.id}${requestedType ? `?type=${encodeURIComponent(requestedType)}` : ""}`;
              if (interaction) interaction.navigate(href);
              else router.push(href);
              return;
            }
            setError(
              !result.ok
                ? failureMessage(result, dict.auth, { unknown: dict.errors.unknown })
                : dict.errors.unknown
            );
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? dict.loadingPage.label : label}
      </Button>
      {error && (
        <span className="text-[0.8125rem] text-band-bad" data-passage-action-error>
          {error}
        </span>
      )}
    </span>
  );
}
