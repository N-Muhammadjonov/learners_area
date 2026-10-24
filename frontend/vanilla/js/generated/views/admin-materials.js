// Source: src/app/app/(shell)/admin/materials/page.tsx :: AdminMaterialsPage
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
    return (h("div", { className: "mx-auto flex max-w-4xl flex-col gap-4", "data-materials-index": true },
        h("div", null,
            h("h1", { className: "font-display text-2xl text-ink-900" }, dict.admin.materialsTitle),
            h("p", { className: "body-text mt-1" }, dict.admin.materialsHint)),
        h("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2" }, counts.map(({ type, total }) => (h(Card, { key: type, className: "flex flex-col gap-2" },
            h("h2", { className: "card-title" }, kindLabel(dict, type)),
            h("p", { className: "meta-text" }, total),
            h(Link, { href: `/app/admin/materials/${type}`, className: "btn-secondary self-start", "data-materials-kind": type }, dict.admin.contentLibraryOpen)))))));
}
