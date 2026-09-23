"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";

export function AddWordForm({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [definitionEn, setDefinitionEn] = useState("");
  const [translationUz, setTranslationUz] = useState("");
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + {dict.vocabulary.addWord}
      </Button>
    );
  }

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        await fetch("/api/vocabulary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term, definitionEn, translationUz: translationUz || undefined }),
        });
        setPending(false);
        setTerm("");
        setDefinitionEn("");
        setTranslationUz("");
        setOpen(false);
        router.refresh();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input placeholder="word / phrase" required value={term} onChange={(e) => setTerm(e.target.value)} />
        <Input placeholder="English meaning" required value={definitionEn} onChange={(e) => setDefinitionEn(e.target.value)} />
        <Input placeholder="Uzbek (optional)" value={translationUz} onChange={(e) => setTranslationUz(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
