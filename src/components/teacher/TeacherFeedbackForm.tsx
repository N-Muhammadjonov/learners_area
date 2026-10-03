"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Textarea, Input, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";

export function TeacherFeedbackForm({ dict, submissionId }: { dict: Dictionary; submissionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [band, setBand] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) return <p className="text-sm text-band-good">{dict.teacher.feedbackSent} ✓</p>;
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {dict.teacher.leaveFeedback}
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const res = await fetch("/api/teacher/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submissionId, comment, overallBand: band || undefined }),
        });
        setPending(false);
        if (res.ok) {
          setSent(true);
          router.refresh();
        }
      }}
    >
      <Label htmlFor={`comment-${submissionId}`}>{dict.teacher.leaveFeedback}</Label>
      <Textarea id={`comment-${submissionId}`} required value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-[100px]" />
      <Input type="number" step={0.5} min={0} max={9} placeholder={dict.formCopy.overallBandOptional} value={band} onChange={(e) => setBand(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
