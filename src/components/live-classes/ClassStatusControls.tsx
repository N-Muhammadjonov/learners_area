"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";

export function ClassStatusControls({
  dict,
  liveClassId,
  status,
}: {
  dict: Dictionary;
  liveClassId: string;
  status: "upcoming" | "live" | "completed" | "recorded" | "cancelled";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState("");

  async function patch(body: Record<string, string>) {
    setPending(true);
    await fetch(`/api/teacher/live-classes/${liveClassId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "upcoming" && (
        <Button variant="secondary" disabled={pending} onClick={() => patch({ status: "live" })}>
          {dict.liveClasses.markLive}
        </Button>
      )}
      {status === "live" && (
        <Button variant="secondary" disabled={pending} onClick={() => patch({ status: "completed" })}>
          {dict.liveClasses.markCompleted}
        </Button>
      )}
      {(status === "completed" || status === "recorded") && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            patch({ recordingUrl, status: "recorded" });
          }}
        >
          <Input
            placeholder="https://... recording"
            value={recordingUrl}
            onChange={(e) => setRecordingUrl(e.target.value)}
            className="w-56"
          />
          <Button type="submit" variant="secondary" disabled={pending || !recordingUrl}>
            {dict.liveClasses.addRecording}
          </Button>
        </form>
      )}
    </div>
  );
}
