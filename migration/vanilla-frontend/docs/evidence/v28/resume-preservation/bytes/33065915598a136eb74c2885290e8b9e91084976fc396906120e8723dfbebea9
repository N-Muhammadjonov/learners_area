// Exact source success markup; explicit native lifecycle/data adapters. No React runtime.
import {h,fragment,Link} from '../native.js';
import {Card,StatCard} from './ui.js';
import {Button,RegionFailureNotice as FailureNotice} from '../../modules/shared/presentation.js';
import {BandBadge,StateBadge} from './badges.js';
import {formatDate,formatDateTime} from './time.js';
import {summarizeMocks} from './mock-summary.js';
import {MockBandPanel} from './mock-band.js';
export function render(scope) {
    const { context, dict, locale, user } = scope;
    const openLessonsPromise = scope.openLessonsResult;
    const SKILLS = ['listening', 'reading', 'writing', 'speaking'];
    // Source presentation with explicit native DOM slots, no framework renderer.
    const Suspense = ({ children }) => fragment({ children });
    const RegionFailureNotice = p => FailureNotice({ ...p, refresh: () => context.retryRegion ? context.retryRegion(p.region) : context.refresh() });
    const slot = (key, skeleton) => { const host = h('div', { 'data-dashboard-region-slot': key, 'aria-busy': 'true' }, skeleton); scope.slots[key] = host; return host; };
    function DashboardContent(props) { return scope.slots ? slot('dashboard', DashboardSkeleton()) : DashboardContentResolved(props); }
    function DashboardOpenLessons(props) { return scope.slots ? slot('openLessons', DashboardOpenLessonsSkeleton()) : DashboardOpenLessonsResolved(props); }
    function MockProgressOverview(props) { return scope.slots ? slot('mock', DashboardSkeleton()) : MockProgressOverviewResolved(props); }
    function DashboardContentResolved({ user, locale, dict, openLessonsPromise }) {
        const data = scope.dashboard;
        const unavailable = Object.entries(data.unavailable).filter(([, failed]) => failed);
        return (h("div", { className: "flex flex-col gap-6", "data-dashboard-content": true, "data-async-content": "dashboard" },
            unavailable.map(([region]) => (h(RegionFailureNotice, { key: region, region: `dashboard-${region}`, message: dict.errors.unknown, retryLabel: dict.errorPage.retry }))),
            h("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-4" },
                h(StatCard, { label: dict.dashboard.targetBand, value: data.profile?.targetBand?.toFixed(1) ?? "—" }),
                h(StatCard, { label: dict.dashboard.streak, value: data.streak === null ? "—" : String(data.streak) }),
                h(StatCard, { label: dict.writing.historyTitle, value: data.writingAttempts === null ? "—" : String(data.writingAttempts) }),
                h(StatCard, { label: dict.dashboard.vocabDue, value: data.vocabDueCount === null ? "—" : String(data.vocabDueCount) })),
            h(Card, { "data-continue": true },
                h("h2", { className: "font-display text-lg text-ink-900" }, dict.dashboard.continueLearning),
                data.unavailable.lastActivity ? (h("p", { className: "mt-2 text-sm text-ink-500", "data-dashboard-region": "last-activity-unavailable" }, dict.errors.unknown)) : data.lastActivity ? (h(fragment, null,
                    h("p", { className: "mt-1 text-sm text-ink-500", "data-last-module": data.lastActivity.module },
                        dict.dashboard.lastModule,
                        ": ",
                        dict.nav[data.lastActivity.module],
                        " \u00B7",
                        " ",
                        formatDateTime(data.lastActivity.at, locale)),
                    h("div", { className: "mt-4 flex flex-wrap gap-2" },
                        h(Link, { href: data.lastActivity.href, "data-continue-link": data.lastActivity.href },
                            h(Button, null, dict.dashboard.pickUp)),
                        h(Link, { href: "/app/vocabulary" },
                            h(Button, { variant: "secondary" }, dict.dashboard.reviewVocab))))) : (h("div", { className: "mt-2", "data-continue-empty": true },
                    h("p", { className: "text-sm text-ink-500" }, dict.dashboard.nothingYet),
                    h("div", { className: "mt-4 flex flex-wrap gap-2" },
                        h(Link, { href: "/app/writing" },
                            h(Button, null, dict.dashboard.startWriting)),
                        h(Link, { href: "/app/vocabulary" },
                            h(Button, { variant: "secondary" }, dict.dashboard.reviewVocab)))))),
            h(Card, { "data-retention-drill": true },
                h("div", { className: "flex flex-wrap items-center justify-between gap-2" },
                    h("div", { className: "min-w-0" },
                        h("h2", { className: "font-display text-lg text-ink-900" }, dict.reading.retentionModeTitle),
                        h("p", { className: "mt-1 text-sm text-ink-500" }, dict.dashboard.retentionDrillHint)),
                    h(Link, { href: "/app/reading/retention", prefetch: false },
                        h(Button, { variant: "secondary" }, dict.dashboard.retentionDrillAction)))),
            h(Card, { "data-my-tasks": true },
                h("h2", { className: "font-display text-lg text-ink-900" }, dict.dashboard.myTasks),
                data.openAssignments === null ? (h("p", { className: "mt-1 text-sm text-ink-500", "data-tasks-unavailable": true }, dict.errors.unknown)) : data.openAssignments.length === 0 ? (h("p", { className: "mt-1 text-sm text-ink-500", "data-tasks-empty": true }, dict.dashboard.noTasks)) : (h("ul", { className: "mt-2 flex flex-col divide-y divide-ink-100" }, data.openAssignments.map((task) => (h("li", { key: task.id, className: "flex items-center justify-between py-2", "data-task": task.id },
                    h("span", { className: "text-sm text-ink-900" }, task.title),
                    h("span", { className: "text-xs text-ink-300" }, task.dueAt ? `${dict.assignments.due}: ${formatDate(task.dueAt, locale)}` : "")))))),
                h(Link, { href: "/app/assignments", className: "btn-secondary mt-3" },
                    dict.assignments.title,
                    " \u2192")),
            h(Suspense, { fallback: h(DashboardOpenLessonsSkeleton, null) },
                h(DashboardOpenLessons, { openLessonsPromise: openLessonsPromise, dict: dict })),
            data.nextLiveClass && (h(Card, { "data-next-live-class": data.nextLiveClass.id },
                h("div", { className: "flex flex-wrap items-center justify-between gap-2" },
                    h("h2", { className: "font-display text-lg text-ink-900" }, dict.dashboard.nextClass),
                    h("span", { className: "text-xs text-ink-300" }, formatDateTime(data.nextLiveClass.scheduledAt, locale))),
                h("p", { className: "mt-1 text-sm text-ink-700" }, data.nextLiveClass.title),
                h(Link, { href: "/app/live-classes", className: "btn-secondary mt-3" },
                    dict.liveClasses.title,
                    " \u2192"))),
            data.latestEvaluation && (h(Card, null,
                h("div", { className: "flex items-center justify-between" },
                    h("h2", { className: "font-display text-lg text-ink-900" }, dict.dashboard.recentFeedback),
                    h(BandBadge, { band: data.latestEvaluation.overallEstimate })),
                data.latestEvaluation.weaknesses[0] && (h("p", { className: "mt-2 text-sm text-ink-500" }, data.latestEvaluation.weaknesses[0])),
                h("p", { className: "mt-2 text-xs text-ink-300", "data-checked-by": data.latestEvaluation.checkedByName },
                    dict.coach.checkedBy,
                    " ",
                    data.latestEvaluation.checkedByName),
                h(Link, { href: "/app/coach", className: "btn-secondary mt-3" },
                    dict.coach.title,
                    " \u2192"))),
            h("div", null,
                h("h2", { className: "mb-3 font-display text-lg text-ink-900" }, dict.dashboard.skillSummary),
                h("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-4" }, SKILLS.map((skill) => {
                    const attempts = data.skillCounts[skill];
                    return (h(Card, { key: skill, className: "flex flex-col gap-1", "data-skill": skill },
                        h("span", { className: "text-sm font-medium text-ink-900" }, dict.nav[skill]),
                        attempts === null ? (h("span", { className: "text-xs text-ink-300", "data-skill-unavailable": true }, "\u2014")) : attempts === 0 ? (h("span", { className: "text-xs text-ink-300" }, dict.dashboard.noAttemptsYet)) : (h("span", { className: "text-xs text-ink-500", "data-skill-count": attempts },
                            attempts,
                            " ",
                            dict.dashboard.attempts)),
                        skill === "writing" && data.latestEvaluation && h(BandBadge, { band: data.latestEvaluation.overallEstimate })));
                })))));
    }
    function DashboardOpenLessonsResolved({ openLessonsPromise, dict }) {
        const result = scope.openLessonsResult;
        if (!result.ok) {
            return (h(Card, { "data-open-lessons": true },
                h("h2", { className: "font-display text-lg text-ink-900" }, dict.dashboard.openNow),
                h(RegionFailureNotice, { region: "dashboard-open-lessons", message: dict.errors.unknown, retryLabel: dict.errorPage.retry })));
        }
        const openLessons = result.lessons;
        return (h(Card, { "data-open-lessons": true },
            h("div", { className: "flex flex-wrap items-center justify-between gap-2" },
                h("h2", { className: "font-display text-lg text-ink-900" }, dict.dashboard.openNow),
                h(Link, { href: "/app/courses/ielts", className: "btn-secondary " },
                    dict.dashboard.fullRoadmap,
                    " \u2192")),
            openLessons.length === 0 ? (h("p", { className: "mt-1 text-sm text-ink-500", "data-open-lessons-empty": true }, dict.dashboard.nothingOpenYet)) : (h("ul", { className: "mt-2 flex flex-col divide-y divide-ink-100" }, openLessons.map((lesson) => (h("li", { key: lesson.id, className: "py-2", "data-open-lesson": lesson.id },
                h(Link, { href: `/app/courses/ielts/lessons/${lesson.id}`, className: "flex items-center justify-between gap-3" },
                    h("span", { className: "min-w-0" },
                        h("span", { className: "block text-sm text-ink-900" }, lesson.title),
                        h("span", { className: "block text-xs text-ink-300" },
                            lesson.moduleTitle,
                            " \u00B7 ",
                            lesson.unitTitle)),
                    h("span", { className: "shrink-0", "data-open-lesson-state": lesson.state },
                        h(StateBadge, { state: lesson.state }))))))))));
    }
    function DashboardSkeleton() {
        return (h("div", { "aria-hidden": "true", className: "flex flex-col gap-6", "data-async-loading": "dashboard" },
            h("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-4" }, [0, 1, 2, 3].map((row) => h("div", { key: row, className: "h-24 animate-pulse rounded-xl bg-ink-50" }))),
            [0, 1, 2].map((row) => h("div", { key: row, className: "h-36 animate-pulse rounded-xl bg-ink-50" }))));
    }
    function DashboardOpenLessonsSkeleton() {
        return h("div", { "aria-hidden": "true", className: "h-40 animate-pulse rounded-xl bg-ink-50", "data-async-loading": "dashboard-open-lessons" });
    }
    function MockProgressOverviewResolved({ userId, locale, dashboard = false, }) {
        const uz = locale === "uz";
        const failure = (h(RegionFailureNotice, { region: "mock-overview", message: uz
                ? "Mock natijalarini yuklab bo'lmadi."
                : "Mock results could not be loaded.", retryLabel: uz ? "Qayta urinish" : "Retry" }));
        let data;
        try {
            data = scope.mock;
        }
        catch {
            return failure;
        }
        if (data.attemptsUnavailable || data.attemptTitlesUnavailable)
            return failure;
        const summary = summarizeMocks(data.attempts, data.tests.filter((t) => t.skill === "full").map((t) => t.id));
        const chart = h(MockBandPanel, { summary: summary, uz: uz, compact: dashboard });
        if (!dashboard)
            return (h("div", { className: "space-y-3" },
                data.catalogueUnavailable && failure,
                chart));
        return (h("section", { className: "space-y-4", "data-dashboard-mock-overview": true },
            h("div", { className: "grid items-start gap-4 lg:grid-cols-[2fr_1fr]" },
                h("div", { className: "card min-w-0 p-5 space-y-4" },
                    h("h2", { className: "font-display text-2xl font-bold" },
                        "\uD83D\uDCDD ",
                        uz ? "Mock testlar" : "Mock tests"),
                    h("p", null, uz
                        ? "Haqiqiy urinishlaringiz va mavjud testlar."
                        : "Your actual attempts and available tests."),
                    h(Link, { href: "/app/mocks", className: "btn-primary" },
                        uz ? "Mock testlarni ochish" : "Open mock tests",
                        " \u2192"),
                    data.catalogueUnavailable ? (failure) : (h("p", null,
                        data.tests.length,
                        " ",
                        uz ? "ta test mavjud" : "tests available"))),
                chart),
            h("div", { className: "card p-5 overflow-x-auto" },
                h("h3", { className: "mb-3 font-bold" }, uz ? "Hozirgacha natijalar" : "Results so far"),
                data.attempts.length ? (h("table", { className: "w-full text-left text-sm" },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Mock"),
                            h("th", null, uz ? "Sana" : "Date"),
                            h("th", null, uz ? "Bo'lim" : "Module"),
                            h("th", null, "Band"))),
                    h("tbody", null, data.attempts.slice(0, 8).map((a) => (h("tr", { key: a.id },
                        h("td", { className: "py-3" }, a.title ?? "Mock"),
                        h("td", null, a.startedAt?.toISOString().slice(0, 10) ?? "—"),
                        h("td", null, a.skill ?? "—"),
                        h("td", null, a.estimatedBand ?? "—"))))))) : (h("p", null, uz ? "Hali mock urinishlari yo'q." : "No mock attempts yet.")))));
    }
    if (scope.renderers) {
        scope.renderers.dashboard = () => DashboardContentResolved({ user, locale, dict, openLessonsPromise });
        scope.renderers.openLessons = () => DashboardOpenLessonsResolved({ dict, openLessonsPromise });
        scope.renderers.mock = () => MockProgressOverviewResolved({ userId: user.id, locale, dashboard: true });
    }
    return (h("div", { className: "mx-auto flex max-w-5xl flex-col gap-6", "data-route-usable": "dashboard" },
        h("div", null,
            h("h1", { className: "font-display text-2xl text-ink-900" },
                dict.dashboard.greeting,
                ", ",
                user.name.split(" ")[0]),
            h("p", { className: "text-sm text-ink-500" },
                dict.nav.course,
                " \u00B7 IELTS")),
        h(Suspense, { fallback: h(DashboardSkeleton, null) },
            h(MockProgressOverview, { userId: user.id, locale: locale, dashboard: true })),
        h(Suspense, { fallback: h(DashboardSkeleton, null) },
            h(DashboardContent, { user: user, locale: locale, dict: dict, openLessonsPromise: openLessonsPromise }))));
}
