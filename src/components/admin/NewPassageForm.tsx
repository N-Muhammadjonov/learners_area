"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";

export function NewPassageForm({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [difficultyLevel, setDifficultyLevel] = useState("B2");
  const [suggestedMinutes, setSuggestedMinutes] = useState("15");
  const [pending, setPending] = useState(false);

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>+ {dict.admin.newPassage}</Button>;

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const res = await fetch("/api/admin/reading/passages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, bodyText, difficultyLevel, suggestedMinutes }),
        });
        setPending(false);
        if (res.ok) {
          const data = await res.json();
          router.push(`/admin/reading/${data.id}`);
        }
      }}
    >
      <div>
        <Label htmlFor="title">Title</Label>
        <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="bodyText">Passage text</Label>
        <Textarea id="bodyText" required value={bodyText} onChange={(e) => setBodyText(e.target.value)} className="min-h-[200px]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="difficultyLevel">Level</Label>
          <select id="difficultyLevel" className="input" value={difficultyLevel} onChange={(e) => setDifficultyLevel(e.target.value)}>
            {["A2", "B1", "B2", "C1", "C2"].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="suggestedMinutes">Minutes</Label>
          <Input id="suggestedMinutes" type="number" min={5} max={90} value={suggestedMinutes} onChange={(e) => setSuggestedMinutes(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
