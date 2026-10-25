import {h,fragment,Link} from '../native.js';
import {Button} from '../../modules/shared/presentation.js';
import {Input,Label,FieldError} from '../../modules/shared/inputs.js';
export function render(scope) {
    const { dict, password, setPassword, error, pending, onSubmit, token } = scope;
    return (h("form", { onSubmit: onSubmit, className: "flex flex-col gap-4" },
        h("div", null,
            h(Label, { htmlFor: "password" }, dict.auth.password),
            h(Input, { id: "password", type: "password", required: true, minLength: 8, value: password, onChange: (e) => setPassword(e.target.value) })),
        h(FieldError, null, error),
        h(Button, { type: "submit", disabled: pending || !token }, pending ? dict.common.loading : dict.auth.resetConfirmCta),
        h(Link, { href: "/login", className: "text-center text-sm font-medium text-signal-700 underline underline-offset-2" }, dict.auth.loginCta)));
}
