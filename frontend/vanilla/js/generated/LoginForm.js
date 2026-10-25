import {h,fragment,Link} from '../native.js';
import {Button} from '../../modules/shared/presentation.js';
import {Input,Label,FieldError} from '../../modules/shared/inputs.js';
export function render(scope) {
    const { dict, email, setEmail, password, setPassword, error, pending, onSubmit, recovery, googleConfigured, telegram } = scope;
    return (h("form", { onSubmit: onSubmit, className: "flex flex-col gap-4" },
        h("div", null,
            h(Label, { htmlFor: "email" }, dict.auth.email),
            h(Input, { id: "email", type: "email", required: true, value: email, onChange: (e) => setEmail(e.target.value) })),
        h("div", null,
            h(Label, { htmlFor: "password" }, dict.auth.password),
            h(Input, { id: "password", type: "password", required: true, value: password, onChange: (e) => setPassword(e.target.value) })),
        h(FieldError, null, error),
        h(Button, { type: "submit", disabled: pending }, pending ? dict.common.loading : dict.auth.loginCta),
        !recovery && h(fragment, null,
            h("div", { className: "text-right text-sm" },
                h(Link, { href: "/reset-password", className: "btn-secondary " }, dict.auth.forgotPassword)),
            h("div", { className: "relative py-1 text-center text-xs text-ink-300" },
                h("span", { className: "relative bg-paper-raised px-2" }, dict.auth.or),
                h("div", { className: "absolute inset-x-0 top-1/2 -z-10 h-px bg-ink-100" })),
            googleConfigured && (
            // A plain top-level navigation: the OIDC redirect chain must not be prefetched or fetched.
            h("a", { href: "/api/auth/google/start", className: "btn-secondary w-full justify-center", "data-google-login": true }, dict.auth.continueWithGoogle)),
            telegram)));
}
