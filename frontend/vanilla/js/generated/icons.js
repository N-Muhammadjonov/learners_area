// Generated native DOM from reviewed source. No React runtime.
import {h,fragment,Link,InstantLink} from '../native.js';
/**
 * Icons.
 *
 * One original stroke set, drawn on the same 24×24 grid with the same 1.6px
 * stroke, currentColor for the stroke and no fills — so an icon looks right in
 * both themes and next to text of any size. They are geometric shapes, not
 * copies of anybody's artwork.
 *
 * An icon never carries meaning on its own: every place these are used also has
 * a word next to it. That rule exists because the product's own Day/Night
 * control once shipped as a bare moon, and "what does this button do?" was a
 * real question students asked.
 */
function Icon({ className = "", title, children }) {
    return (h("svg", { viewBox: "0 0 24 24", width: "1em", height: "1em", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", className: className, "aria-hidden": title ? undefined : true, role: title ? "img" : undefined, focusable: "false" },
        title && h("title", null, title),
        children));
}
export function IconDashboard({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("rect", { x: "3.5", y: "3.5", width: "7", height: "7", rx: "2" }),
        h("rect", { x: "13.5", y: "3.5", width: "7", height: "7", rx: "2" }),
        h("rect", { x: "3.5", y: "13.5", width: "7", height: "7", rx: "2" }),
        h("rect", { x: "13.5", y: "13.5", width: "7", height: "7", rx: "2" })));
}
export function IconLive({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("rect", { x: "3", y: "5", width: "13", height: "14", rx: "2.5" }),
        h("path", { d: "M16 10.5 21 8v8l-5-2.5z" })));
}
export function IconAssignments({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M7 3.5h7l4.5 4.5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" }),
        h("path", { d: "M14 3.5V8h4.5" }),
        h("path", { d: "M9 13h6M9 16.5h4" })));
}
export function IconListening({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M4.5 13a7.5 7.5 0 0 1 15 0" }),
        h("rect", { x: "3", y: "13", width: "4", height: "6", rx: "2" }),
        h("rect", { x: "17", y: "13", width: "4", height: "6", rx: "2" }),
        h("path", { d: "M19 19v1.5" })));
}
export function IconReading({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M12 6.5C10.5 5.2 8.4 4.5 5.5 4.5H4v14h1.5c2.9 0 5 .7 6.5 2 1.5-1.3 3.6-2 6.5-2H20v-14h-1.5c-2.9 0-5 .7-6.5 2z" }),
        h("path", { d: "M12 6.5v14" })));
}
export function IconWriting({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M4 19.5h16" }),
        h("path", { d: "M6.5 16.5 16.8 6.2a2 2 0 0 1 2.8 2.8L9.3 19.3l-3.6.8z" }),
        h("path", { d: "M14.8 8.2l1.9 1.9" })));
}
export function IconSpeaking({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("rect", { x: "9", y: "3", width: "6", height: "10", rx: "3" }),
        h("path", { d: "M5.5 11.5a6.5 6.5 0 0 0 13 0" }),
        h("path", { d: "M12 18v3" })));
}
export function IconGrammar({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M4 6.5h9M4 12h16M4 17.5h6" }),
        h("circle", { cx: "17.5", cy: "6.5", r: "2.2" })));
}
export function IconVocabulary({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M5 4.5h9.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" }),
        h("path", { d: "M16.5 6.5H19a1 1 0 0 1 1 1v10.5a1.5 1.5 0 0 1-1.5 1.5H16.5" }),
        h("path", { d: "M8 9h6M8 12.5h4" })));
}
export function IconVideo({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("rect", { x: "2.5", y: "5", width: "19", height: "14", rx: "2.5" }),
        h("path", { d: "M10 9.5l5 2.5-5 2.5z" })));
}
export function IconProgress({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M4 19.5V10M10 19.5V5M16 19.5v-6M22 19.5H2" })));
}
export function IconMock({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("circle", { cx: "12", cy: "12", r: "8.5" }),
        h("path", { d: "M12 7.5V12l3 2" })));
}
export function IconSupport({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M4 5.5h16v10H9l-5 4z" }),
        h("path", { d: "M9 9.5h6M9 12.5h4" })));
}
export function IconSettings({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("circle", { cx: "12", cy: "12", r: "3" }),
        h("path", { d: "M12 3.5v2.2M12 18.3v2.2M4.9 7.7l1.9 1.1M17.2 15.2l1.9 1.1M4.9 16.3l1.9-1.1M17.2 8.8l1.9-1.1" })));
}
export function IconSearch({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("circle", { cx: "11", cy: "11", r: "6.5" }),
        h("path", { d: "m16 16 4 4" })));
}
export function IconSun({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("circle", { cx: "12", cy: "12", r: "4" }),
        h("path", { d: "M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" })));
}
export function IconMoon({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" })));
}
export function IconTarget({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("circle", { cx: "12", cy: "12", r: "8" }),
        h("circle", { cx: "12", cy: "12", r: "4" }),
        h("circle", { cx: "12", cy: "12", r: "1" })));
}
export function IconSparkles({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "m11 3 1.8 6.2L19 11l-6.2 1.8L11 19l-1.8-6.2L3 11l6.2-1.8L11 3z" }),
        h("path", { d: "m19 14.5.8 2.7 2.7.8-2.7.8L19 21.5l-.8-2.7-2.7-.8 2.7-.8.8-2.7z" })));
}
export function IconChevronRight({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "m9.5 5.5 6.5 6.5-6.5 6.5" })));
}
export function IconChevronLeft({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M14.5 5.5 8 12l6.5 6.5" })));
}
export function IconArrowLeft({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M20 12H4" }),
        h("path", { d: "m10 6-6 6 6 6" })));
}
export function IconChevronDown({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "m5.5 9.5 6.5 6.5 6.5-6.5" })));
}
/** Back navigation: the arrow that means "the page you came from". */
export function IconBack({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M20 12H4" }),
        h("path", { d: "m10 6-6 6 6 6" })));
}
export function IconClose({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M6 6l12 12M18 6 6 18" })));
}
export function IconMenu({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M4 7h16M4 12h16M4 17h16" })));
}
export function IconBell({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M6.5 9.5a5.5 5.5 0 0 1 11 0v4l1.5 3h-14l1.5-3z" }),
        h("path", { d: "M10 19.5a2 2 0 0 0 4 0" })));
}
export function IconUser({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("circle", { cx: "12", cy: "8.5", r: "3.8" }),
        h("path", { d: "M4.5 20.5a7.5 7.5 0 0 1 15 0" })));
}
export function IconLogout({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M14 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H14" }),
        h("path", { d: "M17 8.5 20.5 12 17 15.5" }),
        h("path", { d: "M10.5 12h10" })));
}
export function IconRetention({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M12 4.5c4.5 0 7.5 3 9 7.5-1.5 4.5-4.5 7.5-9 7.5S4.5 16.5 3 12c1.5-4.5 4.5-7.5 9-7.5z" }),
        h("circle", { cx: "12", cy: "12", r: "2.5" })));
}
/** A tick — used where a save really succeeded and the screen must say so. */
export function IconCheck({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "m5 12.5 4.5 4.5L19 7.5" })));
}
export function IconAlert({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M12 4.5 21 19.5H3z" }),
        h("path", { d: "M12 10v4M12 16.8v.4" })));
}
export function IconPlay({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("circle", { cx: "12", cy: "12", r: "8.5" }),
        h("path", { d: "M10 8.8 16 12l-6 3.2z" })));
}
export function IconPeople({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("circle", { cx: "9", cy: "9", r: "3.2" }),
        h("path", { d: "M3.5 19.5a5.5 5.5 0 0 1 11 0" }),
        h("path", { d: "M16 6.2a3 3 0 0 1 0 5.6M17.5 19.5a5.4 5.4 0 0 0-1.6-3.8" })));
}
export function IconAdmissions({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" }),
        h("path", { d: "m9 12 2 2 4-4" })));
}
export function IconContent({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("rect", { x: "3.5", y: "4.5", width: "17", height: "5", rx: "1.5" }),
        h("rect", { x: "3.5", y: "14.5", width: "7.5", height: "5", rx: "1.5" }),
        h("rect", { x: "13.5", y: "14.5", width: "7", height: "5", rx: "1.5" })));
}
export function IconAudit({ className, title }) {
    return (h(Icon, { className: className, title: title },
        h("path", { d: "M6 3.5h9l4 4V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z" }),
        h("path", { d: "M15 3.5V8h4" }),
        h("path", { d: "M8.5 13h7M8.5 16h4" })));
}
