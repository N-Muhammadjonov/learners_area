"use client";

import { useState } from "react";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";

export function NewTopicForm({ dict }: { dict: Dictionary }) {
  const { navigate } = useInstantInteraction();
  const [open, setOpen] = useState(false);
  const [skillArea, setSkillArea] = useState<"writing" | "speaking">("writing");
  const [title, setTitle] = useState("");
  const [explanation, setExplanation] = useState("");
  const [pending, setPending] = useState(false);

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>+ {dict.admin.newTopic}</Button>;

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const res = await fetch("/api/admin/grammar/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skillArea, title, explanation }),
        });
        setPending(false);
        if (res.ok) {
          const data = await res.json();
          navigate(`/admin/grammar/${data.id}`);
        }
      }}
    >
      <div>
        <Label htmlFor="skillArea">Skill area</Label>
        <select id="skillArea" className="input" value={skillArea} onChange={(e) => setSkillArea(e.target.value as "writing" | "speaking")}>
          <option value="writing">Writing</option>
          <option value="speaking">Speaking</option>
        </select>
      </div>
      <div>
        <Label htmlFor="title">Title</Label>
        <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="explanation">Explanation</Label>
        <Textarea id="explanation" required value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
