"use client";

import { privateResources } from "@/lib/client/private-resource";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";

export function AddVocabQuick({ dict, sourceId }: { dict: Dictionary; sourceId: string }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [definition, setDefinition] = useState("");
  const [done, setDone] = useState(false);

  if (done) {
    return <p className="text-sm text-band-good">{dict.common.saved} ✓</p>;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-signal-600 hover:underline">
        + {dict.writing.addToVocab}
      </button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/vocabulary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term, definitionEn: definition, sourceType: "writing_feedback", sourceId }),
        });
        if (res.ok) {
          privateResources.invalidate("vocabulary:");
          setDone(true);
        }
      }}
    >
      <Input placeholder="word / phrase" required value={term} onChange={(e) => setTerm(e.target.value)} className="w-40" />
      <Input placeholder="meaning" required value={definition} onChange={(e) => setDefinition(e.target.value)} className="w-48" />
      <Button type="submit" variant="secondary" className="py-1.5 text-xs">
        {dict.common.save}
      </Button>
    </form>
  );
}
