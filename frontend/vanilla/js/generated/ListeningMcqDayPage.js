// Reviewed source render expression: src/app/app/(shell)/listening/mcq/day/[day]/page.tsx. State/events are native modules.
import {h,fragment,Link} from '../native.js';
import {Card} from './ui.js';
import {Button,BackLink} from '../../modules/shared/presentation.js';
import {IconAlert,IconClose,IconTarget,IconSparkles} from './icons.js';
import {ModuleEmoji} from './module-emoji.js';
export function render(scope) {
    const { day, dict, t, questions, complete, activeIndex, active, MCQ_FINAL_STAGE, McqMastery } = scope;
    return (h("div", { className: "mcq-day-workspace", "data-route-usable": "listening-mcq-day", "data-listening-mcq-day": day.day },
        h("div", null,
            
            h("h1", { className: "mt-2 font-display text-2xl text-ink-900", "data-listening-mcq-day-title": true },
                t.dayLabel.replace("{n}", String(day.day)),
                " \u00B7 ",
                day.title.replace(/^(?:(?:DAY\s*\d+|\d+\s*[-–]?\s*KUN)\s*(?:[.·:—–-]\s*)?)+/i, '').trim() || t.dayLabel.replace("{n}", String(day.day))),
            h("p", { className: "mt-1 flex flex-wrap gap-x-4 text-sm text-ink-500" },
                h("span", { "data-listening-mcq-day-progress": `${day.status.completed}/${day.status.total}` }, t.dayProgress.replace("{done}", String(day.status.completed)).replace("{total}", String(day.status.total))),
                h("span", { "data-listening-mcq-day-status": day.status.state }, day.status.state === "completed" ? t.completed : day.status.state === "in_progress" ? t.inProgress : t.notStarted)),
            day.draft && (h("p", { className: "mt-1 text-sm text-ink-300", "data-listening-mcq-day-draft": true }, t.draftNotice))),
        questions.length === 0 || !active ? (
        /* Truthful empty state: nothing is invented to fill a day that holds no questions yet. */
        h("section", { className: "card space-y-2 p-6", "data-listening-mcq-day-empty": true },
            h("h2", { className: "font-display text-lg text-ink-900" }, t.notFoundTitle),
            h("p", { className: "text-sm text-ink-500" }, t.notFoundHint))) : (h(fragment, null,
            h("nav", { className: "flex flex-wrap items-center gap-2", "aria-label": t.questionNavLabel, "data-listening-mcq-day-nav": true },
                questions.map((question, index) => {
                    const position = index + 1;
                    const current = position === activeIndex + 1;
                    const stageLabel = question.stage === null ? t.notStarted : question.stage === MCQ_FINAL_STAGE ? t.completed : t.inProgress;
                    return (h(Link, { key: question.id, href: position === 1 ? `/app/listening/mcq/day/${day.day}` : `/app/listening/mcq/day/${day.day}?q=${position}`, "aria-current": current ? "step" : undefined, "aria-label": `${t.questionOf.replace("{n}", String(position)).replace("{total}", String(questions.length))} — ${stageLabel}`, className: current ? "btn-primary" : "btn-secondary", "data-listening-mcq-day-step": position, "data-listening-mcq-day-step-state": question.stage === null ? "not_started" : question.stage === MCQ_FINAL_STAGE ? "completed" : "in_progress" }, position));
                }),
                complete && (h("span", { className: "text-sm text-band-good", "data-listening-mcq-day-complete": true }, t.practiceComplete))),
            h("p", { className: "text-sm text-ink-500", "data-listening-mcq-day-position": activeIndex + 1 }, t.questionOf.replace("{n}", String(activeIndex + 1)).replace("{total}", String(questions.length))),
            h(McqMastery, { key: active.id, dict: dict, autoOpen: true, practice: true, questions: [{ id: active.id, order: activeIndex + 1, questionText: active.questionText, stage: (active.stage ?? "listen") }], dayNavigation: { currentHref: `/app/listening/mcq/day/${day.day}?q=${activeIndex + 1}`, nextHref: activeIndex + 1 < questions.length ? `/app/listening/mcq/day/${day.day}?q=${activeIndex + 2}` : null }, audioUrl: day.audioUrl }),
            h("p", { className: "text-xs text-ink-300" }, t.practiceOnly)))));
}
