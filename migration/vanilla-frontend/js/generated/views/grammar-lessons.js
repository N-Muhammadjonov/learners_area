// Source: src/app/app/(shell)/grammar/lessons/page.tsx :: GrammarLibraryResults
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
    return h("div", { className: "mx-auto flex max-w-5xl flex-col gap-5", "data-route-usable": "grammar-lessons" },
        h("h1", { className: "page-title" }, dict.grammar.lessonsTitle),
        h("div", { className: "grid gap-4 sm:grid-cols-2" }, library.rows.map(lesson => h("article", { className: "card p-5", key: lesson.id, "data-grammar-lesson": lesson.id },
            h("h2", { className: "card-title" }, lesson.title),
            lesson.summary && h("p", { className: "body-text" }, lesson.summary),
            h(Link, { className: "btn-primary", href: `/app/grammar/lessons/${lesson.id}` }, dict.listening.hub.open)))),
        h("nav", { className: "flex gap-3", "aria-label": dict.readingHub.page },
            page > 1 && h(Link, { href: `?page=${page - 1}` }, dict.readingHub.prevPage),
            library.hasMore && h(Link, { href: `?page=${page + 1}` }, dict.readingHub.nextPage)));
}
export function loading({ dict }) { return h("div", { role: "status", "aria-busy": "true", "aria-label": dict.common.loading, "data-async-loading": "grammar-lessons-library", className: "h-32 animate-pulse rounded-xl bg-ink-50" }); }
