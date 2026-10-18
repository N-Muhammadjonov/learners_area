// Source: src/app/app/(shell)/admin/content/page.tsx :: ContentLibraryResults
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
    const sections = [
        {
            key: "reading",
            title: dict.admin.readingTitle,
            href: "/app/admin/reading",
            materialsType: "reading",
            total: inventory.reading.total,
            live: inventory.reading.live,
        },
        {
            key: "listening",
            title: dict.admin.listeningTitle,
            href: "/app/admin/listening",
            materialsType: "listening",
            total: inventory.listening.total,
            live: inventory.listening.live,
        },
        {
            key: "writing",
            // The whole Writing content system (lessons, exam prompts, translation, model texts, patterns) — one canonical area.
            title: dict.admin.writingAdmin.title,
            href: "/app/admin/writing",
            materialsType: "writing",
            total: inventory.writing.total + writingOther.total,
            live: inventory.writing.live + writingOther.live,
        },
        {
            key: "grammar",
            title: dict.admin.grammarTitle,
            href: "/app/admin/grammar",
            materialsType: "grammar",
            // Grammar topics carry no publication state, so "live" and "total" are the
            // same number here rather than a second workflow invented for the count.
            total: inventory.grammar.total,
            live: inventory.grammar.live,
        },
        {
            key: "video",
            title: dict.admin.videoLessonTitle,
            href: "/app/admin/video-lessons",
            total: inventory.video.total,
            live: inventory.video.live,
        },
    ];
    return (h("div", { className: "mx-auto flex max-w-4xl flex-col gap-4", "data-content-library": true },
        h("h1", { className: "font-display text-2xl text-ink-900" }, dict.nav.contentLibrary),
        h("p", { className: "body-text" }, dict.admin.contentLibraryHint),
        h(Card, { className: "flex flex-col gap-2", "data-content-workspace-link": true },
            h("h2", { className: "card-title" }, dict.admin.contentWorkspace.title),
            h("p", { className: "meta-text" }, dict.admin.contentWorkspace.hint),
            h("div", null,
                h(Link, { href: "/app/admin/content/workspace", className: "btn-primary", "data-content-workspace-open": true }, dict.admin.contentLibraryOpen))),
        h("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2" }, sections.map((section) => (h(Card, { key: section.key, className: "flex flex-col gap-2" },
            h("h2", { className: "card-title" }, section.title),
            h("p", { className: "meta-text" },
                dict.admin.contentLibraryLive.replace("{n}", String(section.live)),
                " · ",
                dict.admin.contentLibraryDraft.replace("{n}", String(section.total - section.live))),
            h("div", { className: "flex flex-wrap items-center gap-2" },
                h(Link, { href: section.href, className: "btn-secondary", "data-content-section": section.key }, dict.admin.contentLibraryOpen),
                section.materialsType && (h(Link, { href: `/app/admin/materials/${section.materialsType}`, className: "btn-secondary", "data-content-materials": section.materialsType }, dict.admin.materialsTitle)))))))));
}
export function loading({ dict }) { return h("div", { role: "status", "aria-busy": "true", "aria-label": dict.common.loading, "data-async-loading": "management-content-library", className: "h-40 animate-pulse rounded-xl bg-ink-50" }); }
