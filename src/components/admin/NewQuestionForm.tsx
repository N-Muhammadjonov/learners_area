"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";
import { apiErrorMessage } from "@/lib/api-error-message";

type QType = "true_false_not_given" | "yes_no_not_given" | "multiple_choice" | "short_answer";

const TERNARY_OPTIONS: Record<"true_false_not_given" | "yes_no_not_given", { value: string; label: string }[]> = {
  true_false_not_given: [
    { value: "true", label: "True" },
    { value: "false", label: "False" },
    { value: "not_given", label: "Not Given" },
  ],
  yes_no_not_given: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
    { value: "not_given", label: "Not Given" },
  ],
};

export function NewQuestionForm({ dict, passageId }: { dict: Dictionary; passageId: string }) {
  const requestResponse = useScopedResponse(25000);

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<QType>("true_false_not_given");
  const [questionText, setQuestionText] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctAnswer, setCorrectAnswer] = useState("true");
  const [evidenceQuote, setEvidenceQuote] = useState("");
  const [explanation, setExplanation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>+ {dict.admin.newQuestion}</Button>;

  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError("");
        const res = await requestResponse(`/api/admin/reading/passages/${passageId}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            questionText,
            options: type === "multiple_choice" ? cleanOptions : undefined,
            correctAnswer,
            evidenceQuote: evidenceQuote || undefined,
            explanation,
          }),
        });
    if (!res) return;
        setPending(false);
        if (res.ok) {
          setOpen(false);
          setQuestionText("");
          setOptions(["", "", "", ""]);
          setEvidenceQuote("");
          setExplanation("");
          router.refresh();
        } else {
          const data = await res.json();
          setError(apiErrorMessage(data.error, res.status, dict));
        }
      }}
    >
      <div>
        <Label htmlFor="type">{dict.formCopy.questionType}</Label>
        <select
          id="type"
          className="input"
          value={type}
          onChange={(e) => {
            const next = e.target.value as QType;
            setType(next);
            setCorrectAnswer(next === "yes_no_not_given" ? "yes" : next === "true_false_not_given" ? "true" : "");
          }}
        >
          <option value="true_false_not_given">{dict.formCopy.tfng}</option>
          <option value="yes_no_not_given">{dict.formCopy.ynng}</option>
          <option value="multiple_choice">{dict.formCopy.multipleChoice}</option>
          <option value="short_answer">{dict.formCopy.shortAnswer}</option>
        </select>
      </div>

      <div>
        <Label htmlFor="questionText">{dict.formCopy.question}</Label>
        <Textarea id="questionText" required value={questionText} onChange={(e) => setQuestionText(e.target.value)} className="min-h-[80px]" />
      </div>

      {type === "multiple_choice" && (
        <div className="flex flex-col gap-2">
          <Label>{dict.formCopy.optionsFill}</Label>
          {options.map((opt, i) => (
            <Input
              key={i}
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => setOptions((prev) => prev.map((o, idx) => (idx === i ? e.target.value : o)))}
            />
          ))}
          <Label htmlFor="correctAnswerMcq">{dict.formCopy.correctOptionExact}</Label>
          <select id="correctAnswerMcq" className="input" value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)}>
            <option value="">—</option>
            {cleanOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      )}

      {(type === "true_false_not_given" || type === "yes_no_not_given") && (
        <div>
          <Label htmlFor="correctAnswerTernary">{dict.formCopy.correctAnswer}</Label>
          <select id="correctAnswerTernary" className="input" value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)}>
            {TERNARY_OPTIONS[type].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      {type === "short_answer" && (
        <div>
          <Label htmlFor="correctAnswerShort">{dict.formCopy.correctAnswerShort}</Label>
          <Input id="correctAnswerShort" required value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} />
        </div>
      )}

      <div>
        <Label htmlFor="evidenceQuote">{dict.formCopy.evidenceQuote}</Label>
        <Textarea id="evidenceQuote" value={evidenceQuote} onChange={(e) => setEvidenceQuote(e.target.value)} className="min-h-[60px]" />
      </div>
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
