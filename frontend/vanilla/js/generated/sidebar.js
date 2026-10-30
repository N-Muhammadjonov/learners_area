// Generated native DOM from reviewed source. No React runtime.
import {h,fragment,Link,InstantLink} from '../native.js';
import {ModuleEmoji,moduleEmojiFor} from './module-emoji.js';
import * as Icons from './icons.js';
const {IconDashboard,IconLive,IconAssignments,IconListening,IconVideo,IconReading,IconWriting,IconSpeaking,IconGrammar,IconVocabulary,IconProgress,IconPeople,IconAdmissions,IconSupport,IconContent,IconSettings,IconAudit}=Icons;
import {LinkPending} from '../../modules/shell/link-pending.js';
const isManagementRoute=p=>['/app/management','/app/admin','/app/owner','/app/teacher'].some(x=>p===x||p.startsWith(x+'/'));
function Group({ title, items, pathname, loading, groupKey }) {
    if (items.length === 0)
        return null;
    return (h("div", { className: "flex flex-col gap-1", "data-sidebar-group": groupKey },
        h("p", { className: "sidebar-group" }, title),
        h("ul", { className: "flex flex-col gap-0.5" }, items.map((item) => {
            const canonical = item.activePrefix ?? item.href.split("?")[0];
            const active = pathname === canonical || (!item.exact && pathname.startsWith(`${canonical}/`));
            return (h("li", { key: item.href },
                h(InstantLink, { href: item.href, intentPrefetch: true, "data-sidebar-link": item.href, "data-nav-active-prefix": canonical, "data-nav-exact": Boolean(item.exact), "aria-current": active ? "page" : undefined, className: active ? "sidebar-link sidebar-link-active" : "sidebar-link" },
                    h("span", { "aria-hidden": true, className: "sidebar-link-icon" }, moduleEmojiFor(item.href) ? h(ModuleEmoji, { kind: moduleEmojiFor(item.href) }) : item.icon),
                    h("span", { className: "sidebar-link-label" }, item.label),
                    h(LinkPending, { label: loading }))));
        }))));
}
export function SidebarNav({ dict, role, email, pathname, pendingPath = null }) {
    const activePath = pendingPath ?? pathname;
    const nav = dict.nav;
    const staff = role === "teacher" || role === "admin" || role === "owner";
    const management = isManagementRoute(activePath);
    const learning = [
        { href: "/app", label: nav.dashboard, icon: h(IconDashboard, null), exact: true },
        { href: "/app/live-classes", label: nav.liveClasses, icon: h(IconLive, null) },
        { href: "/app/assignments", label: nav.assignments, icon: h(IconAssignments, null) },
    ];
    /*
     * The module list, and the IELTS row that is not here.
     *
     * The whole centre teaches IELTS today, so a top-level "IELTS" entry beside
     * Listening and Reading promised a course switcher that does not exist —
     * there is nothing to switch to. When SAT or IT is really added, the course
     * row belongs here, above the modules; until then there is one course and it
     * does not need a name.
     */
    const modules = [
        { href: "/app/listening/lessons", activePrefix: "/app/listening", label: nav.listening, icon: h(IconListening, null) },
        { href: "/app/video-lessons", label: nav.videoLessons, icon: h(IconVideo, null) },
        { href: "/app/reading/lessons", activePrefix: "/app/reading", label: nav.reading, icon: h(IconReading, null) },
        { href: "/app/writing", label: nav.writing, icon: h(IconWriting, null) },
        { href: "/app/speaking", label: nav.speaking, icon: h(IconSpeaking, null) },
        { href: "/app/grammar/lessons", activePrefix: "/app/grammar", label: nav.grammar, icon: h(IconGrammar, null) },
        { href: "/app/vocabulary", label: nav.vocabulary, icon: h(IconVocabulary, null) },
    ];
    const progress = [
        { href: "/app/progress", label: nav.progress, icon: h(IconProgress, null) },
        { href: "/app/mocks", label: nav.mockTests, icon: h(IconProgress, null) },
    ];
    const managementItems = [];
    if (role === "admin" || role === "owner") {
        managementItems.push({ href: "/app/admin/people", label: nav.people, icon: h(IconPeople, null) }, { href: "/app/admin/admissions", label: nav.admissions, icon: h(IconAdmissions, null) });
    }
    if (role === "teacher") {
        managementItems.push({ href: "/app/teacher/students", label: nav.people, icon: h(IconPeople, null) });
    }
    if (staff) {
        managementItems.push({ href: "/app/teacher/support", label: nav.supportInbox, icon: h(IconSupport, null) }, { href: "/app/teacher/live-classes", label: nav.manageLiveClasses, icon: h(IconLive, null) }, { href: "/app/teacher/speaking", label: nav.manageSpeaking, icon: h(IconSpeaking, null) });
    }
    if (role === "admin" || role === "owner") {
        managementItems.push({ href: "/app/admin/content", label: nav.contentLibrary, icon: h(IconContent, null) });
    }
    if (role === "owner") {
        managementItems.push({ href: "/app/owner", label: nav.ownerTools, icon: h(IconSettings, null) }, { href: "/app/owner/audit", label: nav.auditLog, icon: h(IconAudit, null) });
    }
    return (h("nav", { className: "flex h-full flex-col", "aria-label": management ? dict.shell.managementNav : dict.shell.learningNav, "data-pending-route": pendingPath ?? undefined },
        management ? (h("div", { className: "flex flex-col gap-3 pb-4" },
            h(InstantLink, { href: "/app", className: "sidebar-back", "data-sidebar-back-to-learning": true },
                h("span", { "aria-hidden": true }, "\u2190"),
                nav.backToLearning),
            h("p", { className: "sidebar-mode" }, dict.shell.managementMode),
            h(Group, { groupKey: "management", title: nav.groupMain, items: [{ href: "/app/management", label: dict.shell.management, icon: h(IconDashboard, null) }], pathname: activePath, loading: dict.common.loading }),
            h(Group, { groupKey: "management", title: dict.shell.management, items: managementItems, pathname: activePath, loading: dict.common.loading }))) : (h("div", { className: "flex flex-col gap-6 pb-4" },
            h(Group, { groupKey: "main", title: nav.groupMain, items: learning, pathname: activePath, loading: dict.common.loading }),
            h(Group, { groupKey: "modules", title: nav.groupModules, items: modules, pathname: activePath, loading: dict.common.loading }),
            h(Group, { groupKey: "progress", title: nav.groupProgress, items: progress, pathname: activePath, loading: dict.common.loading }))),
        h("div", { className: "mt-auto flex flex-col gap-3 border-t border-ink-100 pt-4", "data-sidebar-group": "support" },
            h(Group, { groupKey: "support", title: dict.shell.support, items: [{ href: "/support", label: nav.support, icon: h(IconSupport, null) }], pathname: activePath, loading: dict.common.loading }),
            staff && !management && (h(InstantLink, { href: "/app/management", className: "sidebar-link sidebar-link-management", "data-sidebar-management-entry": true },
                h("span", { "aria-hidden": true, className: "sidebar-link-icon" },
                    h(IconSettings, null)),
                h("span", { className: "sidebar-link-label" }, dict.shell.switchToManagement))),
            email && (h("p", { className: "sidebar-account", title: email }, email)))));
}
