"use client";
import { useScopedResponse } from "@/lib/http/use-scoped-response";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/en";
import { type VocabAward, type VocabStanding } from "./types";
import { formatDate } from "@/lib/time";

type BoardStatus = "loading" | "ready" | "error";

/**
 * LEADERBOARD — an optional, independently fetched panel.
 *
 * A failure in this query leaves My Words, Revision and Use It mounted. Retry
 * repeats only this private leaderboard request and its own data scope.
 */
export function VocabBoardPanel({
  dict,
  compact = false,
}: {
  dict: Dictionary;
  compact?: boolean;
}) {
  const requestResponse = useScopedResponse(25000);
  const requestAwards = useScopedResponse(25000);

  const t = dict.vocabulary;
  const router = useRouter();
  const [awards, setAwards] = useState<VocabAward[]>([]);
  const [live, setLive] = useState<VocabStanding | null>(null);
  const [awardsUnavailable, setAwardsUnavailable] = useState(false);
  const [awardsRetrying, setAwardsRetrying] = useState(false);
  const [status, setStatus] = useState<BoardStatus>("loading");

  const refreshLedger = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await requestResponse("/api/vocabulary/leaderboard", { cache: "no-store" });
    if (!res) return;
      if (res.status === 401) router.refresh();
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error("leaderboard unavailable");
      setLive({
        points: payload.points ?? 0,
        rank: payload.rank ?? 0,
        streak: payload.streak ?? 0,
        top: payload.top ?? [],
        name: payload.name,
        level: payload.level,
      });
      setAwards(payload.awards ?? []);
      setAwardsUnavailable(payload.awardsUnavailable === true);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [router, requestResponse]);

  const refreshStanding = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await requestResponse("/api/vocabulary/leaderboard?view=standing", { cache: "no-store" });
    if (!res) return;
      if (res.status === 401) router.refresh();
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error("standing unavailable");
      setLive({
        points: payload.points ?? 0,
        rank: payload.rank ?? 0,
        streak: payload.streak ?? 0,
        top: payload.top ?? [],
        name: payload.name,
        level: payload.level,
      });
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [router, requestResponse]);

  const refreshAwards = useCallback(async () => {
    if (awardsRetrying) return;
    setAwardsRetrying(true);
    try {
      const res = await requestAwards("/api/vocabulary/leaderboard?view=awards", { cache: "no-store" });
    if (!res) return;
      if (res.status === 401) router.refresh();
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error("award history unavailable");
      setAwards(payload.awards ?? []);
      setAwardsUnavailable(false);
    } catch {
      setAwardsUnavailable(true);
    } finally {
      setAwardsRetrying(false);
    }
  }, [awardsRetrying, router, requestAwards]);

  useEffect(() => {
    void refreshLedger();
    window.addEventListener("vocab:ledger-changed", refreshLedger);
    return () => window.removeEventListener("vocab:ledger-changed", refreshLedger);
  }, [refreshLedger]);

  const awardLabel: Record<VocabAward["kind"], string> = {
    new_word: t.board.legacyAward,
    revision: t.board.revisionAward,
    game_answer: t.board.gameAward,
    sentence: t.board.sentenceAward,
  };

  return (
    <div className="card flex flex-col gap-3 p-4" data-leaderboard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-900">{t.board.title}</h2>
        {(live?.rank ?? 0) > 0 && (
          <span className="badge badge-gold" data-my-rank>#{live?.rank}</span>
        )}
      </div>

      {status === "loading" && !live && (
        <div aria-busy="true" data-async-loading="vocabulary-leaderboard" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-md bg-ink-50" />)}
        </div>
      )}
      {status === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-band-bad/30 bg-band-bad/5 px-3 py-2 text-sm" role="alert" data-vocabulary-region-error="leaderboard">
          <span className="text-ink-700">{dict.errors.unknown}</span>
          <button type="button" className="btn-secondary" onClick={() => void refreshStanding()} data-region-retry="leaderboard">{dict.errorPage.retry}</button>
        </div>
      )}
      {live && <>
        {!live.top.some(row=>row.isMe)&&<div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 p-3" data-board-own-standing><strong>{live.name??t.board.you}</strong>{live.level&&<span className="badge">{live.level}</span>}<span>#{live.rank||"—"} · {live.points} {t.board.points}</span></div>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric label={t.board.points} value={live.points} />
          <Metric label={t.board.streak} value={live.streak} />
          <Metric label={t.summary.rank} value={live.rank || "—"} />
        </div>
        <p className="text-xs text-ink-300">{t.board.hint}</p>

        {live.top.length === 0 ? (
          <p className="text-sm text-ink-500" data-board-empty>{t.board.empty}</p>
        ) : (
          <ol className="flex flex-col gap-1.5" data-board-rows>
            {live.top.map((row) => (
              <li key={row.userId} data-board-row={row.rank} className={`flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm ${row.isMe ? "bg-signal-50 text-ink-900" : "text-ink-700"}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-6 shrink-0 text-xs text-ink-300">{row.rank}</span>
                  <span className="truncate">{row.isMe ? `${t.board.you} · ${row.name}` : row.name}</span>
                  {row.level&&<span className="badge">{row.level}</span>}
                </span>
                <span className="shrink-0 font-mono text-xs text-ink-500">{row.points}</span>
              </li>
            ))}
          </ol>
        )}

        {live.top.length > 0 && <p className="text-xs text-ink-300">{live.top.length} {t.board.ofClass}</p>}
        {!compact && awardsUnavailable && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3 text-xs" role="alert" data-vocabulary-region-error="award-history">
            <span className="text-ink-500">{dict.errors.unknown}</span>
            <button type="button" className="btn-secondary " disabled={awardsRetrying} aria-busy={awardsRetrying || undefined} onClick={() => void refreshAwards()} data-region-retry="award-history">{dict.errorPage.retry}</button>
          </div>
        )}
        {!compact && awards.length > 0 && (
          <div className="border-t border-ink-100 pt-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-ink-300">{t.board.recent}</h3>
            <ul className="mt-2 space-y-1 text-xs text-ink-500">
              {awards.slice(0, 5).map((award) => (
                <li key={award.id} className="flex items-center justify-between gap-2">
                  <span>{awardLabel[award.kind]}</span>
                  <span className="text-ink-300">+{award.points} · {formatDate(award.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!compact && awards.length === 0 && !awardsUnavailable && status === "ready" && <p className="text-xs text-ink-300">{t.board.noRecent}</p>}
        {status === "error" && <p className="text-xs text-band-bad" role="status">{dict.errors.unknown} <button type="button" className="btn-secondary " onClick={() => void refreshStanding()}>{dict.errorPage.retry}</button></p>}
      </>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-sm bg-paper-sunken p-2 text-center">
      <p className="font-display text-lg text-ink-900">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-ink-300">{label}</p>
    </div>
  );
}
