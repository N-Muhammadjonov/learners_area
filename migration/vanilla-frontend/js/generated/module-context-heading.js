// Reviewed source module identity and Management parent links.
import {h,fragment,Link} from '../native.js';
import {parentFor} from './nav-routes.js';
import {IconBack} from './icons.js';
import {render as renderCrumbs} from './breadcrumbs.js';
export function render({ dict, pathname }) {
    const Breadcrumbs = p => renderCrumbs({ ...p, pathname });
    const modules = [
        { key: "dashboard", path: "/app", label: dict.nav.dashboard, exact: true },
        { key: "listening", path: "/app/listening", label: dict.nav.listening },
        { key: "video-lessons", path: "/app/video-lessons", label: dict.nav.videoLessons },
        { key: "reading", path: "/app/reading", label: dict.nav.reading },
        { key: "writing", path: "/app/writing", label: dict.nav.writing },
        { key: "speaking", path: "/app/speaking", label: dict.nav.speaking },
        { key: "grammar", path: "/app/grammar", label: dict.nav.grammar },
        { key: "vocabulary", path: "/app/vocabulary", label: dict.nav.vocabulary },
        { key: "live-classes", path: "/app/live-classes", label: dict.nav.liveClasses },
        { key: "assignments", path: "/app/assignments", label: dict.nav.assignments },
        { key: "progress", path: "/app/progress", label: dict.nav.progress },
        { key: "mocks", path: "/app/mocks", label: dict.nav.mockTests },
        { key: "management", path: "/app/management", label: dict.nav.management },
        { key: "management", path: "/app/admin", label: dict.nav.management },
        { key: "management", path: "/app/teacher", label: dict.nav.management },
        { key: "management", path: "/app/owner", label: dict.nav.management },
    ];
    const activeModule = modules.find(item => ("exact" in item && item.exact)
        ? pathname === item.path
        : pathname === item.path || pathname.startsWith(item.path + "/"));
    if (!activeModule)
        return h(Breadcrumbs, { dict: dict });
    const parent = activeModule.key === "management" ? parentFor(pathname, dict) : null;
    return (h("div", { className: "flex min-w-0 items-center gap-2" },
        parent && (h(Link, { href: parent.href, "aria-label": `${dict.shell.back}: ${parent.label}`, className: "flex h-10 shrink-0 items-center rounded-[10px] border border-ink-100 px-2 text-ink-700 hover:text-ink-900" },
            h(IconBack, { className: "text-[17px]" }))),
        h("span", { "data-module-context-heading": activeModule.key, "aria-current": "location", className: "min-w-0 truncate text-base font-semibold text-ink-900" }, activeModule.label)));
}
