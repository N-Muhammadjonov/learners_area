import {h,fragment,Link} from '../native.js';
import {Button} from '../../modules/shared/presentation.js';
import {Input,Label,FieldError} from '../../modules/shared/inputs.js';
export function render(scope) {
    const { dict, email, setEmail, pending, onSubmit, error } = scope;
    return (h("form", { onSubmit: onSubmit, className: "flex flex-col gap-4" },
        h("div", null,
            h(Label, { htmlFor: "email" }, dict.auth.email),
            h(Input, { id: "email", type: "email", required: true, value: email, onChange: (e) => setEmail(e.target.value) })),
        h(Button, { type: "submit", disabled: pending }, pending ? dict.common.loading : dict.auth.resetSend),
        error && h("p", { role: "alert", className: "text-sm text-band-bad" }, error),
        h(Link, { href: "/login", className: "text-center text-sm font-medium text-signal-700 underline underline-offset-2" }, dict.auth.loginCta)));
}
export function done({ dict, devUrl }) {
    return (h("div", { className: "flex flex-col gap-3 text-sm" },
        h("p", { className: "text-ink-700" }, dict.auth.resetSubtitle),
        devUrl && (h(Link, { href: devUrl, className: "btn-secondary justify-center" }, "Open reset link (dev)")),
        h(Link, { href: "/login", className: "text-center text-sm font-medium text-signal-700 underline underline-offset-2" }, dict.auth.loginCta)));
}
