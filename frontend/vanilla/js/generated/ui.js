// Generated native DOM from reviewed source. No React runtime.
import {h,fragment,Link,InstantLink} from '../native.js';
export function Card({ className = "", kind = "standard", ...props }) {
    return h("div", { className: `card p-5 ${className}`, 'data-ui-card':kind, ...props });
}
export function StatCard({ label, value, hint, }) {
    return (h(Card, { kind:"statistics", className: "flex flex-col gap-1" },
        h("span", { className: "text-xs font-medium uppercase tracking-wide text-ink-300" }, label),
        h("span", { className: "font-display text-2xl text-ink-900" }, value),
        hint && h("span", { className: "text-xs text-ink-500" }, hint)));
}
/**
 * The empty state, in one place.
 *
 * An empty screen is not a mistake to hide — it is the answer to a question the
 * reader just asked ("what is here?"), and it has to say so in a sentence and
 * point somewhere. A grid with nothing in it looks like a broken page; the same
 * grid with one honest line and a way out looks like a product that works.
 *
 * The icon accepts a node as well as a glyph so the shell's own stroke icons can
 * be used without a second component.
 */
export function EmptyState({ icon = "○", title, body, action, ...props }) {
    return (h("div", { className: "panel flex flex-col items-center gap-2 py-12 text-center", "data-empty-state": true, ...props },
        h("span", { "aria-hidden": true, className: "la-empty-icon flex h-11 w-11 items-center justify-center text-[22px] text-ink-300" }, icon),
        h("h2", { className: "font-medium text-ink-900" }, title),
        body && h("p", { className: "max-w-[52ch] text-sm text-ink-500" }, body),
        action && h("div", { className: "mt-1" }, action)));
}
export function ProgressBar({ value, className = "" }) {
    const pct = Math.min(100, Math.max(0, value));
    return (h("div", { className: `h-1.5 w-full overflow-hidden rounded-full bg-ink-100 ${className}` },
        h("div", { className: "h-full rounded-full bg-signal-500 transition-all", style: { width: `${pct}%` } })));
}
