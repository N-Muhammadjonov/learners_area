"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";
import { apiErrorMessage } from "@/lib/api-error-message";

type QType = "multiple_choice" | "short_answer";

export function NewListeningQuestionForm({ dict, testId }: { dict: Dictionary; testId: string }) {
  const requestResponse = useScopedResponse(25000);

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<QType>("multiple_choice");
  const [questionText, setQuestionText] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>+ New question</Button>;

  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError("");
        const res = await requestResponse(`/api/admin/listening/tests/${testId}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            questionText,
            options: type === "multiple_choice" ? cleanOptions : undefined,
            correctAnswer,
            explanation,
          }),
        });
    if (!res) return;
        setPending(false);
        if (res.ok) {
          setOpen(false);
          setQuestionText("");
          setOptions(["", "", "", ""]);
          setCorrectAnswer("");
          setExplanation("");
          router.refresh();
        } else {
          const data = (await res.json().catch(() => ({}))) as { error?: unknown };
          setError(apiErrorMessage(data.error, res.status, dict));
        }
      }}
    >
      <div>
        <Label htmlFor="type">{dict.formCopy.type}</Label>
        <select id="type" className="input" value={type} onChange={(e) => setType(e.target.value as QType)}>
          <option value="multiple_choice">{dict.formCopy.multipleChoice}</option>
          <option value="short_answer">{dict.formCopy.shortAnswer}</option>
        </select>
      </div>

      <div>
        <Label htmlFor="questionText">{dict.formCopy.question}</Label>
        <Textarea id="questionText" required value={questionText} onChange={(e) => setQuestionText(e.target.value)} className="min-h-[70px]" />
      </div>

      {type === "multiple_choice" ? (
        <div className="flex flex-col gap-2">
          <Label>{dict.formCopy.options}</Label>
          {options.map((opt, i) => (
            <Input key={i} placeholder={`Option ${i + 1}`} value={opt} onChange={(e) => setOptions((prev) => prev.map((o, idx) => (idx === i ? e.target.value : o)))} />
          ))}
          <Label htmlFor="correctAnswerMcq">{dict.formCopy.correctOption}</Label>
          <select id="correctAnswerMcq" className="input" value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)}>
            <option value="">—</option>
            {cleanOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <Label htmlFor="correctAnswerShort">{dict.formCopy.correctAnswerExact}</Label>
          <Input id="correctAnswerShort" required value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} />
        </div>
      )}

      <div>
        <Label htmlFor="explanation">{dict.formCopy.explanation}</Label>
        <Textarea id="explanation" required value={explanation} onChange={(e) => setExplanation(e.target.value)} className="min-h-[60px]" />
      </div>

      {error && <p className="text-sm text-band-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
