import {h,fragment} from '../native.js';
export function ListeningMap({ diagram }) {
    return h("svg", { viewBox: diagram.viewBox.join(" "), role: "img", "aria-label": diagram.label, className: "h-auto w-full bg-white text-black", "data-listening-map": true }, diagram.shapes.map(({ tag: Tag, text, ...attributes }, index) => h(Tag, { key: index, ...attributes }, Tag === "text" ? text : undefined)));
}
