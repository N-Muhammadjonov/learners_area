import {h,fragment} from '../native.js';
import {bandAxis} from '../../modules/shared/band-axis.js';
export function MockBandPanel({ summary, uz, compact = false, }) {
    const points = summary.points.slice(-12);
    const x = (i) => points.length < 2 ? 330 : 45 + (i * 565) / (points.length - 1);
    const axis = bandAxis(points.map(p=>p.estimatedBand),{top:30,bottom:215}), y = axis.y;
    const show = (n) => (n === null ? "—" : n.toFixed(1));
    return (h("section", { className: "card min-w-0 p-5 space-y-5", "data-mock-band-panel": true, "data-latest-band": summary.latest === null ? "none" : summary.latest.toFixed(1), "data-completed-mocks": summary.completed, "data-total-mocks": summary.total },
        h("h2", { className: "font-display text-xl font-bold" },
            "\uD83D\uDCC8 ",
            uz ? "Mock natijalari" : "Overall mock band trend"),
        !compact && (h(fragment, null,
            h("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-5" }, [
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
            ].map(([label, value]) => (h("div", { className: "rounded-xl border border-ink-100 p-3", key: label },
                h("p", { className: "text-xs font-semibold" }, label),
                h("p", { className: "text-2xl font-bold" }, value))))),
            h("label", { className: "block" },
                uz
                    ? "Katalogdagi tugallangan mocklar"
                    : "Completed catalogue mocks",
                " ",
                "\u00B7 ",
                summary.completed,
                " / ",
                summary.total,
                h("progress", { className: "mock-progress-track", value: summary.completed, max: Math.max(1, summary.total) })),
            h("label", { className: "block" },
                uz ? "So'nggi band / 9.0" : "Latest band / 9.0",
                " \u00B7",
                " ",
                show(summary.latest),
                h("progress", { className: "mock-progress-track", value: summary.latest ?? 0, max: 9 })))),
        h("svg", { viewBox: "0 0 660 265", className: "w-full", role: "img", "aria-label": uz
                ? "Haqiqiy tugallangan full mock bandlari"
                : "Completed full mock band estimates" },
            axis.ticks.map((n) => (h("g", { key: n, "data-band-tick": n.toFixed(1) },
                h("line", { x1: "45", x2: "610", y1: y(n), y2: y(n), stroke: "currentColor", strokeWidth: "1.25", opacity: ".45", "data-band-gridline": n.toFixed(1) }),
                h("text", { x: "10", y: y(n) + 4, fill: "currentColor", fontSize: "12" }, n.toFixed(1))))),
            points.length > 1 && (h("polyline", { points: points
                    .map((a, i) => `${x(i)},${y(a.estimatedBand)}`)
                    .join(" "), fill: "none", stroke: "currentColor", strokeWidth: "3" })),
            points.map((a, i) => (h("g", { key: a.id },
                h("circle", { cx: x(i), cy: y(a.estimatedBand), r: "5", fill: "rgb(var(--gold))", stroke: "currentColor", strokeWidth: "2" }),
                h("text", { x: x(i), y: y(a.estimatedBand) - 12, textAnchor: "middle", fill: "currentColor", fontSize: "13" }, (axis.below(a.estimatedBand) ? "↓ " : "") + show(a.estimatedBand)),
                h("text", { x: x(i), y: "245", textAnchor: "middle", fill: "currentColor", fontSize: "10" }, a.finishedAt.toLocaleDateString(uz ? "uz-UZ" : "en-GB", {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                })))))),
        !points.length && (h("p", null, uz
            ? "Hali baholangan full mock natijasi yo'q."
            : "No graded full mock results yet.")),
        points.length > 0 && (h("details", null,
            h("summary", null, uz ? "Jadvalni ko'rsatish" : "Show as table"),
            h("div", { className: "overflow-x-auto" },
                h("table", { className: "w-full text-sm" },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Mock"),
                            h("th", null, uz ? "Sana" : "Date"),
                            h("th", null, "Band"))),
                    h("tbody", null, points.map((a) => (h("tr", { key: a.id },
                        h("td", null, a.title ?? "Mock"),
                        h("td", null, a.finishedAt.toISOString().slice(0, 10)),
                        h("td", null, show(a.estimatedBand))))))))))));
}
