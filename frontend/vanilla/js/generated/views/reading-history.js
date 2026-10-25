// Source: src/app/app/(shell)/reading/history/page.tsx :: ReadingHistoryPage
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
    return (h("div", { className: "mx-auto flex max-w-3xl flex-col gap-4" },
        h(BackLink, { fallbackHref: "/app/reading", label: dict.common.back }),
        h("h1", { className: "font-display text-2xl text-ink-900" }, dict.reading.historyTitle),
        rows.length === 0 && (h(EmptyState, { icon: "\u25A4", title: dict.dashboard.noAttemptsYet, action: h(Link, { href: "/app/reading", className: "btn-primary" }, dict.reading.pickPassage) })),
        rows.map(({ attempt, passage }) => (h(Link, { key: attempt.id, href: `/app/reading/attempts/${attempt.id}` },
            h(Card, { className: "flex items-center justify-between hover:border-signal-400" },
                h("div", null,
                    h("p", { className: "text-sm font-medium text-ink-900" }, passage.title),
                    h("p", { className: "text-xs text-ink-300" }, attempt.status === "completed"
                        ? `${dict.reading.score}: ${attempt.score}/${attempt.totalQuestions}`
                        : dict.reading.resumeAttempt))))))));
}
