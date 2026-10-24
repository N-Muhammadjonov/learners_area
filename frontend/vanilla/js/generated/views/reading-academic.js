// Source: src/app/app/(shell)/reading/academic/page.tsx :: AcademicReadingResults
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
    return h("div", { className: "mx-auto flex max-w-5xl flex-col gap-5", "data-route-usable": "reading-academic" },
        h(Link, { className: "link-inline", href: "/app/reading" }, dict.common.back),
        h("h1", { className: "page-title" }, dict.readingV4.products.academic.title),
        h("p", { className: "body-text" }, dict.readingHub.academicExamHint),
        !sets.length && h("p", { className: "body-text" }, dict.generalReading.empty),
        h("div", { className: "grid gap-4 sm:grid-cols-2" }, sets.slice(0, 24).map(set => h("article", { className: "card flex flex-col gap-3 p-5", key: set.id, "data-academic-set": set.id },
            h("h2", { className: "card-title" }, set.title),
            h("ol", null, set.passages.map(p => h("li", { key: p.passageNo },
                dict.generalReading.passageN.replace("{n}", String(p.passageNo)),
                ": ",
                p.title))),
            h("p", { "data-academic-state": set.assessmentStatus }, set.assessmentStatus === "completed" ? dict.readingHub.stateCompleted : set.assessmentStatus === "in_progress" ? dict.readingHub.stateInProgress : dict.readingHub.stateNotStarted),
            h(Link, { className: "btn-primary self-start", href: set.attemptId ? `/app/reading/attempts/${set.attemptId}` : `/app/reading/academic/${set.id}` }, set.assessmentStatus === "completed" ? dict.readingV4.review : set.attemptId ? dict.readingHub.actionResume : dict.readingV4.open)))),
        h("nav", { className: "flex gap-3", "aria-label": dict.readingHub.page },
            page > 1 && h(Link, { href: `?page=${page - 1}` }, dict.readingHub.prevPage),
            sets.length > 24 && h(Link, { href: `?page=${page + 1}` }, dict.readingHub.nextPage)));
}
export function loading({ dict }) { return h("div", { role: "status", "aria-busy": "true", "aria-label": dict.common.loading, "data-async-loading": "reading-academic-sets", className: "h-32 animate-pulse rounded-xl bg-ink-50" }); }
