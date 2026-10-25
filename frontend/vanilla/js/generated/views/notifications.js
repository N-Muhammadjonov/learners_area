// Source: src/app/app/(shell)/notifications/page.tsx :: NotificationsPage
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
    return (h("div", { className: "mx-auto flex max-w-2xl flex-col gap-4" },
        h("h1", { className: "font-display text-2xl text-ink-900" }, dict.notifications.title),
        rows.length > 0 && h(NotificationRead, { ids: rows.filter((row) => !row.readAt).map((row) => row.id), label: dict.notifications.markRead, errorLabel: dict.common.error }),
        rows.length === 0 ? (h(EmptyState, { icon: "\u25D4", title: dict.notifications.empty })) : (h("div", { className: "flex flex-col gap-2" }, rows.map((row) => (h(Card, { "data-notification-id": row.id, key: row.id, className: "flex flex-col gap-1" },
            h("div", { className: "flex items-center justify-between gap-2" },
                h("span", { className: "text-sm font-medium text-ink-900" }, row.title),
                h("span", { className: "text-xs text-ink-300" }, row.createdAt.toISOString().slice(0, 16).replace("T", " "))),
            row.body && h("p", { className: "text-sm text-ink-500" }, row.body),
            row.href && (h(Link, { href: row.href, className: "text-xs text-signal-700 underline" }, dict.common.continue)))))))));
}
