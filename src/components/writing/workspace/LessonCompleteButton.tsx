"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function LessonCompleteButton({ id, done, label, doneLabel }: { id: string; done: boolean; label: string; doneLabel: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">(done ? "done" : "idle");
  if (state === "done") return <p className="text-sm font-medium text-band-good" data-lesson-done>{doneLabel}</p>;
  return (
    <div><Button disabled={state === "busy"} data-lesson-complete onClick={async () => {
      setState("busy");
      const res = await fetch(`/api/writing/lessons/${id}`, { method: "POST" }).catch(() => null);
      setState(res?.ok ? "done" : "idle");
    }}>{label}</Button></div>
  );
}
