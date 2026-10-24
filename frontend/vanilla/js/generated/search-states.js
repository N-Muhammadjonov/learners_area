// Reviewed source GlobalSearch loading/empty render expressions.
import {h,fragment} from '../native.js';
export function loading({ dict }) {
    return (h("div", { className: "flex flex-col gap-1", "aria-live": "polite" },
        [0, 1, 2].map((i) => (h("div", { key: i, className: "flex items-center gap-3 rounded-xl px-3 py-3" },
            h("span", { className: "h-8 w-8 shrink-0 animate-pulse rounded-lg bg-paper-sunken" }),
            h("span", { className: "h-4 flex-1 animate-pulse rounded bg-paper-sunken" })))),
        h("span", { className: "sr-only" }, dict.shell.searching)));
}
export function empty({ dict }) {
    return (h("div", { className: "px-3 py-8 text-center" },
        h("p", { className: "text-[1rem] font-medium text-ink-900" }, dict.shell.noResults),
        h("p", { className: "mt-1 text-[0.875rem] text-ink-300" }, dict.shell.noResultsHint)));
}
