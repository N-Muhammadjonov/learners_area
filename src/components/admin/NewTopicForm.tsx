"use client";

import { useRef, useState } from "react";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import { apiErrorMessage } from "@/lib/api-error-message";
import type { Dictionary } from "@/lib/i18n/en";

export function NewTopicForm({ dict }: { dict: Dictionary }) {
  const { navigate } = useInstantInteraction();
  const request = useScopedRequest();
  const flight = useRef(false);
  const [open, setOpen] = useState(false);
  const [skillArea, setSkillArea] = useState<"writing" | "speaking">("writing");
  const [title, setTitle] = useState("");
  const [explanation, setExplanation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>+ {dict.admin.newTopic}</Button>;

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (flight.current) return;
        flight.current = true; setPending(true); setError("");
        const res = await request<{id: string}>("/api/admin/grammar/topics", {body: {skillArea, title, explanation}});
        flight.current = false;
        if (!res) return;
        setPending(false);
        if (res.ok && typeof res.data?.id === "string") navigate(`/admin/grammar/${res.data.id}`);
        else if (res.ok) setError(dict.apiErrors.generic);
        else setError(apiErrorMessage(res.error, res.status, dict));
      }}
    >
      <div>
        <Label htmlFor="skillArea">{dict.formCopy.skillArea}</Label>
        <select id="skillArea" className="input" value={skillArea} onChange={(e) => setSkillArea(e.target.value as "writing" | "speaking")}>
          <option value="writing">{dict.formCopy.writing}</option>
          <option value="speaking">{dict.formCopy.speaking}</option>
        </select>
      </div>
      <div>
        <Label htmlFor="title">{dict.formCopy.title}</Label>
        <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="explanation">{dict.formCopy.explanation}</Label>
        <Textarea id="explanation" required value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-band-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
