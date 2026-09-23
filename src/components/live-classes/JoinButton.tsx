"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function JoinButton({
  liveClassId,
  meetingUrl,
  label,
  joinedLabel,
  alreadyJoined,
}: {
  liveClassId: string;
  meetingUrl: string | null;
  label: string;
  joinedLabel: string;
  alreadyJoined: boolean;
}) {
  const [joined, setJoined] = useState(alreadyJoined);
  const [pending, setPending] = useState(false);

  if (joined) {
    return meetingUrl ? (
      <a href={meetingUrl} target="_blank" rel="noreferrer" className="btn-primary">
        {label}
      </a>
    ) : (
      <span className="text-xs text-band-good">{joinedLabel} ✓</span>
    );
  }

  return (
    <Button
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch(`/api/live-classes/${liveClassId}/join`, { method: "POST" });
        setPending(false);
        setJoined(true);
        if (meetingUrl) window.open(meetingUrl, "_blank");
      }}
    >
      {pending ? "…" : label}
    </Button>
  );
}
