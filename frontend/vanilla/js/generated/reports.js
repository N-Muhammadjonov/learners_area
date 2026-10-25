// Reviewed source report form, no database or framework runtime.
import { h } from '../native.js';
import { Card } from './ui.js';
import { PERIOD_KINDS } from './report-period.js';
import { REPORT_FORMATS } from '../adapters/reports.js';
import { TIMEZONE } from './time.js';
const FORMAT_LABELS = {
    pdf: "PDF", docx: "Word (DOCX)", xlsx: "Excel (XLSX)", csv: "CSV", json: "JSON", zip: "ZIP (all formats + manifest)",
};
export function render({ dict, locale, role, query, students, scopes, errorText }) {
    const t = dict.reporter, staff = role !== 'student', teacher = role === 'teacher', STUDENT_LIST_CAP = 1000;
    const periodLabel = { on_demand: t.periodOnDemand, weekly: t.periodWeekly, monthly: t.periodMonthly, yearly: t.periodYearly, custom: t.periodCustom };
    const scopeLabel = { owner: t.scopeOwner, teacher: teacher ? t.scopeRoster : t.scopeTeacher, student: staff ? t.scopeStudent : t.scopeSelf };
    return (h("div", { className: "flex flex-col gap-4", "data-reporter": true },
        h("div", null,
            h("h1", { className: "font-display text-2xl text-ink-900" }, t.title),
            h("p", { className: "text-sm text-ink-500" }, t.subtitle)),
        errorText && h("p", { className: "rounded-md border border-band-bad/40 bg-band-bad/10 p-3 text-sm text-band-bad", role: "alert", "data-reporter-error": true }, errorText),
        staff && !teacher && (h("form", { method: "get", action: "/app/reports", className: "flex flex-wrap items-end gap-3", "data-reporter-student-search": true },
            h("label", { className: "flex flex-col gap-1 text-sm" },
                h("span", { className: "font-semibold text-ink-700" }, t.studentSearch),
                h("input", { type: "search", name: "q", value: query, maxLength: 60, className: "input" })),
            h("button", { type: "submit", className: "btn-secondary min-h-11" }, t.studentSearchButton))),
        staff && !teacher && students.length >= STUDENT_LIST_CAP && h("p", { className: "text-xs text-ink-500", role: "status", "data-reporter-list-capped": true }, t.listCapped.replace("{n}", String(STUDENT_LIST_CAP))),
        h(Card, { className: "p-4" },
            h("form", { method: "get", action: "/api/reports", className: "flex flex-col gap-4", "data-reporter-form": true },
                h("input", { type: "hidden", name: "ui", value: "1" }),
                h("fieldset", { className: "flex flex-col gap-2" },
                    h("legend", { className: "text-sm font-semibold text-ink-700" }, t.scope),
                    scopes.map((s, i) => (h("label", { key: s, className: "flex items-center gap-2 text-sm" },
                        h("input", { type: "radio", name: "scope", value: s, checked: i === 0 }),
                        " ",
                        scopeLabel[s])))),
                staff && (h("label", { className: "flex flex-col gap-1 text-sm" },
                    h("span", { className: "font-semibold text-ink-700" }, t.student),
                    students.length === 0 ? h("span", { className: "text-ink-500" }, teacher ? t.noRoster : t.noStudents) : (h("select", { name: "subject", className: "input", value: "" },
                        h("option", { value: "" }, "\u2014"),
                        students.map((s) => h("option", { key: s.id, value: s.id }, s.name)))),
                    h("span", { className: "text-xs text-ink-500" }, t.studentHint))),
                h("label", { className: "flex flex-col gap-1 text-sm" },
                    h("span", { className: "font-semibold text-ink-700" }, t.period),
                    h("select", { name: "period", className: "input", value: "monthly" }, PERIOD_KINDS.map((p) => h("option", { key: p, value: p }, periodLabel[p])))),
                h("div", { className: "grid gap-3 sm:grid-cols-2" },
                    h("label", { className: "flex flex-col gap-1 text-sm" },
                        h("span", { className: "font-semibold text-ink-700" }, t.from),
                        h("input", { type: "date", name: "from", className: "input" })),
                    h("label", { className: "flex flex-col gap-1 text-sm" },
                        h("span", { className: "font-semibold text-ink-700" }, t.to),
                        h("input", { type: "date", name: "to", className: "input" })),
                    h("p", { className: "text-xs text-ink-500 sm:col-span-2" }, t.customHint)),
                h("div", { className: "grid gap-3 sm:grid-cols-2" },
                    h("label", { className: "flex flex-col gap-1 text-sm" },
                        h("span", { className: "font-semibold text-ink-700" }, t.format),
                        h("select", { name: "format", className: "input", value: "pdf" }, REPORT_FORMATS.map((f) => h("option", { key: f, value: f }, FORMAT_LABELS[f])))),
                    h("label", { className: "flex flex-col gap-1 text-sm" },
                        h("span", { className: "font-semibold text-ink-700" }, t.language),
                        h("select", { name: "lang", className: "input", value: locale },
                            h("option", { value: "uz" }, "O'zbekcha"),
                            h("option", { value: "en" }, "English")))),
                h("p", { className: "text-xs text-ink-500" },
                    t.timezoneNote,
                    ": ",
                    TIMEZONE,
                    ". ",
                    t.privacy),
                h("div", null,
                    h("button", { type: "submit", className: "btn-primary" }, t.download))))));
}
