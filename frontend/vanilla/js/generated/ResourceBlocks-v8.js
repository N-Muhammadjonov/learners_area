import {h,fragment,Link} from '../native.js';import {ListeningMap} from './listening-map.js';import {occurrenceSpans} from './listening-occurrence-spans.js';
import {Card,EmptyState} from './ui.js';import {Button} from '../../modules/shared/presentation.js';import {Input} from '../../modules/shared/inputs.js';
import {IconChevronDown,IconChevronRight} from './icons.js';
export function render(scope) {
    const { dict, blocks, title, lexicalAssistance = true, ClickableText } = scope;
    if (!blocks.length)
        return null;
    const t = dict.resources;
    return (h("section", { className: "card flex flex-col gap-3 p-5", "data-resource-blocks": true },
        h("h2", { className: "card-title" }, title ?? t.studentsTitle),
        h("ul", { className: "flex flex-col gap-3" }, blocks.map((block) => (h("li", { key: block.id, className: "flex flex-col gap-1.5", "data-resource-block": block.type },
            block.type === "text" && (h(ClickableText, { dict: dict, text: block.textContent ?? "", sourceType: "material", sourceId: block.id, lexicalAssistance: lexicalAssistance, className: "text-sm leading-relaxed text-ink-700" })),
            block.type === "link" && block.linkUrl && (h("a", { href: block.linkUrl, target: "_blank", rel: "noreferrer noopener", className: "btn-secondary " },
                h(IconChevronRight, { className: "text-[16px]" }),
                block.originalName ?? t.openLink)),
            block.type === "image" && block.objectKey && (
            // eslint-disable-next-line @next/next/no-img-element -- private object key, not a build-time asset
            h("img", { src: `/api/resources/${block.objectKey}`, alt: block.originalName ?? t.blockImage, className: "max-h-80 w-auto rounded-sm border border-ink-100", loading: "lazy" })),
            block.type === "audio" && block.objectKey && (h("div", { className: "flex flex-col gap-1" },
                h("span", { className: "text-xs text-ink-300" }, block.originalName),
                h("audio", { controls: true, preload: "none", src: `/api/resources/${block.objectKey}`, className: "w-full" }, t.blockAudio))),
            block.type === "file" && block.objectKey && (h("a", { href: `/api/resources/${block.objectKey}`, className: "btn-secondary " },
                h(IconChevronDown, { className: "text-[16px]" }),
                block.originalName,
                " \u2014 ",
                t.download))))))));
}
