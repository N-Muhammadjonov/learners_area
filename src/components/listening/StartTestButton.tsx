"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function StartTestButton({ testId, label }: { testId: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const res = await fetch("/api/listening/attempts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testId }),
        });
        const data = await res.json();
        if (res.ok) router.push(`/listening/attempts/${data.id}`);
        setPending(false);
      }}
    >
      {pending ? "…" : label}
    </Button>
  );
}
