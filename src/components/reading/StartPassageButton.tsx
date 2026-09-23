"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function StartPassageButton({ passageId, label }: { passageId: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const res = await fetch("/api/reading/attempts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passageId }),
        });
        const data = await res.json();
        if (res.ok) router.push(`/reading/attempts/${data.id}`);
        setPending(false);
      }}
    >
      {pending ? "…" : label}
    </Button>
  );
}
