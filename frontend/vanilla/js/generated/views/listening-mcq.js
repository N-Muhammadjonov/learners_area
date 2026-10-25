// Source: src/app/app/(shell)/listening/mcq/page.tsx :: ListeningMcqPage
// Native DOM presentation; server data via documented adapter, never bundled.
import {h,fragment,Link,InstantLink} from '../../native.js';
import {Card,StatCard,EmptyState,ProgressBar} from '../ui.js';
import {BackLink,Button,RegionFailureNotice as FailureNotice} from '../../../modules/shared/presentation.js';
import {microphoneTest} from '../../../modules/speaking/microphone.js';
import {notificationRead} from '../../../modules/shared/notification-read.js';
import {} from '../icons.js';
export function render(scope) {
    const { context, dict, user, locale, library, page = 1, cards, total, hasMore, days, rows, sets, counts, inventory, writingOther } = scope;
    const isStaff = role => ['teacher', 'admin', 'owner'].includes(role), isAdministrator = role => ['admin', 'owner'].includes(role);
    const MicrophoneTest = p => microphoneTest({ ...context, ...p }), NotificationRead = p => notificationRead({ ...context, ...p }), RegionFailureNotice = p => FailureNotice({ ...p, refresh: context.refresh });
    const kindLabel = (dict, type) => dict.admin[({ lesson: 'materialsKindLesson', reading: 'materialsKindReading', listening: 'materialsKindListening', writing: 'materialsKindWriting', speaking: 'materialsKindSpeaking', grammar: 'materialsKindGrammar', assignment: 'materialsKindAssignment', live_class: 'materialsKindLiveClass' })[type]];
    const t = dict.listening.mcqProgram;
    const staff = isStaff(user.role);
    return (h("div", { className: "mx-auto flex w-full min-w-0 flex-col gap-6", "data-route-usable": "listening-mcq" }, days.length === 0 ? (h("section", { className: "card space-y-2 p-6", "data-listening-mcq-empty": true },
        h("h2", { className: "font-display text-lg text-ink-900" }, t.emptyTitle),
        h("p", { className: "text-sm text-ink-500" }, t.emptyHint),
        staff && h("p", { className: "text-sm text-ink-300", "data-listening-mcq-staff-hint": true }, t.staffHint))) : (h("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2", "data-listening-mcq-grid": true }, days.map((card) => (h("section", { key: card.testId, className: "card flex flex-col gap-3 p-5", "data-listening-mcq-card": card.day },
        h("div", { className: "flex flex-wrap items-center gap-2" },
            h("span", { className: "chip", "data-listening-mcq-card-day": true }, t.dayLabel.replace("{n}", String(card.day))),
            h("span", { className: "text-xs text-ink-300", "data-listening-mcq-card-questions": true }, t.questions.replace("{n}", String(card.questionCount))),
            card.draft && (h("span", { className: "text-xs text-ink-300", "data-listening-mcq-card-draft": true }, t.draftNotice))),
        h("h2", { className: "font-display text-lg text-ink-900" }, card.title),
        h("p", { className: "text-xs text-ink-500", "data-listening-mcq-card-status": card.status.state },
            card.status.state === "completed" ? t.completed : card.status.state === "in_progress" ? t.inProgress : t.notStarted,
            card.status.state === "in_progress" &&
                ` · ${t.dayProgress.replace("{done}", String(card.status.completed)).replace("{total}", String(card.status.total))}`),
        h("div", { className: "mt-auto" }, card.locked ? h("div", { "data-listening-mcq-locked": true },
            h("button", { type: "button", className: "btn-secondary", disabled: true },
                "\uD83D\uDD12 ",
                dict.listening.academic.locked),
            h("p", { className: "mt-2 text-xs text-ink-500" }, t.lockedHint)) : h(Link, { prefetch: false, className: "btn-primary", href: `/app/listening/mcq/day/${card.day}`, "data-listening-mcq-open": true, "data-listening-mcq-action": card.status.state === "completed" ? "review" : card.status.state === "in_progress" ? "continue" : "start" }, card.status.state === "completed" ? t.review : card.status.state === "in_progress" ? t.continue : t.start)))))))));
}
