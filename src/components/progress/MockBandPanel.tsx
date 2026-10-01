import type { summarizeMocks } from "@/lib/progress/mock-summary";
export function MockBandPanel({
  summary,
  uz,
  compact = false,
}: {
  summary: ReturnType<typeof summarizeMocks>;
  uz: boolean;
  compact?: boolean;
}) {
  const points = summary.points.slice(-12);
  const x = (i: number) =>
    points.length < 2 ? 330 : 45 + (i * 565) / (points.length - 1);
  const y = (band: number) => 215 - (band / 9) * 185;
  const show = (n: number | null) => (n === null ? "—" : n.toFixed(1));
  return (
    <section className="card space-y-5" data-mock-band-panel>
      <h2 className="font-display text-xl font-bold">
        📈 {uz ? "Mock natijalari" : "Overall mock band trend"}
      </h2>
      {!compact && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              [
                uz ? "Tugallangan urinishlar" : "Completed attempts",
                String(summary.attempts),
              ],
              [uz ? "So'nggi band" : "Latest band", show(summary.latest)],
              [uz ? "Eng yaxshi band" : "Best band", show(summary.best)],
              [uz ? "O'rtacha band" : "Average band", show(summary.average)],
              [
                uz ? "Birinchi → so'nggi" : "First → latest",
                summary.change === null
                  ? "—"
                  : `${summary.change >= 0 ? "+" : ""}${show(summary.change)}`,
              ],
            ].map(([label, value]) => (
              <div className="rounded-xl border border-ink-100 p-3" key={label}>
                <p className="text-xs font-semibold">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>
          <label className="block">
            {uz
              ? "Katalogdagi tugallangan mocklar"
              : "Completed catalogue mocks"}{" "}
            · {summary.completed} / {summary.total}
            <progress
              className="mock-progress-track"
              value={summary.completed}
              max={Math.max(1, summary.total)}
            />
          </label>
          <label className="block">
            {uz ? "So'nggi band / 9.0" : "Latest band / 9.0"} ·{" "}
            {show(summary.latest)}
            <progress
              className="mock-progress-track"
              value={summary.latest ?? 0}
              max={9}
            />
          </label>
        </>
      )}
      <svg
        viewBox="0 0 660 265"
        className="w-full"
        role="img"
        aria-label={
          uz
            ? "Haqiqiy tugallangan full mock bandlari"
            : "Completed full mock band estimates"
        }
      >
        {[0, 3, 6, 9].map((n) => (
          <g key={n}>
            <line
              x1="45"
              x2="610"
              y1={y(n)}
              y2={y(n)}
              stroke="currentColor"
              opacity=".15"
            />
            <text x="10" y={y(n) + 4} fill="currentColor" fontSize="12">
              {n.toFixed(1)}
            </text>
          </g>
        ))}
        {points.length > 1 && (
          <polyline
            points={points
              .map((a, i) => `${x(i)},${y(a.estimatedBand!)}`)
              .join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
        )}
        {points.map((a, i) => (
          <g key={a.id}>
            <circle
              cx={x(i)}
              cy={y(a.estimatedBand!)}
              r="5"
              fill="rgb(var(--gold))"
              stroke="currentColor"
              strokeWidth="2"
            />
            <text
              x={x(i)}
              y={y(a.estimatedBand!) - 12}
              textAnchor="middle"
              fill="currentColor"
              fontSize="13"
            >
              {show(a.estimatedBand)}
            </text>
            <text
              x={x(i)}
              y="245"
              textAnchor="middle"
              fill="currentColor"
              fontSize="10"
            >
              {a.finishedAt!.toLocaleDateString(uz ? "uz-UZ" : "en-GB", {
                day: "numeric",
                month: "short",
                timeZone: "UTC",
              })}
            </text>
          </g>
        ))}
      </svg>
      {!points.length && (
        <p>
          {uz
            ? "Hali baholangan full mock natijasi yo'q."
            : "No graded full mock results yet."}
        </p>
      )}
      {points.length > 0 && (
        <details>
          <summary>{uz ? "Jadvalni ko'rsatish" : "Show as table"}</summary>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th>Mock</th>
                <th>{uz ? "Sana" : "Date"}</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              {points.map((a) => (
                <tr key={a.id}>
                  <td>{a.title ?? "Mock"}</td>
                  <td>{a.finishedAt!.toISOString().slice(0, 10)}</td>
                  <td>{show(a.estimatedBand)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
