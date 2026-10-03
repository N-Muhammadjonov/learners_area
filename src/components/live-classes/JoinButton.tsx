"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatTime } from "@/lib/time";

type JoinState = "open" | "too_early" | "closed" | "cancelled";

/**
 * The join control, in the state the server says the class is in.
 *
 * A button that always says "Join" and silently fails is worse than no button:
 * before the window the student sees when the room opens, after it they are sent
 * to the recording instead, and a cancelled class says so.
 */
export function JoinButton({
  liveClassId,
  meetingUrl,
  label,
  joinedLabel,
  alreadyJoined,
  state,
  opensAtLabel,
  watchedLabel,
  cancelledLabel,
}: {
  liveClassId: string;
  meetingUrl: string | null;
  label: string;
  joinedLabel: string;
  alreadyJoined: boolean;
  state: JoinState;
  opensAtLabel: string;
  watchedLabel: string;
  cancelledLabel: string;
}) {
  const requestResponse = useScopedResponse(25000);

  const [joined, setJoined] = useState(alreadyJoined);
  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state === "cancelled") {
    return <span className="text-xs text-ink-300" data-live-cancelled>{cancelledLabel}</span>;
  }

  if (state === "closed" && !joined) {
    return <span className="text-xs text-ink-300" data-live-closed>{watchedLabel}</span>;
  }

  if (joined) {
    return meetingUrl ? (
      <a href={meetingUrl} target="_blank" rel="noreferrer" className="btn-primary" data-live-open-room>
        {label}
      </a>
    ) : (
      <span className="text-xs text-band-good" data-live-attended>
        {joinedLabel}
        {joinedAt ? ` · ${formatTime(joinedAt)}` : ""} ✓
      </span>
    );
  }

  if (state === "too_early") {
    return <span className="text-xs text-ink-300" data-live-opens-at>{opensAtLabel}</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={pending}
        data-live-join
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await requestResponse(`/api/live-classes/${liveClassId}/join`, { method: "POST" });
    if (!res) return;
          setPending(false);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setError(body.error === "too_early" ? opensAtLabel : watchedLabel);
            return;
          }
          const body = await res.json().catch(() => ({}));
          setJoined(true);
          if (body.joinedAt) setJoinedAt(body.joinedAt);
          if (meetingUrl) window.open(meetingUrl, "_blank");
        }}
      >
        {pending ? "…" : label}
      </Button>
      {error && (
        <span className="text-xs text-band-warn" data-live-join-error>
          {error}
        </span>
      )}
    </div>
  );
}
