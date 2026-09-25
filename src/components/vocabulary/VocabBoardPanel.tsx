"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { toDate, type VocabAward, type VocabStanding } from "./types";

/**
 * LEADERBOARD — private, and scored on the server.
 *
 * There is nothing to post here: the numbers are aggregated from the point
 * ledger, which is written by the server when it observes real study events
 * (a new word, a scheduled revision, an eligible practice answer, an accepted
 * sentence). Replaying a request cannot inflate a score — every award carries a
 * dedupe key and the unique index drops the duplicate.
 */
export function VocabBoardPanel({
  dict,
  standing,
  compact = false,
}: {
  dict: Dictionary;
  standing: VocabStanding;
  compact?: boolean;
}) {
  const t = dict.vocabulary;
  const [awards, setAwards] = useState<VocabAward[]>([]);
  const [live, setLive] = useState<VocabStanding>(standing);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/vocabulary/leaderboard");
      const payload = await res.json().catch(() => null);
      if (cancelled || !payload?.ok) return;
      setLive({
        points: payload.points ?? 0,
        rank: payload.rank ?? 0,
        streak: payload.streak ?? 0,
        top: payload.top ?? [],
      });
      setAwards(payload.awards ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const awardLabel: Record<VocabAward["kind"], string> = {
    new_word: t.summary.words,
    revision: t.summary.dueToday,
    game_answer: t.games.title,
    sentence: t.use.bank,
  };

  return (
    <div className="card flex flex-col gap-3 p-4" data-leaderboard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-900">{t.board.title}</h2>
        {live.rank > 0 && (
          <span className="badge badge-gold" data-my-rank>
            #{live.rank}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label={t.board.points} value={live.points} />
        <Metric label={t.board.streak} value={live.streak} />
        <Metric label={t.summary.rank} value={live.rank || "—"} />
      </div>

      <p className="text-xs text-ink-300">{t.board.hint}</p>

      {live.top.length === 0 ? (
        <p className="text-sm text-ink-500" data-board-empty>
          {t.board.empty}
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5" data-board-rows>
          {live.top.map((row) => (
            <li
              key={row.userId}
              data-board-row={row.rank}
              className={`flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm ${
                row.isMe ? "bg-signal-50 text-ink-900" : "text-ink-700"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-6 shrink-0 text-xs text-ink-300">{row.rank}</span>
                <span className="truncate">
                  {row.isMe ? `${t.board.you} · ${row.name}` : row.name}
                </span>
              </span>
              <span className="shrink-0 font-mono text-xs text-ink-500">{row.points}</span>
            </li>
          ))}
        </ol>
      )}

      {live.top.length > 0 && (
        <p className="text-xs text-ink-300">
          {live.top.length} {t.board.ofClass}
        </p>
      )}

      {!compact && awards.length > 0 && (
        <div className="border-t border-ink-100 pt-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-300">{t.board.recent}</h3>
          <ul className="mt-2 space-y-1 text-xs text-ink-500">
            {awards.slice(0, 5).map((award) => (
              <li key={award.id} className="flex items-center justify-between gap-2">
                <span>{awardLabel[award.kind]}</span>
                <span className="text-ink-300">
                  +{award.points} · {toDate(award.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && awards.length === 0 && <p className="text-xs text-ink-300">{t.board.noRecent}</p>}
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
