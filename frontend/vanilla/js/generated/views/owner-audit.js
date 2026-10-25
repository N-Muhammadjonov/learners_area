// Source: src/app/app/(shell)/owner/audit/page.tsx :: OwnerAuditPage
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
        h("h1", { className: "font-display text-2xl text-ink-900" }, dict.owner.audit),
        rows.length === 0 ? (h(EmptyState, { icon: "\u25D4", title: dict.notifications.empty })) : (h(Card, { className: "flex flex-col gap-2" }, rows.map((row) => (h("div", { key: row.id, className: "flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 py-2 last:border-0" },
            h("span", { className: "text-sm text-ink-700", "data-audit-action": row.action }, row.action),
            h("span", { className: "text-xs text-ink-300" },
                row.targetType ? `${row.targetType} · ` : "",
                row.targetId ? `${row.targetId.slice(0, 8)}… · ` : "",
                row.createdAt.toISOString().slice(0, 16).replace("T", " ")))))))));
}
