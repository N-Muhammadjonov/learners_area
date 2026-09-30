"use client";

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";

/**
 * The learner's own Retention history.
 *
 * The first page arrives from the server render; "Load more" asks the same
 * endpoint for the next one. The list is scoped to the signed-in learner by the
 * endpoint itself, so this component never sends a user id and there is no shape
 * of request that would return somebody else's attempts.
 */

export type RetentionHistoryItem = {
  attemptId: string;
  level: string;
  score: number | null;
  status: "completed" | "timed_out";
  completedAt: string | null;
  createdAt: string;
};

export type RetentionHistoryPageData = {
  rows: RetentionHistoryItem[];
  page: number;
  pageCount: number;
  total: number;
};

export function RetentionHistory({
  dict,
  initial,
}: {
  dict: Dictionary;
  initial: RetentionHistoryPageData;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const t = dict.retentionMemory;

  async function loadMore() {
    setBusy(true);
    try {
      const response = await fetch(`/api/retention/history?page=${data.page + 1}`, { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as RetentionHistoryPageData;
      setData({ ...next, rows: [...data.rows, ...next.rows] });
    } finally {
      setBusy(false);
    }
  }

  if (data.rows.length === 0) {
    return <p className="body-text" data-retention-history-empty>{t.historyEmpty}</p>;
  }

  return (
    <div className="flex flex-col gap-3" data-retention-history>
      <ul className="flex flex-col gap-2">
        {data.rows.map((row) => (
          <li key={row.attemptId} className="panel flex items-center justify-between gap-3" data-retention-history-row={row.attemptId}>
            <span className="body-text">
              {row.level} · {row.status === "timed_out" ? t.historyTimedOut : t.historyCompleted}
            </span>
            <span className="meta-text text-right">
              <span data-retention-history-score={row.score ?? 0}>{row.score ?? 0} / 100</span>
              <br />
              {(row.completedAt ?? row.createdAt).slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
      {data.page < data.pageCount && (
        <button type="button" className="btn-secondary w-fit" onClick={() => void loadMore()} disabled={busy} data-retention-history-more>
          {t.historyLoadMore}
        </button>
      )}
      <span className="meta-text" data-retention-history-page>
        {t.historyPage.replace("{page}", String(data.page)).replace("{pages}", String(data.pageCount))}
      </span>
    </div>
  );
}
