import type { Dictionary } from "@/lib/i18n/en";
import { getMockOverview } from "@/lib/data/mocks";
import { getProgressData } from "@/lib/data/progress";
export async function StudentResults({ studentId, dict }: { studentId: string; dict: Dictionary }) {
  const [mocks, progress] = await Promise.all([getMockOverview(studentId), getProgressData(studentId)]);
  const t = dict.studentResults;
  const finished = mocks.attempts.filter(row => row.finishedAt).sort((a, b) => a.finishedAt!.getTime() - b.finishedAt!.getTime());
  const bands = finished.flatMap(row => row.estimatedBand === null ? [] : [{ id: row.id, value: row.estimatedBand, date: row.finishedAt!, title: row.title, skill: row.skill }]);
  const latest = bands.at(-1)?.value ?? null;
  const best = bands.length ? Math.max(...bands.map(row => row.value)) : null;
  const average = bands.length ? bands.reduce((sum, row) => sum + row.value, 0) / bands.length : null;
  const improvement = bands.length >= 2 ? latest! - bands[0]!.value : null;
  const fmt = (value: number | null) => value === null ? "—" : value.toFixed(1);
  const total = new Set([...mocks.tests.map(row => row.id), ...mocks.attempts.map(row => row.mockTestId)]).size;
  const complete = new Set(finished.map(row => row.mockTestId)).size;
  const chart = bands.slice(-20);
  const x = (i: number) => chart.length === 1 ? 480 : 40 + i * 880 / (chart.length - 1);
  const y = (value: number) => 285 - value / 9 * 250;
  return <section className="space-y-5" data-student-results>
    <h2 className="font-display text-2xl">{t.title}</h2>
    {mocks.attemptsUnavailable || mocks.catalogueUnavailable || mocks.attemptTitlesUnavailable ? <p role="alert">{dict.errors.unknown}</p> : <>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[[t.taken, String(finished.length)], [t.latest, fmt(latest)], [t.best, fmt(best)], [t.average, fmt(average)], [t.improvement, improvement === null ? "—" : `${improvement > 0 ? "+" : ""}${fmt(improvement)}`]].map(([label,value]) => <div key={label} className="card p-4"><dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt><dd className="mt-2 font-display text-2xl text-signal-600">{value}</dd></div>)}</dl>
      {total > 0 && <div className="space-y-2"><p>{t.completed}: {complete} / {total}</p><progress className="h-3 w-full accent-signal-600" max={total} value={complete} /></div>}
      {latest !== null && <div className="space-y-2"><p>{t.latest}: {fmt(latest)} / 9.0</p><progress className="h-3 w-full accent-signal-600" max={9} value={latest} /></div>}
      {chart.length > 0 && <div className="card p-4"><svg viewBox="0 0 960 345" role="img" aria-label={t.trend} className="w-full">{[0,3,6,9].map(value => <g key={value}><line x1="40" x2="920" y1={y(value)} y2={y(value)} stroke="currentColor" opacity="0.12" /><text x="5" y={y(value)+5} fill="currentColor" fontSize="14">{value}.0</text></g>)}<polyline points={chart.map((row,i) => `${x(i)},${y(row.value)}`).join(" ")} fill="none" stroke="rgb(var(--accent))" strokeWidth="3" />{chart.map((row,i) => <g key={row.id}>{(i === 0 || i === chart.length-1 || i % Math.ceil(chart.length/6) === 0) && <text x={x(i)} y="322" textAnchor="middle" fill="currentColor" fontSize="12">{row.date.toISOString().slice(5,10)}</text>}<circle cx={x(i)} cy={y(row.value)} r="6" fill="rgb(var(--accent))"><title>{row.date.toISOString().slice(0,10)} · {row.skill ?? ""} · {row.title ?? ""}: {fmt(row.value)}</title></circle><text x={x(i)} y={y(row.value)-14} textAnchor="middle" fill="currentColor" fontSize="16">{fmt(row.value)}</text></g>)}</svg><p className="text-xs text-ink-500">{t.bandNote}</p></div>}
      <div className="grid gap-4 md:grid-cols-2">{(["reading","listening","speaking","writing"] as const).map(skill => <article key={skill} className="card space-y-3 p-5"><h3 className="font-display text-xl">{dict.nav[skill]}</h3><ul className="space-y-2">{finished.filter(row => row.skill === skill).reverse().slice(0,30).map(row => <li key={row.id} className="flex flex-wrap justify-between gap-2 border-b border-ink-100 py-2"><span>{row.title ?? dict.nav.mockTests} · {row.finishedAt!.toISOString().slice(0,10)}</span><span>{row.estimatedBand === null ? row.rawScore ?? "—" : fmt(row.estimatedBand)}</span></li>)}</ul>{!finished.some(row => row.skill === skill) && <p className="text-sm text-ink-500">{t.noResults}</p>}<p className="text-sm text-ink-500">{t.practice}: {skill === "reading" ? progress.reading?.submitted ?? "—" : skill === "listening" ? progress.listening?.submitted ?? "—" : skill === "speaking" ? progress.speaking?.submitted ?? "—" : progress.writing.submissions ?? "—"}</p></article>)}</div>
    </>}
  </section>;
}
