// Reviewed source render expression: src/components/shell/ShellUtilities.tsx. State/events are native modules.
import {h,fragment,Link} from '../native.js';
import {Card} from './ui.js';
import {Button,BackLink} from '../../modules/shared/presentation.js';
import {IconAlert,IconClose,IconTarget,IconSparkles} from './icons.js';
import {ModuleEmoji} from './module-emoji.js';
export function render(scope) {
    const { dict, on, open, setOpen, useful, pathname, applyFocus, ReportProblem, containerRef, launcherRef } = scope;
    return (h("div", { ref: containerRef, className: "pointer-events-none fixed bottom-4 right-4 flex flex-col items-end gap-2", style: { zIndex: "var(--z-sticky)" }, "data-shell-utilities": true },
        open && (h("div", { id: "shell-utilities-panel", role: "group", "aria-label": dict.shell.utilities, "data-shell-utilities-panel": true, className: "pointer-events-auto flex flex-col items-end gap-2" },
            pathname !== "/app/coach" && (h(Link, { href: "/app/coach", "data-coach-fab": true, className: "flex min-h-[46px] items-center gap-2 rounded-full border border-gold/45 bg-paper-raised px-4 text-[0.9375rem] font-medium text-ink-700 shadow-card transition-colors hover:bg-paper-sunken hover:text-ink-900" },
                h(IconSparkles, { className: "text-[18px] text-gold" }),
                h("span", null, dict.nav.coach))),
            h("div", { className: "max-w-[min(22rem,calc(100vw-2rem))]" },
                h(ReportProblem, { dict: dict, floating: true })))),
        h("button", { type: "button", ref: launcherRef, "data-utilities-launcher": true, "aria-expanded": open, "aria-controls": "shell-utilities-panel", title: dict.shell.utilities, onClick: () => setOpen((value) => !value), className: `pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border p-0 text-[0.9375rem] font-medium shadow-card transition-colors ${open ? "border-signal-600 bg-signal-600 text-signal-contrast" : "border-ink-100 bg-paper-raised text-ink-700 hover:bg-paper-sunken"}` },
            open ? h(IconClose, { className: "text-[18px]" }) : h(ModuleEmoji, { kind: "eject" }),
            h("span", { className: "sr-only" }, dict.shell.utilities))));
}
