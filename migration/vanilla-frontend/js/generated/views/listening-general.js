// Source: src/app/app/(shell)/listening/general/page.tsx :: GeneralCatalogueRegion
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
    const t = dict.listening.general;
    return (h("div", { className: "mx-auto flex max-w-5xl flex-col gap-6", "data-route-usable": "listening-general" },
        cards.length === 0 ? (h("section", { className: "card space-y-2 p-6", "data-listening-general-empty": true },
            h("h2", { className: "font-display text-lg text-ink-900" }, t.emptyTitle),
            h("p", { className: "text-sm text-ink-500" }, t.emptyHint))) : (h("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2", "data-listening-general-grid": true }, cards.map((card) => (h("section", { key: card.testId, className: "card flex flex-col gap-3 p-5", "data-listening-general-card": card.testId },
            h("div", { className: "flex flex-wrap items-center gap-2" },
                card.sectionNo !== null && (h("span", { className: "chip", "data-listening-general-card-section": true }, t.sectionLabel.replace("{n}", String(card.sectionNo)))),
                card.durationSec !== null && (h("span", { className: "text-xs text-ink-300", "data-listening-general-card-duration": true },
                    Math.max(1, Math.round(card.durationSec / 60)),
                    " ",
                    t.minutes)),
                h("span", { className: "text-xs text-ink-300", "data-listening-general-card-questions": true }, t.questions.replace("{n}", String(card.questionCount)))),
            h("h2", { className: "font-display text-lg text-ink-900" }, card.title),
            h("p", { className: "text-xs text-ink-500", "data-listening-general-card-status": true }, card.completed && card.lastScore !== null && card.lastTotal !== null
                ? t.lastResult.replace("{score}", String(card.lastScore)).replace("{total}", String(card.lastTotal))
                : card.started
                    ? t.inProgress
                    : t.notStarted),
            h("div", { className: "mt-auto" },
                h(Link, { className: "btn-primary", href: `/app/listening/general/${card.testId}`, "data-listening-general-open": true, "data-listening-general-action": card.completed ? "review" : card.started ? "continue" : "open" }, card.completed ? t.reviewSection : card.started ? t.continueSection : t.openSection))))))),
        (page > 1 || hasMore) && (h("nav", { className: "flex items-center justify-between gap-3", "aria-label": t.paginationLabel, "data-listening-general-pagination": true },
            page > 1 ? (h(Link, { className: "btn-secondary", href: page === 2 ? "/app/listening/general" : `/app/listening/general?page=${page - 1}`, "data-listening-general-prev": true },
                "\u2190 ",
                t.previousPage)) : (h("span", null)),
            h("span", { className: "text-xs text-ink-300" }, t.pageLabel.replace("{page}", String(page))),
            hasMore ? (h(Link, { className: "btn-secondary", href: `/app/listening/general?page=${page + 1}`, "data-listening-general-next": true },
                t.nextPage,
                " \u2192")) : (h("span", null))))));
}
export function loading({ dict }) {
    return h("div", { "aria-busy": "true", "data-async-loading": "listening-general-catalogue", className: "grid gap-4", role: "status", "aria-label": dict.common.loading },
        h("div", { className: "h-12 animate-pulse rounded bg-ink-50" }),
        h("div", { className: "h-28 animate-pulse rounded bg-ink-50" }));
}
