// Source: src/app/app/(shell)/listening/academic/page.tsx :: AcademicCatalogueRegion
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
    const t = dict.listening.academic;
    return (h("div", { className: "mx-auto flex w-full max-w-6xl flex-col gap-5", "data-route-usable": "listening-academic" },
        h("p", { className: "text-sm text-ink-500", "data-listening-test-count": true }, t.catalogueCount.replace("{n}", String(total))),
        cards.length === 0 ? (h(Card, { "data-listening-academic-empty": true },
            h("h2", { className: "font-display text-lg text-ink-900" }, t.emptyTitle),
            h("p", { className: "mt-1 text-sm text-ink-500" }, t.emptyHint))) : (h("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4", "data-listening-academic-grid": true }, cards.map((card) => (h(Card, { key: card.testId, className: "min-w-0 p-4", "data-listening-academic-card": card.testId },
            h("div", { className: "flex h-full flex-col gap-2" },
                h("h2", { className: "min-w-0 text-base font-semibold leading-snug text-ink-900" }, card.title),
                h("p", { className: "text-xs text-ink-300" },
                    h("span", { "data-listening-academic-card-parts": true }, t.parts.replace("{n}", String(card.parts))),
                    " · ",
                    h("span", { "data-listening-academic-card-questions": true }, t.questions.replace("{n}", String(card.questions))),
                    card.minutes !== null && (h(fragment, null,
                        " · ",
                        h("span", null,
                            card.minutes,
                            " ",
                            t.minutes)))),
                h("p", { className: "text-xs text-ink-500", "data-listening-academic-card-progress": true }, t.activitiesLabel.replace("{done}", String(card.completed)).replace("{total}", String(card.activityCount))),
                card.exam ? (h("p", { className: "text-xs text-ink-500", "data-listening-academic-card-exam": true }, t.examResult
                    .replace("{score}", String(card.exam.score ?? "—"))
                    .replace("{total}", String(card.exam.total ?? "—")))) : (h("p", { className: "text-xs text-ink-300" }, t.noProgress)),
                card.locked ? h("div", { className: "mt-auto space-y-2", "data-listening-test-locked": true },
                    h("button", { type: "button", className: "btn-secondary px-3 py-2 text-sm", disabled: true },
                        "\uD83D\uDD12 ",
                        t.locked),
                    h("p", { className: "text-xs text-ink-500" }, t.lockedHint)) : h(Link, { prefetch: false, className: "btn-secondary mt-auto self-start px-3 py-2 text-sm", href: `/app/listening/academic/${card.testId}`, "data-listening-academic-open": true }, card.started ? t.open : t.openTest)))))))));
}
export function loading({ dict }) {
    return h("div", { "aria-busy": "true", "data-async-loading": "listening-academic-catalogue", className: "grid gap-4", role: "status", "aria-label": dict.common.loading },
        h("div", { className: "h-12 animate-pulse rounded bg-ink-50" }),
        h("div", { className: "h-28 animate-pulse rounded bg-ink-50" }));
}
