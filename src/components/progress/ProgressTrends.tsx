import type { Dictionary } from "@/lib/i18n/en";
import type { ProgressTrends as Trends } from "@/lib/data/progress-trends";
import { heatLevel, type WeekPoint } from "@/lib/progress/trends";
import { Card } from "@/components/ui/Card";

type T = Dictionary["progress"]["trends"];

function WeekChart({ t, title, points, max, unit, id }: { t: T; title: string; points: WeekPoint[] | null; max: number; unit: string; id: string }) {
  if (points === null) return <div data-trend={id} data-trend-unavailable><h3 className="text-sm font-medium text-ink-900">{title}</h3><p className="meta-text">{t.unavailable}</p></div>;
  const any = points.some((p) => p.value !== null);
  return (
    <div className="flex flex-col gap-2" data-trend={id}>
      <h3 className="text-sm font-medium text-ink-900">{title}</h3>
      {!any ? <p className="meta-text" data-trend-empty>{t.noData}</p> : (
        <div className="flex h-24 items-end gap-1" aria-hidden="true">
          {points.map((p) => (
            <div key={p.weekStart} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="technical-text text-[10px] text-ink-500">{p.value ?? ""}</span>
              <span className="w-full rounded-t bg-gold/70" style={{ height: p.value === null ? 0 : `${Math.max(4, (p.value / max) * 64)}px` }} />
            </div>
          ))}
        </div>
      )}
      <details>
        <summary className="meta-text cursor-pointer">{t.asTable}</summary>
        <table className="mt-2 w-full text-left text-xs" data-trend-table={id}>
          <caption className="sr-only">{title}</caption>
          <thead><tr><th scope="col">{t.week}</th><th scope="col">{t.value}</th><th scope="col">{t.count}</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.weekStart}><th scope="row" className="font-normal">{p.weekStart}</th><td>{p.value === null ? "—" : `${p.value}${unit}`}</td><td>{p.count}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

export function ProgressTrends({ dict, trends }: { dict: Dictionary; trends: Trends }) {
  const t = dict.progress.trends;
  const days = trends.heatmap?.flat() ?? [];
  return (
    <>
      <Card data-progress-trends>
        <h2 className="mb-1 font-display text-lg text-ink-900">{t.title}</h2>
        <p className="meta-text mb-3">{t.hint}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <WeekChart t={t} id="reading" title={t.readingAccuracy} points={trends.reading} max={100} unit="%" />
          <WeekChart t={t} id="listening" title={t.listeningAccuracy} points={trends.listening} max={100} unit="%" />
          <WeekChart t={t} id="writing" title={t.writingBand} points={trends.writing} max={9} unit="" />
        </div>
      </Card>

      <Card data-progress-heatmap>
        <h2 className="mb-1 font-display text-lg text-ink-900">{t.heatmapTitle}</h2>
        <p className="meta-text mb-3">{t.heatmapHint}</p>
        {trends.heatmap === null ? <p className="meta-text" data-trend-unavailable>{t.unavailable}</p> : (
          <>
            <div className="flex gap-1" aria-hidden="true">
              {trends.heatmap.map((week) => (
                <div key={week[0]!.day} className="flex flex-col gap-1">
                  {week.map((d) => <span key={d.day} title={`${d.day}: ${d.count}`} data-heat={heatLevel(d.count)} className="block h-3 w-3 rounded-sm" style={{ background: `rgb(var(--gold) / ${[0.08, 0.3, 0.5, 0.75, 1][heatLevel(d.count)]})` }} />)}
                </div>
              ))}
            </div>
            <details>
              <summary className="meta-text cursor-pointer">{t.asTable}</summary>
              <table className="mt-2 text-left text-xs" data-heatmap-table>
                <caption className="sr-only">{t.heatmapTitle}</caption>
                <thead><tr><th scope="col">{t.day}</th><th scope="col">{t.activities}</th></tr></thead>
                <tbody>{days.filter((d) => d.count > 0).map((d) => <tr key={d.day}><th scope="row" className="font-normal">{d.day}</th><td>{d.count}</td></tr>)}</tbody>
              </table>
            </details>
          </>
        )}
      </Card>

      <Card data-progress-retention-trends>
        <h2 className="mb-2 font-display text-lg text-ink-900">{t.retentionTitle}</h2>
        {trends.retention === null ? <p className="meta-text" data-trend-unavailable>{t.unavailable}</p> : (
          <table className="w-full text-left text-sm" data-retention-trend-table>
            <caption className="sr-only">{t.retentionTitle}</caption>
            <thead><tr><th scope="col">{t.level}</th><th scope="col">{t.attempts}</th><th scope="col">{t.recent}</th><th scope="col">{t.average}</th><th scope="col">{t.change}</th></tr></thead>
            <tbody>{trends.retention.map((r) => (
              <tr key={r.level} data-retention-trend-level={r.level}>
                <th scope="row">{r.level}</th><td>{r.attempts}</td>
                <td className="technical-text">{r.recent.length ? r.recent.join(" → ") : "—"}</td>
                <td>{r.average ?? "—"}</td><td>{r.change === null ? "—" : r.change > 0 ? `+${r.change}` : String(r.change)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
