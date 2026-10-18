// Reviewed source Breadcrumbs expression and parent semantics.
import {h,fragment,Link} from '../native.js';
import {breadcrumbsFor,parentFor} from './nav-routes.js';
import {IconBack,IconChevronRight} from './icons.js';
export function render({ dict, pathname }) {
    const crumbs = breadcrumbsFor(pathname, dict);
    const parent = parentFor(pathname, dict);
    if (crumbs.length === 0)
        return null;
    return (h("div", { className: "flex min-w-0 items-center gap-2", "data-breadcrumbs": true },
        parent && (h(Link, { href: parent.href, "data-back-button": true, className: "flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-ink-100 px-2.5 text-[0.875rem] font-medium text-ink-500 transition-colors hover:bg-paper-sunken hover:text-ink-900" },
            h(IconBack, { className: "text-[17px]" }),
            h("span", { className: "hidden sm:inline" }, dict.shell.back))),
        h("nav", { "aria-label": dict.shell.back, className: "flex min-w-0 items-center gap-1.5" }, crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (h("span", { key: `${crumb.href}-${index}`, className: "flex min-w-0 items-center gap-1.5" },
                index > 0 && h(IconChevronRight, { className: "shrink-0 text-[14px] text-ink-300" }),
                last ? (h("span", { className: "truncate text-[0.9375rem] font-medium text-ink-900", "aria-current": "page" }, crumb.label)) : (h(Link, { href: crumb.href, className: "hidden truncate text-[0.875rem] text-ink-300 transition-colors hover:text-ink-700 sm:inline" }, crumb.label))));
        }))));
}
