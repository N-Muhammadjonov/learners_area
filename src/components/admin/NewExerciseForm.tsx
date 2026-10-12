"use client";

import { useRef, useState } from "react";
import { useScopedRequest } from "@/lib/http/use-scoped-request";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";
import { apiErrorMessage } from "@/lib/api-error-message";

export function NewExerciseForm({ dict, topicId }: { dict: Dictionary; topicId: string }) {
  const router = useRouter();
  const request = useScopedRequest();
  const flight = useRef(false);
  const [open, setOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctOption, setCorrectOption] = useState("");
  const [explanation, setExplanation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>+ {dict.admin.newExercise}</Button>;

  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (flight.current) return;
        flight.current = true; setPending(true); setError("");
        const res = await request(`/api/admin/grammar/topics/${topicId}/exercises`, {body: {promptText, options: cleanOptions, correctOption, explanation}});
        flight.current = false;
        if (!res) return;
        setPending(false);
        if (res.ok) {
          setOpen(false); setPromptText(""); setOptions(["", "", "", ""]);
          setCorrectOption(""); setExplanation(""); router.refresh();
        } else setError(apiErrorMessage(res.error, res.status, dict));
      }}
    >
      <div>
        <Label htmlFor="promptText">{dict.formCopy.sentenceWithError}</Label>
        <Textarea id="promptText" required value={promptText} onChange={(e) => setPromptText(e.target.value)} className="min-h-[60px]" />
      </div>
      <div className="flex flex-col gap-2">
        <Label>{dict.formCopy.options}</Label>
        {options.map((opt, i) => (
          <Input
            key={i}
            placeholder={`Option ${i + 1}`}
            value={opt}
            onChange={(e) => setOptions((prev) => prev.map((o, idx) => (idx === i ? e.target.value : o)))}
          />
        ))}
      </div>
      <div>
        <Label htmlFor="correctOption">{dict.formCopy.correctOptionExact}</Label>
        <select id="correctOption" className="input" value={correctOption} onChange={(e) => setCorrectOption(e.target.value)}>
          <option value="">—</option>
          {cleanOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="explanation">{dict.formCopy.explanation}</Label>
        <Textarea id="explanation" required value={explanation} onChange={(e) => setExplanation(e.target.value)} className="min-h-[60px]" />
      </div>
      {error && <p className="text-sm text-band-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
