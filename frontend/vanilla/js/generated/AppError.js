// Reviewed source render expression: src/app/app/(shell)/error.tsx. State/events are native modules.
import {h,fragment,Link} from '../native.js';
import {Card} from './ui.js';
import {Button,BackLink} from '../../modules/shared/presentation.js';
import {IconAlert,IconClose,IconTarget,IconSparkles} from './icons.js';
import {ModuleEmoji} from './module-emoji.js';
export function render(scope) {
    const { dict, parent, error, reset } = scope;
    return (h("div", { className: "mx-auto flex max-w-[560px] flex-col items-start gap-4 py-16", "data-app-error": true },
        h("span", { "aria-hidden": true, className: "flex h-12 w-12 items-center justify-center rounded-2xl border border-band-bad/40 bg-band-bad/10 text-[24px] text-band-bad" },
            h(IconAlert, null)),
        h("h1", { className: "font-display text-[1.5rem] leading-snug text-ink-900" }, dict.errorPage.title),
        h("p", { className: "body-text" }, dict.errorPage.body),
        h("div", { className: "flex flex-wrap items-center gap-3" },
            h(Button, { onClick: () => reset(), "data-error-retry": true }, dict.errorPage.retry),
            parent && (h(Link, { href: parent.href, className: "btn-secondary", "data-error-back": true }, dict.errorPage.back)),
            h(Link, { href: "/app", className: "btn-ghost", "data-error-dashboard": true }, dict.errorPage.dashboard)),
        h("p", { className: "meta-text" },
            dict.errorPage.code,
            ":",
            " ",
            h("span", { "data-error-code": error.digest ?? "render_error" }, error.digest ?? "render_error"))));
}
