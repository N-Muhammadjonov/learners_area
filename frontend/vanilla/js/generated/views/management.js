// Source: src/app/app/(shell)/management/page.tsx :: ManagementPage
// Native DOM presentation; server data via documented adapter, never bundled.
import {h,fragment,Link,InstantLink} from '../../native.js';
import {Card,StatCard,EmptyState,ProgressBar} from '../ui.js';
import {BackLink,Button,RegionFailureNotice as FailureNotice} from '../../../modules/shared/presentation.js';
import {microphoneTest} from '../../../modules/speaking/microphone.js';
import {notificationRead} from '../../../modules/shared/notification-read.js';
import {IconChevronRight,IconPeople,IconAdmissions,IconSupport,IconLive,IconSpeaking,IconPlay,IconContent,IconReading,IconListening,IconGrammar,IconWriting,IconAudit,IconSettings,IconRetention} from '../icons.js';
export function render(scope) {
    const { context, dict, user, locale, library, page = 1, cards, total, hasMore, days, rows, sets, counts, inventory, writingOther } = scope;
    const isStaff = role => ['teacher', 'admin', 'owner'].includes(role), isAdministrator = role => ['admin', 'owner'].includes(role);
    const MicrophoneTest = p => microphoneTest({ ...context, ...p }), NotificationRead = p => notificationRead({ ...context, ...p }), RegionFailureNotice = p => FailureNotice({ ...p, refresh: context.refresh });
    const kindLabel = (dict, type) => dict.admin[({ lesson: 'materialsKindLesson', reading: 'materialsKindReading', listening: 'materialsKindListening', writing: 'materialsKindWriting', speaking: 'materialsKindSpeaking', grammar: 'materialsKindGrammar', assignment: 'materialsKindAssignment', live_class: 'materialsKindLiveClass' })[type]];
    const staff = user;
    const areas = [];
    const admin = isAdministrator(user.role);
    const owner = user.role === "owner";
    if (admin || owner) {
        areas.push({
            href: "/app/admin/people",
            title: dict.nav.adminUsers,
            body: dict.management.peopleBody,
            icon: h(IconPeople, null),
        }, {
            href: "/app/admin/admissions",
            title: dict.admission.title,
            body: dict.management.admissionsBody,
            icon: h(IconAdmissions, null),
        }, {
            href: "/app/admin/roster",
            title: dict.reporter.roster.title,
            body: dict.reporter.roster.body,
            icon: h(IconPeople, null),
        });
    }
    if (user.role === "teacher") {
        areas.push({ href: "/app/teacher/students", title: dict.nav.people, body: dict.management.studentsBody, icon: h(IconPeople, null) });
    }
    if (isStaff(user.role)) {
        areas.push({
            href: "/app/teacher/support",
            title: dict.support.inbox,
            body: dict.management.supportBody,
            icon: h(IconSupport, null),
        }, {
            href: "/app/teacher/live-classes",
            title: dict.liveClasses.manageTitle,
            body: dict.management.liveBody,
            icon: h(IconLive, null),
        }, {
            href: "/app/teacher/speaking",
            title: dict.speaking.manageTitle,
            body: dict.management.speakingBody,
            icon: h(IconSpeaking, null),
        });
    }
    if (staff && !admin) {
        areas.push({ href: "/app/admin/video-lessons", title: dict.videoLessonAdmin.title, body: dict.management.videoBody, icon: h(IconPlay, null) }, { href: "/app/admin/materials", title: dict.admin.materialsTitle, body: dict.management.materialsBody, icon: h(IconContent, null) });
    }
    if (admin) {
        areas.push({
            href: "/app/admin/reading",
            title: dict.admin.readingTitle,
            body: dict.management.readingBody,
            icon: h(IconReading, null),
        }, {
            href: "/app/admin/listening",
            title: dict.admin.listeningTitle,
            body: dict.management.listeningBody,
            icon: h(IconListening, null),
        }, {
            href: "/app/admin/grammar",
            title: dict.admin.grammarTitle,
            body: dict.management.grammarBody,
            icon: h(IconGrammar, null),
        }, {
            href: "/app/admin/writing",
            title: dict.admin.writingAdmin.title,
            body: dict.management.writingBody,
            icon: h(IconWriting, null),
        }, {
            href: "/app/admin/video-lessons",
            title: dict.videoLessonAdmin.title,
            body: dict.management.videoBody,
            icon: h(IconPlay, null),
        }, {
            href: "/app/admin/materials",
            title: dict.admin.materialsTitle,
            body: dict.management.materialsBody,
            icon: h(IconContent, null),
        }, {
            href: "/app/admin/content",
            title: dict.nav.contentLibrary,
            body: dict.management.contentBody,
            icon: h(IconContent, null),
        });
    }
    areas.push({
        href: "/app/reports",
        title: dict.reporter.title,
        body: dict.reporter.managementBody,
        icon: h(IconAudit, null),
    });
    if (owner) {
        areas.push({
            href: "/app/owner",
            title: dict.owner.title,
            body: dict.management.ownerBody,
            icon: h(IconSettings, null),
        }, {
            href: "/app/owner/integrations",
            title: dict.owner.integrations,
            body: dict.management.integrationsBody,
            icon: h(IconSettings, null),
        }, {
            href: "/app/owner/retention",
            title: dict.owner.retention,
            body: dict.management.retentionBody,
            icon: h(IconRetention, null),
        }, {
            href: "/app/owner/audit",
            title: dict.owner.audit,
            body: dict.management.auditBody,
            icon: h(IconAudit, null),
        });
    }
    return (h("div", { className: "flex flex-col gap-8", "data-management-hub": true },
        h("header", { className: "flex flex-col gap-2" },
            h("h1", { className: "page-title" }, dict.management.title),
            h("p", { className: "page-subtitle" }, dict.management.subtitle),
            h(Link, { href: "/app", "data-management-back": true, className: "mt-1 inline-flex w-fit min-h-[44px] items-center gap-2 rounded-[10px] border border-gold/45 bg-gold/10 px-3.5 text-[0.9375rem] font-medium text-ink-900 transition-colors hover:bg-gold/20" },
                h(IconChevronRight, { className: "rotate-180 text-[18px] text-gold" }),
                dict.management.backToLearning)),
        areas.length === 0 ? (h(EmptyState, { icon: "\u2699", title: dict.management.emptyForRole })) : (h("div", { className: "grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" }, areas.map((area) => (h(Link, { key: area.href, href: area.href, prefetch: false, "data-management-area": area.href, className: "panel group flex min-h-[150px] flex-col gap-3 transition-colors hover:border-gold/45 hover:bg-paper-sunken" },
            h("span", { "aria-hidden": true, className: "flex h-11 w-11 items-center justify-center rounded-xl border border-ink-100 bg-paper-sunken text-[22px] text-gold" }, area.icon),
            h("span", { className: "card-title" }, area.title),
            h("span", { className: "body-text flex-1 text-[0.9375rem]" }, area.body),
            h("span", { className: "inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-ink-500 group-hover:text-ink-900" },
                h(IconChevronRight, { className: "text-[16px]" })))))))));
}
