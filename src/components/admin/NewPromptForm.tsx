"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";

export function NewPromptForm({ dict }: { dict: Dictionary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [taskType, setTaskType] = useState<"task1" | "task2">("task2");
  const [category, setCategory] = useState("");
  const [prompt, setPrompt] = useState("");
  const [targetWordCount, setTargetWordCount] = useState("250");
  const [pending, setPending] = useState(false);

  if (!open) {
    return <Button variant="secondary" onClick={() => setOpen(true)}>+ {dict.admin.newPrompt}</Button>;
  }

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        await fetch("/api/admin/writing-prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskType, category, prompt, targetWordCount }),
        });
        setPending(false);
        setOpen(false);
        setCategory("");
        setPrompt("");
        router.refresh();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="taskType">Task type</Label>
          <select id="taskType" className="input" value={taskType} onChange={(e) => setTaskType(e.target.value as "task1" | "task2")}>
            <option value="task1">{dict.writing.task1}</option>
            <option value="task2">{dict.writing.task2}</option>
          </select>
        </div>
        <div>
          <Label htmlFor="category">Category</Label>
          <Input id="category" required value={category} onChange={(e) => setCategory(e.target.value)} placeholder="opinion, problem-solution…" />
        </div>
      </div>
      <div>
        <Label htmlFor="prompt">Prompt</Label>
        <Textarea id="prompt" required value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="targetWordCount">Target word count</Label>
        <Input id="targetWordCount" type="number" min={50} max={500} value={targetWordCount} onChange={(e) => setTargetWordCount(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
