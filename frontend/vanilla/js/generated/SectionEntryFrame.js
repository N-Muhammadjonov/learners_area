import {h,fragment} from '../native.js';
"use client";
/**
 * A route-specific workspace identity with only its unresolved local region
 * skeletonized. It is intentionally not a generic "Loading" destination page.
 */
export function SectionEntryFrame({ routeKey, frame, privateBoundary = false, stalled = false, slowMessage, retryLabel, onRetry, }) {
    return (h("section", { className: "mx-auto flex w-full max-w-6xl flex-col gap-4", role: "status", "aria-live": "polite", "aria-atomic": "true", "aria-busy": "true", "data-entry-frame": true, "data-section-entry-frame": routeKey, "data-private-loading-boundary": privateBoundary ? "true" : undefined },
        h("header", null,
            h("h1", { className: "font-display text-2xl text-ink-900", tabIndex: -1 }, frame.title),
            frame.subtitle && h("p", { className: "mt-1 max-w-3xl text-sm text-ink-500" }, frame.subtitle)),
        frame.tabs && (h("div", { className: "flex gap-1 overflow-hidden rounded-md border border-ink-100 bg-paper-raised p-1", "data-entry-tab-shell": true, "aria-hidden": "true" }, frame.tabs.map((label, index) => (h("span", { key: `${label}-${index}`, className: `h-9 shrink-0 rounded-sm px-3 py-2 text-xs ${index === 0 ? "bg-signal-50 text-ink-500" : "text-ink-300"}` }, label))))),
        h(EntryRegion, { shape: frame.shape }),
        stalled && slowMessage && retryLabel && onRetry && (h("div", { className: "flex flex-wrap items-center justify-between gap-3 rounded-md border border-band-bad/30 bg-band-bad/5 px-3 py-2 text-sm", role: "alert", "data-entry-retry": true },
            h("span", { className: "text-ink-700" }, slowMessage),
            h("button", { type: "button", className: "btn-secondary", onClick: onRetry }, retryLabel)))));
}
function EntryRegion({ shape }) {
    return (h("div", { "aria-hidden": "true", "data-entry-region": shape, "data-async-loading": `entry-${shape}`, className: "flex flex-col gap-3" },
        shape === "dashboard" && h(fragment, null,
            h("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-4" }, [0, 1, 2, 3].map((item) => h(Block, { key: item, className: "h-20" }))),
            h("div", { className: "grid gap-3 sm:grid-cols-2" },
                h(Block, { className: "h-28" }),
                h(Block, { className: "h-28" }))),
        shape === "classes" && h(RowSkeletons, { count: 3, height: "h-20" }),
        shape === "assignments" && h(RowSkeletons, { count: 2, height: "h-28" }),
        shape === "list" && h(RowSkeletons, { count: 3, height: "h-16" }),
        shape === "reading" && h(fragment, null,
            h("div", { className: "flex gap-2 overflow-hidden" },
                h(Block, { className: "h-8 w-20" }),
                h(Block, { className: "h-8 w-24" }),
                h(Block, { className: "h-8 w-20" }),
                h(Block, { className: "h-8 w-24" })),
            h(RowSkeletons, { count: 3, height: "h-16" })),
        shape === "writing" && h(fragment, null,
            h(Block, { className: "h-28" }),
            h(Block, { className: "h-36" })),
        shape === "speaking" && h(RowSkeletons, { count: 2, height: "h-20" }),
        shape === "grammar" && h(RowSkeletons, { count: 3, height: "h-20" }),
        shape === "vocabulary" && h(fragment, null,
            h("div", { className: "grid grid-cols-2 gap-2 sm:grid-cols-3" }, [0, 1, 2].map((item) => h(Block, { key: item, className: "h-14" }))),
            h(RowSkeletons, { count: 2, height: "h-16" })),
        shape === "progress" && h(fragment, null,
            h(Block, { className: "h-28" }),
            h("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-3" }, [0, 1, 2].map((item) => h(Block, { key: item, className: "h-20" })))),
        shape === "mocks" && h(fragment, null,
            h(Block, { className: "h-20" }),
            h(Block, { className: "h-24" })),
        shape === "management" && h("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2" }, [0, 1, 2, 3].map((item) => h(Block, { key: item, className: "h-24" }))),
        shape === "simple" && h(RowSkeletons, { count: 2, height: "h-14" })));
}
function RowSkeletons({ count, height }) {
    return h(fragment, null, Array.from({ length: count }, (_, index) => h(Block, { key: index, className: height })));
}
function Block({ className }) {
    return h("span", { className: `block animate-pulse rounded-xl bg-ink-50 ${className}` });
}
