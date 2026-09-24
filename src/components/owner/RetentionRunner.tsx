"use client";

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { Card } from "@/components/ui/Card";

type RuleResult = { rule: string; affected: number; applied: boolean; note?: string };

/**
 * Preview-then-delete.
 *
 * The first click only counts; nothing is removed until the owner explicitly
 * confirms. That ordering is the point: a retention job that surprises its
 * operator is a data-loss incident.
 */
export function RetentionRunner({ dict }: { dict: Dictionary }) {
  const t = dict.retention;
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RuleResult[] | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function run(nextDryRun: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/owner/retention", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: nextDryRun }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(dict.errors.unknown);
      return;
    }
    const data = await res.json();
    setDryRun(data.dryRun);
    setResults(data.results as RuleResult[]);
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={busy}
          onClick={() => void run(true)}
        >
          {busy ? t.running : t.dryRun}
        </button>
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={busy}
          onClick={() => void run(false)}
        >
          {t.run}
        </button>
      </div>

      {error && <p className="text-xs text-band-bad">{error}</p>}

      {results && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-ink-300" data-retention-mode={dryRun ? "dry-run" : "applied"}>
            {dryRun ? t.previewOnly : t.lastRun}
          </p>
          {results.map((row) => (
            <div
              key={row.rule}
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
              data-retention-rule={row.rule}
              data-retention-affected={row.affected}
            >
              <span className="font-mono text-ink-700">{row.rule}</span>
              <span className="text-ink-500">
                {row.affected === 0 ? t.nothing : `${row.affected} · ${t.deleted}`}
                {row.note ? ` — ${row.note}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
