// Shared dashboard presentation over the existing independent data regions.
import {h,fragment,Link} from '../native.js';
import {Card,StatCard} from './ui.js';
import {ModuleEmoji} from './module-emoji.js';
import {RegionFailureNotice as FailureNotice} from '../../modules/shared/presentation.js';
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
    const slot = (key, skeleton) => { if (scope.slots[key])
        return scope.slots[key]; const host = h('div', { [key === 'openLessons' ? 'data-open-lessons-stream' : 'data-dashboard-region-slot']: key, 'aria-busy': 'true' }, skeleton); scope.slots[key] = host; return host; };
    function DashboardContent(props) { return scope.slots ? slot('dashboard', fragment({ children: [DashboardSkeleton(), DashboardOpenLessons({ dict, openLessonsPromise })] })) : DashboardContentResolved(props); }
    function DashboardOpenLessons(props) { return scope.slots ? slot('openLessons', DashboardOpenLessonsSkeleton()) : DashboardOpenLessonsResolved(props); }
    function MockProgressOverview(props) { return scope.slots ? slot('mock', DashboardSkeleton()) : MockProgressOverviewResolved(props); }
    function DashboardContentResolved({ user, locale, dict, openLessonsPromise }) {
        const data=scope.dashboard;
        const action=(href,label,variant='secondary',attrs={})=>h(Link,{href,className:'btn-'+variant,...attrs},label,h('span',{'aria-hidden':true},' →'));
        const target=data.profile?.targetBand;
        return h('div',{className:'la-dashboard-content','data-dashboard-content':true,'data-async-content':'dashboard'},
            Object.entries(data.unavailable).filter(([,failed])=>failed).map(([region])=>h(RegionFailureNotice,{region:`dashboard-${region}`,message:dict.errors.unknown,retryLabel:dict.errorPage.retry})),
            h('div',{'data-dashboard-stats':true},
                typeof target==='number'&&h(StatCard,{label:dict.dashboard.targetBand,value:target.toFixed(1)}),
                h(StatCard,{label:dict.dashboard.streak,value:data.streak===null?'—':String(data.streak)}),
                h(StatCard,{label:dict.writing.historyTitle,value:data.writingAttempts===null?'—':String(data.writingAttempts)}),
                h(StatCard,{label:dict.dashboard.vocabDue,value:data.vocabDueCount===null?'—':String(data.vocabDueCount)})),
            h(Card,{'data-my-tasks':true,kind:'practice'},
                h('div',{className:'flex flex-wrap items-start justify-between gap-4'},
                    h('div',{},h('p',{className:'la-eyebrow'},dict.assignments.title),h('h2',{className:'section-title'},dict.dashboard.myTasks)),
                    action('/app/assignments',dict.assignments.title,'primary')),
                data.openAssignments===null?h('p',{'data-tasks-unavailable':true,className:'mt-3 text-sm text-ink-500'},dict.errors.unknown):
                data.openAssignments.length===0?h('p',{'data-tasks-empty':true,className:'mt-3 text-sm text-ink-500'},dict.dashboard.noTasks):
                h('ul',{className:'mt-3 flex flex-col divide-y divide-ink-100'},data.openAssignments.map(task=>h('li',{'data-task':task.id,className:'flex flex-wrap items-center justify-between gap-2 py-3'},h('span',{className:'text-sm text-ink-900'},task.title),h('span',{className:'text-xs text-ink-500'},task.dueAt?`${dict.assignments.due}: ${formatDate(task.dueAt,locale)}`:''))))),
            h('section',{'data-dashboard-skills':true},
                h('h2',{className:'mb-3 section-title'},dict.dashboard.skillSummary),
                h('div',{},SKILLS.map(skill=>h(Link,{href:({listening:'/app/listening/lessons',reading:'/app/reading/lessons',writing:'/app/writing',speaking:'/app/speaking'})[skill],className:'card la-skill-shortcut','data-skill':skill,'data-ui-skill':skill,'data-ui-card':'module'},
                    h('span',{className:'la-skill-icon'},h(ModuleEmoji,{kind:skill})),
                    h('span',{className:'font-semibold text-ink-900'},dict.nav[skill]),
                    data.skillCounts[skill]===null?h('span',{'data-skill-unavailable':true,className:'text-xs text-ink-500'},'—'):
                    data.skillCounts[skill]===0?h('span',{className:'text-xs text-ink-500'},dict.dashboard.noAttemptsYet):h('span',{'data-skill-count':data.skillCounts[skill],className:'text-xs text-ink-500'},data.skillCounts[skill]+' '+dict.dashboard.attempts),
                    skill==='writing'&&data.latestEvaluation&&h(BandBadge,{band:data.latestEvaluation.overallEstimate}))))),
            h(Card,{'data-continue':true},h('h2',{className:'section-title'},dict.dashboard.continueLearning),
                data.unavailable.lastActivity?h('p',{'data-dashboard-region':'last-activity-unavailable',className:'mt-2 text-sm text-ink-500'},dict.errors.unknown):
                data.lastActivity?h(fragment,{},h('p',{'data-last-module':data.lastActivity.module,className:'mt-2 text-sm text-ink-500'},dict.dashboard.lastModule+': '+dict.nav[data.lastActivity.module]+' · '+formatDateTime(data.lastActivity.at,locale)),h('div',{className:'mt-4 flex flex-wrap gap-2'},action(data.lastActivity.href,dict.dashboard.pickUp,'primary',{'data-continue-link':data.lastActivity.href}),action('/app/vocabulary',dict.dashboard.reviewVocab))):
                h('div',{'data-continue-empty':true,className:'mt-2'},h('p',{className:'text-sm text-ink-500'},dict.dashboard.nothingYet),h('div',{className:'mt-4 flex flex-wrap gap-2'},action('/app/writing',dict.dashboard.startWriting,'primary'),action('/app/vocabulary',dict.dashboard.reviewVocab)))),
            h(Card,{'data-retention-drill':true},h('h2',{className:'section-title'},dict.reading.retentionModeTitle),h('p',{className:'mt-2 text-sm text-ink-500'},dict.dashboard.retentionDrillHint),h('div',{className:'mt-4'},action('/app/reading/retention',dict.dashboard.retentionDrillAction))),
            h(DashboardOpenLessons,{openLessonsPromise,dict}),
            data.nextLiveClass&&h(Card,{'data-next-live-class':data.nextLiveClass.id},h('h2',{className:'section-title'},dict.dashboard.nextClass),h('p',{className:'mt-2 text-sm text-ink-500'},formatDateTime(data.nextLiveClass.scheduledAt,locale)),h('p',{className:'mt-2 text-sm text-ink-900'},data.nextLiveClass.title),h('div',{className:'mt-4'},action('/app/live-classes',dict.liveClasses.title))),
            data.latestEvaluation&&h(Card,{},h('div',{className:'flex items-center justify-between gap-3'},h('h2',{className:'section-title'},dict.dashboard.recentFeedback),h(BandBadge,{band:data.latestEvaluation.overallEstimate})),data.latestEvaluation.weaknesses[0]&&h('p',{className:'mt-2 text-sm text-ink-500'},data.latestEvaluation.weaknesses[0]),h('p',{'data-checked-by':data.latestEvaluation.checkedByName,className:'mt-2 text-xs text-ink-500'},dict.coach.checkedBy+' '+data.latestEvaluation.checkedByName),h('div',{className:'mt-4'},action('/app/coach',dict.coach.title))));
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
                    h(Link, { href: "/app/mocks", className: "btn-secondary" },
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
    return (h("div", { className: "mx-auto flex w-full max-w-7xl flex-col gap-6", "data-route-usable": "dashboard" },
        h("header", {className:"la-dashboard-hero"}, h("div",{},
            h("p",{className:"la-eyebrow"},"Learners Area"),
            h("h1", { className: "font-display text-2xl text-ink-900" },
                dict.dashboard.greeting,
                ", ",
                user.name.split(" ")[0]),
            null)),
        h(Suspense, { fallback: h(DashboardSkeleton, null) },
            h(DashboardContent, { user: user, locale: locale, dict: dict, openLessonsPromise: openLessonsPromise })),
        h(Suspense, { fallback: h(DashboardSkeleton, null) },
            h(MockProgressOverview, { userId: user.id, locale: locale, dashboard: true }))));
}
