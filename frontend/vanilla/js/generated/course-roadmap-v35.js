// Source-extracted pure UI. No React/Next/server runtime.
import {h,fragment,Link} from '../native.js';import {Card,ProgressBar} from './ui.js';import {StateBadge} from './badges.js';
export function render({ roadmap, dict }) {
    return (h("div", { className: "mx-auto flex max-w-3xl flex-col gap-6" },
        h("div", null,
            h("h1", { className: "font-display text-2xl text-ink-900" }, roadmap.course.title),
            h("p", { className: "text-sm text-ink-500" }, roadmap.course.description)),
        roadmap.modules.map((m) => (h("div", { key: m.id },
            h("h2", { className: "mb-2 font-display text-lg text-ink-900" }, m.title),
            h("div", { className: "flex flex-col gap-2" }, m.units.map((u) => (h(Card, { key: u.id },
                h("p", { className: "mb-2 text-sm font-medium text-ink-700" }, u.title),
                h("div", { className: "flex flex-col divide-y divide-ink-100" }, u.lessons.map((l) => (h("div", { key: l.id, className: "flex items-center justify-between py-2", "data-lesson": l.id },
                    h("div", null,
                        h("p", { className: "text-sm text-ink-900" }, l.title),
                        l.summary && h("p", { className: "text-xs text-ink-300" }, l.summary)),
                    h("div", { className: "flex items-center gap-2" },
                        h(StateBadge, { state: l.state }),
                        l.state !== "locked" && (h(Link, { href: `/app/courses/ielts/lessons/${l.id}`, className: "btn-secondary ", "data-lesson-open": l.id }, dict.courseRoadmap.open))))))))))))))));
}
