"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { Dictionary } from "@/lib/i18n/en";
import { apiErrorMessage } from "@/lib/api-error-message";

/**
 * Adds a student-typed transcript to an attempt that has none, which is what
 * makes Coach feedback on a recording possible before any speech-to-text vendor
 * is configured. The field posts as `manualTranscript` — the API has no
 * `transcript` field to write to, so a client can never fabricate machine
 * transcription.
 */
export function ManualTranscriptForm({ dict, attemptId }: { dict: Dictionary; attemptId: string }) {
  const t = dict.speakingPractice;
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/speaking/attempts/${attemptId}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualTranscript: text.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(apiErrorMessage(data.error, res.status, dict));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm bg-paper-sunken p-3">
      <p className="text-xs text-ink-400">{t.noTranscriptNotice}</p>
      <label htmlFor={`transcript-${attemptId}`} className="text-sm font-medium text-ink-700">
        {t.manualTranscriptLabel}
      </label>
      <textarea
        id={`transcript-${attemptId}`}
        className="input min-h-[90px]"
        value={text}
        disabled={busy || saved}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="text-xs text-ink-300">{t.manualTranscriptHint}</p>
      {error && <p className="text-xs text-band-bad">{error}</p>}
      {saved && <p className="text-xs text-band-good">{t.manualTranscriptSaved}</p>}
      <div>
        <Button
          variant="secondary"
          disabled={busy || saved || text.trim().length < 10}
          onClick={() => void submit()}
        >
          {busy ? dict.common.saving : dict.common.save}
        </Button>
      </div>
    </div>
  );
}
