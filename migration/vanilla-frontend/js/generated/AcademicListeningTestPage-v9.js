import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {ListeningAnalysis} from './listening-analysis.js';import {BackLink} from '../../modules/shared/presentation.js';
export function render(scope) {
    const { dict, test } = scope;
    const t = dict.listening.academic;
    return (h("div", { className: "listening-workspace listening-hub mx-auto flex max-w-5xl flex-col gap-6", "data-route-usable": "listening-academic-test", "data-listening-academic-test": test.testId },
        h("div", null,
            h(BackLink, { fallbackHref: "/app/listening/academic", label: t.hubBack, "data-listening-academic-test-back": true }),
            h("h1", { className: "mt-2 font-display text-2xl text-ink-900" }, test.title),
            h("p", { className: "mt-1 text-sm text-ink-500" }, t.hubSubtitle),
            h("p", { className: "mt-1 text-xs text-ink-300" },
                h("span", null, t.parts.replace("{n}", String(test.parts))),
                " · ",
                h("span", null, t.questions.replace("{n}", String(test.questions))),
                test.minutes !== null && (h(fragment, null,
                    " · ",
                    h("span", null,
                        test.minutes,
                        " ",
                        t.minutes))),
                " · ",
                h("span", { "data-listening-academic-transcript": true }, test.transcriptAvailable ? t.transcriptYes : t.transcriptNo)),
            h("p", { className: "mt-1 text-sm text-ink-700", "data-listening-academic-progress": true },
                t.progressLabel.replace("{done}", String(test.progress.completed)).replace("{total}", String(test.progress.total)),
                test.progress.exam && (h(fragment, null,
                    " · ",
                    h("span", { "data-listening-academic-exam": true }, t.examScore
                        .replace("{score}", String(test.progress.exam.score ?? "—"))
                        .replace("{total}", String(test.progress.exam.total ?? "—")))))),
            test.draft && (h("p", { className: "mt-2 text-xs text-amber-700", "data-listening-academic-draft": true }, t.draftNotice))),
        h("div", { className: "listening-purpose-grid", "data-listening-academic-activities": true }, test.activities.map((activity) => (h(Card, { key: activity.id, className: activity.id === "exam" ? "listening-exam-purpose" : undefined, "data-listening-academic-activity": activity.id },
            h("div", { className: "flex h-full flex-col gap-2" },
                h("h2", { className: "font-display text-lg text-ink-900" }, t.activity[activity.id]),
                h("p", { className: "text-sm text-ink-500" }, t.activity[`${activity.id}Hint`]),
                h("div", { className: "mt-auto flex flex-wrap items-center gap-3 pt-2 text-xs text-ink-300" },
                    activity.complete && h("span", { "data-listening-academic-complete": true }, t.complete),
                    activity.latest && (h("span", { "data-listening-academic-latest": true }, t.latestScore
                        .replace("{score}", String(activity.latest.score ?? "—"))
                        .replace("{total}", String(activity.latest.total ?? "—"))))),
                h(Link, { className: "btn-secondary mt-2 self-start", href: `/app/listening/tests/${test.testId}/${activity.path}`, "data-listening-academic-run": activity.id }, t.open))))))));
}
