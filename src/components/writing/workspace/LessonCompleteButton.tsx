"use client";
import { useScopedRequest } from "@/lib/http/use-scoped-request";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function LessonCompleteButton({ id, done, label, doneLabel }: { id: string; done: boolean; label: string; doneLabel: string }) {
  const request = useScopedRequest();
  const [state, setState] = useState<"idle" | "busy" | "done">(done ? "done" : "idle");
  if (state === "done") return <p className="text-sm font-medium text-band-good" data-lesson-done>{doneLabel}</p>;
  return (
    <div><Button disabled={state === "busy"} data-lesson-complete onClick={async () => {
      setState("busy");
      const res = await request<Record<string, unknown>>(`/api/writing/lessons/${id}`, {method: "POST", timeoutMs: 25000}).catch(() => null);
      if (!res) return;
      setState(res?.ok ? "done" : "idle");
    }}>{label}</Button></div>
  );
}
