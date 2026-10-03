"use client";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

import { useState } from "react";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import { Button } from "@/components/ui/Button";

export function StartPromptButton({ promptId, label, errorLabel }: { promptId: string; label: string; errorLabel: string }) {
  const request = useScopedRequest();
  const [error, setError] = useState(false);
  const { navigate } = useInstantInteraction();
  const [pending, setPending] = useState(false);

  return (
    <div>
    {error && <p role="alert">{errorLabel}</p>}
    <Button
      variant="secondary"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const res = await request<{id: string}>("/api/writing/submissions", {body: {promptId}});
        if (!res) return;
        if (res.ok && res.data?.id) navigate(`/writing/submissions/${res.data.id}`); else setError(true);
        setPending(false);
      }}
    >
      {pending ? "…" : label}
    </Button>
    </div>
  );
}
