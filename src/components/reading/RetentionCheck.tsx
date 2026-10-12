"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { occurrenceSpans, type OccurrenceSpan } from "@/lib/services/lexical/occurrence-spans";
import { ReadingHighlightedText, useReadingHighlights } from "@/components/reading/ReadingHighlights";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The retention drill: read a passage, cover it, write what you kept.
 *
 * It is deliberately NOT scored. There is no grader here and no band — the
 * student compares their own recall against the passage, which is exactly what
 * makes the drill honest. It lives in one component because it is used in two
 * places: right after a reading attempt, and on its own page as a short daily
 * drill that needs no test at all.
 *
 * `sourceId` only decides what a saved word is attached to; the drill never
 * writes progress of its own.
 */
export function RetentionCheck({
  dict,
  passageTitle,
  passageBody,
  passageLevel,
  sourceId,
  startOpen = false,
  occurrences = [],
  lexicalAssistance = false,
}: {
  dict: Dictionary;
  passageTitle: string;
  passageBody: string;
  passageLevel?: string | null;
  /** Where a word saved from this passage is filed: the attempt, or the passage. */
  sourceId: string;
  /** A student who has just arrived to read wants the passage open, not hidden. */
  startOpen?: boolean;
  occurrences?: OccurrenceSpan[];
  /** Review permission is enforced again by the canonical lookup/save API. */
  lexicalAssistance?:boolean;
}) {
  const highlights = useReadingHighlights(sourceId);
  const [revealed, setRevealed] = useState(startOpen);
  const [kept, setKept] = useState<Record<string, boolean>>({});

  // How much a reader at this level should be able to reproduce from memory. The
  // target rises with the level; the checklist follows the same level.
  const level = (passageLevel ?? "B2").toUpperCase();
  const target = level >= "C1" ? 5 : level === "B2" ? 4 : 3;
  const checks: { key: string; label: string }[] = [
    { key: "main", label: dict.reading.retentionCheckMain },
    { key: "details", label: `${dict.reading.retentionCheckDetails} (${target - 1})` },
    ...(level >= "B2" ? [{ key: "evidence", label: dict.reading.retentionCheckEvidence }] : []),
    ...(level >= "C1" ? [{ key: "conclusion", label: dict.reading.retentionCheckConclusion }] : []),
  ];
  const keptCount = checks.filter((check) => kept[check.key]).length;

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-900">{dict.reading.retentionTitle}</h2>
        <button
          type="button"
          className="btn-ghost text-xs"
          data-retention-toggle
          aria-expanded={revealed}
          onClick={() => setRevealed((open) => !open)}
        >
          {revealed ? dict.reading.retentionHide : dict.reading.retentionShow}
        </button>
      </div>
      <p className="text-xs text-ink-500">{dict.reading.retentionHint}</p>
      <p className="text-xs text-ink-300" data-retention-target={target} data-retention-level={level}>
        {dict.reading.retentionGoal.replace("{count}", String(target)).replace("{level}", level)}
      </p>
      <textarea
        className="input min-h-[110px]"
        data-retention-input
        placeholder={dict.reading.retentionPlaceholder}
      />
      {/* The self-check is a checklist, not a score: the student marks what they
          actually reproduced before revealing the passage. */}
      <ul className="flex flex-wrap gap-3" data-retention-checklist>
        {checks.map((item) => (
          <li key={item.key}>
            <label className="flex items-center gap-2 text-xs text-ink-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                data-retention-check={item.key}
                checked={Boolean(kept[item.key])}
                onChange={(event) => setKept((prev) => ({ ...prev, [item.key]: event.target.checked }))}
              />
              {item.label}
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-300" data-retention-kept={keptCount}>
        {dict.reading.retentionKept.replace("{kept}", String(keptCount)).replace("{count}", String(checks.length))}
      </p>
      {/*
        The passage is rendered once and hidden with CSS while the student
        recalls it. This is a recall aid, not an exam: nothing here is scored,
        so a student who peeks only cheats their own practice.
      */}
      <div className={`rounded-sm bg-paper-sunken p-3 ${revealed ? "" : "hidden"}`} data-retention-passage>
        <p className="mb-1 text-xs font-medium text-ink-500">{passageTitle}</p>
        <ReadingHighlightedText {...highlights("review",passageBody)} lexicalAssistance={lexicalAssistance}
          dict={dict}
          text={passageBody}
          occurrences={occurrenceSpans(passageBody, passageBody, occurrences)}
          sourceType="reading"
          sourceId={sourceId}
          className="text-sm leading-relaxed text-ink-700"
        />
        <p className="mt-2 text-xs text-ink-300">{dict.reading.retentionSelfCheck}</p>
      </div>
    </Card>
  );
}
