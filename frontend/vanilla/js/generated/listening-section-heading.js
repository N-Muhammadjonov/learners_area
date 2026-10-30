// Reviewed source heading selection and markup.
import {h,fragment} from '../native.js';
const SECTIONS = {
    "/app/listening/lessons": "lessons",
    "/app/listening/academic": "academic",
    "/app/listening/general": "general",
    "/app/listening/mcq": "mcq",
};
export function render({ titles, pathname }) {
    const key = pathname ? SECTIONS[pathname] : undefined;
    if (!key)
        return null;
    return (h("h1", { className: "font-display text-2xl text-ink-900", "data-listening-section-heading": key }, titles[key]));
}
