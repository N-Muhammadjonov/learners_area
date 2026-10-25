import {h,fragment,Link} from '../native.js';
import {Button} from '../../modules/shared/presentation.js';
import {Input,Label,FieldError} from '../../modules/shared/inputs.js';
export function render(scope) {
    const { dict, name, setName, gender, setGender, genderError, setGenderError, firstGender, email, setEmail, password, setPassword, error, pending, onSubmit, telegram } = scope;
    return (h("form", { onSubmit: onSubmit, className: "flex flex-col gap-4" },
        h("div", null,
            h(Label, { htmlFor: "name" }, dict.auth.name),
            h(Input, { id: "name", required: true, value: name, onChange: (e) => setName(e.target.value) })),
        h("fieldset", null,
            h("legend", { id: "gender-label", className: "mb-1.5 text-sm font-medium text-ink-700" }, dict.auth.chooseGender),
            h("div", { className: "gender-segments", role: "radiogroup", "aria-labelledby": "gender-label", "aria-required": "true", "aria-invalid": genderError, "aria-describedby": genderError ? "gender-error" : undefined }, ["male", "female"].map((value) => (h("label", { key: value },
                h("input", { ref: value === "male" ? firstGender : undefined, type: "radio", name: "gender", value: value, required: true, checked: gender === value, "aria-describedby": genderError ? "gender-error" : undefined, onInvalid: (event) => {
                        event.preventDefault();
                        setGenderError(true);
                        firstGender.current?.focus();
                    }, onChange: () => { setGender(value); setGenderError(false); }, className: "sr-only" }),
                h("span", null, value === "male" ? dict.auth.genderMale : dict.auth.genderFemale))))),
            genderError && h("p", { id: "gender-error", role: "alert", className: "mt-1 text-xs text-band-bad" }, dict.auth.errorGenderRequired)),
        h("div", null,
            h(Label, { htmlFor: "email" }, dict.auth.email),
            h(Input, { id: "email", type: "email", required: true, value: email, onChange: (e) => setEmail(e.target.value) })),
        h("div", null,
            h(Label, { htmlFor: "password" }, dict.auth.password),
            h(Input, { id: "password", type: "password", required: true, minLength: 8, value: password, onChange: (e) => setPassword(e.target.value) })),
        h(FieldError, null, error),
        h(Button, { type: "submit", disabled: pending }, pending ? dict.common.loading : dict.auth.registerCta),
        h("div", { className: "relative py-1 text-center text-xs text-ink-300" },
            h("span", { className: "relative bg-paper-raised px-2" }, dict.auth.or),
            h("div", { className: "absolute inset-x-0 top-1/2 -z-10 h-px bg-ink-100" })),
        telegram));
}
