// Source: src/app/app/(shell)/listening/lessons/page.tsx :: ListeningLessonsPage
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
    const t = dict.listening.lessons;
    const staff = isStaff(user.role);
    return (h("div", { className: "mx-auto flex max-w-5xl flex-col gap-6", "data-route-usable": "listening-lessons" }, library.rows.length === 0 ? (h(Card, { "data-listening-lessons-empty": true },
        h("h2", { className: "font-display text-lg text-ink-900" }, t.emptyTitle),
        h("p", { className: "mt-1 text-sm text-ink-500" }, t.emptyHint),
        staff && (h(Link, { className: "btn-secondary mt-3 inline-block", href: "/app/listening/lessons/author", "data-listening-lessons-authoring": true }, t.authoringPath)))) : (h("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2", "data-listening-lessons-grid": true }, library.rows.map((lesson) => (h(Card, { key: lesson.id, "data-listening-lesson-card": lesson.id },
        h("div", { className: "flex h-full flex-col gap-2" },
            h("p", { className: "text-xs uppercase tracking-wide text-ink-300" }, t.areaLabel),
            h("h2", { className: "font-display text-lg text-ink-900" }, lesson.title),
            lesson.summary && h("p", { className: "text-sm text-ink-500" }, lesson.summary),
            h("div", { className: "mt-auto flex flex-wrap items-center gap-3 pt-2 text-xs text-ink-300" },
                lesson.estimatedMinutes ? h("span", null,
                    lesson.estimatedMinutes,
                    " ",
                    t.minutes) : null,
                lesson.hasTeacherNotes ? h("span", { "data-listening-lesson-notes": true }, t.hasTeacherNotes) : null,
                lesson.hasMedia ? h("span", null, t.hasMedia) : null),
            h(Link, { className: "btn-secondary mt-2 self-start", href: `/app/listening/lessons/${lesson.id}`, "data-listening-lesson-open": true }, t.open)))))))));
}
