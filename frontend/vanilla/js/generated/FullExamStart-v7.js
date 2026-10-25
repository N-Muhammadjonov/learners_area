import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {BackLink} from '../../modules/shared/presentation.js';import {ListeningMap} from './listening-map.js';
export function render(scope) {
    const { id, title, dict, error, busy, start, soundCheck } = scope;
    const t = dict.fullListeningHub.examStart;
    return (h("div", { className: "listening-workspace card mx-auto max-w-3xl space-y-5" },
        h(BackLink, { fallbackHref: `/app/listening/tests/${id}`, label: t.back }),
        h("h1", { className: "font-display text-2xl" }, t.title.replace("{title}", title)),
        h("p", null, t.rules),
        h("button", { type: "button", className: "btn-secondary", onClick: soundCheck }, t.soundCheck),
        h("button", { type: "button", className: "btn-primary", disabled: busy, onClick: () => void start() }, t.start),
        error && h("p", { role: "alert" }, error)));
}
