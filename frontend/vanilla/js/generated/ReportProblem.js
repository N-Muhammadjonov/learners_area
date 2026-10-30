// Reviewed source render expression: src/components/support/ReportProblem.tsx. State/events are native modules.
import {h,fragment,Link} from '../native.js';
import {Card} from './ui.js';
import {Button,BackLink} from '../../modules/shared/presentation.js';
import {IconAlert,IconClose,IconTarget,IconSparkles} from './icons.js';
import {ModuleEmoji} from './module-emoji.js';
export function render(scope) {
    const { dict, floating, open, setOpen, message, setMessage, state, viewport, lastError, error, pathname, moduleName, send } = scope;
    return (h("div", { className: floating ? "" : "border-t border-ink-100 p-4" },
        floating ? (h("button", { type: "button", "data-report-toggle": true, "aria-expanded": open, onClick: () => setOpen((v) => !v), className: "ml-auto flex min-h-[46px] items-center gap-2 rounded-full border border-ink-100 bg-paper-raised px-4 text-[0.9375rem] font-medium text-ink-700 shadow-card transition-colors hover:bg-paper-sunken" },
            h(IconAlert, { className: "text-[18px] text-ink-300" }),
            h("span", { className: "hidden sm:inline" }, dict.support.open))) : (h("button", { type: "button", className: "flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-[0.9375rem] text-ink-500 transition-colors hover:bg-paper-sunken hover:text-ink-900", onClick: () => setOpen((v) => !v), "data-report-toggle": true },
            h(IconAlert, { className: "text-[19px] text-ink-300" }),
            dict.support.open)),
        open && (h("div", { className: floating
                ? "mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-[14px] border border-ink-100 bg-paper-raised p-4 shadow-raised"
                : "mt-3 rounded-[12px] bg-paper-sunken p-3", "data-report-form": true },
            h("div", { className: "flex items-start justify-between gap-2" },
                h("div", null,
                    h("p", { className: "text-[0.875rem] font-medium text-ink-900" }, dict.support.title),
                    h("p", { className: "mt-1 text-[0.8125rem] text-ink-300" }, dict.support.subtitle)),
                floating && (h("button", { type: "button", "aria-label": dict.common.cancel, onClick: () => setOpen(false), className: "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-300 hover:bg-paper-sunken hover:text-ink-900" },
                    h(IconClose, { className: "text-[16px]" })))),
            h("textarea", { className: "input mt-2 min-h-[80px] w-full", "aria-label": dict.support.message, placeholder: dict.support.messagePlaceholder, value: message, onChange: (e) => setMessage(e.target.value), "data-report-message": true }),
            h("ul", { className: "mt-2 flex flex-col gap-0.5 text-[0.75rem] text-ink-300", "data-report-context": true },
                h("li", null,
                    dict.support.route,
                    ": ",
                    h("span", { "data-report-route": true }, pathname)),
                h("li", null,
                    dict.support.module,
                    ": ",
                    moduleName),
                viewport && (h("li", null,
                    dict.support.viewport,
                    ": ",
                    viewport)),
                h("li", null, dict.support.neverPrivate)),
            h("div", { className: "mt-2 flex items-center gap-2" },
                h(Button, { variant: "secondary", disabled: state === "sending" || message.trim().length < 3, onClick: () => void send(), "data-report-send": true }, state === "sending" ? dict.common.saving : dict.support.send),
                state === "sent" && (h("span", { className: "text-[0.8125rem] text-band-good", "data-report-sent": true }, dict.support.sent)),
                state === "failed" && (h("span", { className: "text-[0.8125rem] text-band-bad", "data-report-failed": true }, error || dict.support.failed)))))));
}
