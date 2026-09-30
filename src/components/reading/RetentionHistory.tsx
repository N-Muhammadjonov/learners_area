"use client";

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";

export type RetentionHistoryItem = {
  attemptId: string; level: string; score: number | null;
  status: "completed" | "timed_out"; completedAt: string | null; createdAt: string;
};
export type RetentionHistoryPageData = {
  rows: RetentionHistoryItem[]; page: number; pageCount: number; total: number;
};

function validPage(value: unknown): value is RetentionHistoryPageData {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<RetentionHistoryPageData>;
  return Number.isInteger(page.page) && Number.isInteger(page.pageCount) && typeof page.total === "number"
    && Array.isArray(page.rows) && page.rows.every((row) => typeof row.attemptId === "string"
      && typeof row.level === "string" && typeof row.createdAt === "string"
      && (row.completedAt === null || typeof row.completedAt === "string")
      && (row.score === null || typeof row.score === "number")
      && (row.status === "completed" || row.status === "timed_out"));
}

/** Fresh, bounded owner-scoped GETs only; nothing goes in the private read cache. */
export function RetentionHistory({ dict, initial }: { dict: Dictionary; initial: RetentionHistoryPageData }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const t = dict.retentionMemory;
  useEffect(() => {
    generation.current += 1;
    request.current?.abort(); request.current = null;
    setData(initial); setBusy(false); setFailed(false);
    return () => { generation.current += 1; request.current?.abort(); request.current = null; };
  }, [initial]);

  async function loadMore() {
    if (request.current || data.page >= data.pageCount) return;
    const controller = new AbortController();
    request.current = controller;
    const version = generation.current;
    const deadline = window.setTimeout(() => controller.abort(), 10_000);
    setBusy(true); setFailed(false);
    try {
      const response = await fetch(`/api/retention/history?page=${data.page + 1}`, {
        cache: "no-store", credentials: "same-origin", signal: controller.signal,
      });
      if (!response.ok) throw new Error("history_unavailable");
      const next: unknown = await response.json();
      if (!validPage(next) || next.page !== data.page + 1) throw new Error("history_invalid");
      if (version !== generation.current) return;
      setData((previous) => ({ ...next, rows: Array.from(new Map([...previous.rows, ...next.rows].map((row) => [row.attemptId, row])).values()) }));
    } catch {
      if (version === generation.current) setFailed(true);
    } finally {
      window.clearTimeout(deadline);
      if (request.current === controller) request.current = null;
      if (version === generation.current) setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3" data-retention-history>
      {data.rows.length === 0 ? <p className="body-text" data-retention-history-empty>{t.historyEmpty}</p> : (
        <ul className="flex flex-col gap-2">
          {data.rows.map((row) => (
            <li key={row.attemptId} className="panel flex items-center justify-between gap-3" data-retention-history-row={row.attemptId}>
              <span className="body-text">{row.level} · {row.status === "timed_out" ? t.historyTimedOut : t.historyCompleted}</span>
              <span className="meta-text text-right">
                <span data-retention-history-score={row.score ?? "unavailable"}>{row.score ?? "—"} / 100</span><br />
                {(row.completedAt ?? row.createdAt).slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {failed && <p role="alert" className="text-sm text-band-bad">{t.errors.retention_unavailable}</p>}
      {data.page < data.pageCount && <button type="button" className="btn-secondary w-fit" onClick={() => void loadMore()} disabled={busy} data-retention-history-more>{busy ? dict.common.loading : failed ? dict.errorPage.retry : t.historyLoadMore}</button>}
      <span className="meta-text" data-retention-history-page>{t.historyPage.replace("{page}", String(data.page)).replace("{pages}", String(data.pageCount))}</span>
    </div>
  );
}
