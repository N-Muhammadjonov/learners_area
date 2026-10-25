"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import type { PublicationState } from "@/lib/services/cms/publication";

/**
 * The staff control over whether content is live — one component for every
 * content type, because every type goes through the same endpoint and the same
 * rule.
 *
 * The state is not decided here: the server validates the transition, refuses a
 * schedule without a moment, and writes an audit row. This control only collects
 * the intent and reports what the server said, including a refusal.
 */
export function PublicationControl({
  type,
  id,
  state,
  publishAt,
  dict,
  issueLabels,
}: {
  type: string;
  id: string;
  state: PublicationState;
  publishAt: string | null;
  dict: Dictionary;
  /** Localized sentences for server publish-blocker codes (Writing Management). Raw codes are never shown. */
  issueLabels?: Record<string, string>;
}) {
  const requestResponse = useScopedResponse(25000);

  const t = dict.admin.publication;
  const router = useRouter();
  const [next, setNext] = useState<PublicationState>(state);
  // `datetime-local` wants `YYYY-MM-DDTHH:mm` in the reader's own timezone; the
  // stored value is UTC, so it is converted for display and back on save.
  const [moment, setMoment] = useState(() => toLocalInput(publishAt));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"saved" | "error" | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  async function save() {
    setBusy(true);
    setMessage(null);
    const response = await requestResponse(`/api/admin/content/${type}/${id}/publication`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: next,
        publishAt: next === "scheduled" && moment ? new Date(moment).toISOString() : null,
      }),
    }).catch(() => null);
    if (!response) return;
    setBusy(false);
    setIssues([]);
    if (!response || !response.ok) {
      const data = response
        ? ((await response.json().catch(() => null)) as {
            error?: string;
            required?: number;
            present?: number;
            issues?: string[];
            blockers?: { kind?: string; section?: number }[];
          } | null)
        : null;
      if (data?.error === "incomplete_mcq_day") {
        /*
         * An MCQ programme day: the rule is stated in the reader's own language, and the day's
         * specific problems follow as sentences (each names the question it is about). The English
         * sentences are the same ones the import desk shows, so staff read one vocabulary.
         */
        setIssues([
          dict.listening.mcqProgram.publishRequiresFive,
          ...(typeof data.present === "number" && typeof data.required === "number"
            ? [dict.listening.mcqProgram.publishHolds.replace("{present}", String(data.present)).replace("{required}", String(data.required))]
            : []),
          ...(data.issues ?? []),
        ]);
      } else if (data?.blockers?.length) {
        // Listening publish gate: structured, localized here (the English `issues` are log text only).
        const l = dict.listeningImport;
        setIssues(
          data.blockers.map((b) =>
            (b.kind === "transcript_missing" ? l.blockMissing : l.blockReview).replace("{n}", String(b.section ?? "?")),
          ),
        );
      } else if (issueLabels && data?.issues?.length)
        setIssues(data.issues.map((code) => issueLabels[code]).filter((x): x is string => Boolean(x)));
      setMessage("error");
      return;
    }
    setMessage("saved");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-publication-control={id}>
      <span className={`badge ${badgeClass(state)}`} data-publication-state={state}>
        {t.states[state]}
      </span>
      <select
        className="input max-w-[9rem] py-1 text-xs"
        aria-label={t.changeState}
        value={next}
        onChange={(event) => {
          setNext(event.target.value as PublicationState);
          setMessage(null);
        }}
      >
        <option value="draft">{t.states.draft}</option>
        <option value="scheduled">{t.states.scheduled}</option>
        <option value="published">{t.states.published}</option>
        <option value="archived">{t.states.archived}</option>
      </select>
      {next === "scheduled" && (
        <input
          type="datetime-local"
          className="input max-w-[12rem] py-1 text-xs"
          aria-label={t.publishAt}
          value={moment}
          onChange={(event) => setMoment(event.target.value)}
        />
      )}
      <button
        type="button"
        className="btn-secondary px-3 py-1 text-xs"
        onClick={save}
        disabled={busy}
        data-publication-save
      >
        {busy ? t.saving : t.save}
      </button>
      {message === "saved" && (
        <span className="text-xs text-band-good" data-publication-result="saved">
          {t.saved}
        </span>
      )}
      {message === "error" && (
        <span className="text-xs text-band-bad" data-publication-result="error">
          {t.failed}
        </span>
      )}
      {issues.length > 0 && (
        <ul className="w-full list-disc pl-5 text-xs text-band-bad" data-publication-issues>
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
    </div>
  );
}

function badgeClass(state: PublicationState): string {
  switch (state) {
    case "published":
      return "bg-band-good/15 text-band-good";
    case "scheduled":
      return "bg-gold/20 text-ink-900";
    case "draft":
      return "bg-paper-sunken text-ink-500";
    case "archived":
      return "bg-paper-sunken text-ink-300";
  }
}

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
