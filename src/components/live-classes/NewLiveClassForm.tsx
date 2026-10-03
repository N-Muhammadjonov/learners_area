"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";
import { apiErrorMessage } from "@/lib/api-error-message";

export function NewLiveClassForm({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>+ {dict.liveClasses.newClass}</Button>;

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError("");
        const res = await fetch("/api/teacher/live-classes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            topic: topic || undefined,
            scheduledAt: new Date(scheduledAt).toISOString(),
            durationMinutes,
            meetingUrl: meetingUrl || undefined,
          }),
        });
        setPending(false);
        if (res.ok) {
          setOpen(false);
          setTitle("");
          setTopic("");
          setScheduledAt("");
          setMeetingUrl("");
          router.refresh();
        } else {
          const data = await res.json();
          setError(apiErrorMessage(data.error, res.status, dict));
        }
      }}
    >
      <div>
        <Label htmlFor="title">{dict.formCopy.title}</Label>
        <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="topic">{dict.formCopy.topicOptional}</Label>
        <Textarea id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} className="min-h-[60px]" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="scheduledAt">{dict.formCopy.dateTime}</Label>
          <Input id="scheduledAt" type="datetime-local" required value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="durationMinutes">{dict.formCopy.durationMin}</Label>
          <Input id="durationMinutes" type="number" min={15} max={240} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="meetingUrl">{dict.formCopy.meetingLinkOptional}</Label>
        <Input id="meetingUrl" type="url" placeholder="https://..." value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} />
      </div>
      {error && <p className="text-sm text-band-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
