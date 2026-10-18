import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {BackLink,Button} from '../../modules/shared/presentation.js';import {Input,Textarea} from '../../modules/shared/inputs.js';
function referenceTitle(block) {
    const content = block.referenced?.content;
    return content && typeof content.title === "string" && content.title.trim() ? content.title : null;
}
function isMediaReference(block) {
    return block.ref?.module === "ted";
}
export function render(scope) {
    const { dict, blocks, highlightScope, LessonQuizBlock } = scope;
    const t = dict.listening.lessons;
    return (h("div", { className: "flex flex-col gap-5", "data-lesson-body": true }, blocks.map((block, index) => (h("div", { key: `${block.position}-${index}`, "data-lesson-block": block.type },
        block.type === "text" && block.text && (h("div", { className: "flex flex-col gap-3 text-sm leading-relaxed text-ink-700" }, block.text.split(/\n{2,}/).map((paragraph, position) => (highlightScope ? h(ReadingLessonText, { key: position, dict: dict, text: paragraph, scope: `${highlightScope}:${block.blockId}:${index}:${position}` }) : h("p", { key: position }, paragraph))))),
        block.type === "audio" && block.objectKey && (h("figure", { className: "flex flex-col gap-2" },
            h("audio", { controls: true, preload: "none", className: "w-full", src: `/api/resources/${block.objectKey}`, "data-lesson-audio": true }),
            h("figcaption", { className: "text-xs text-ink-300" }, t.audioSource))),
        block.type === "video" && block.objectKey && (h("video", { controls: true, preload: "none", className: "w-full rounded-md bg-ink-950", src: `/api/resources/${block.objectKey}`, "data-lesson-video": true })),
        block.type === "image" && block.objectKey && (
        // eslint-disable-next-line @next/next/no-img-element
        h("img", { src: `/api/resources/${block.objectKey}`, alt: "", className: "w-full rounded-md", "data-lesson-image": true })),
        block.type === "file" && block.objectKey && (h("a", { className: "underline text-ink-700", href: `/api/resources/${block.objectKey}`, "data-lesson-file": true }, t.download)),
        block.type === "link" && block.url && (h("a", { className: "underline text-ink-700", href: block.url, rel: "noreferrer noopener", target: "_blank", "data-lesson-link": true }, block.text || block.url)),
        block.type === "quiz" && block.quiz && (h(LessonQuizBlock, { dict: dict, blockId: block.blockId, prompt: block.quiz.prompt, options: block.quiz.options, response: block.response ? { answer: block.response.answer, correct: block.response.correct } : null })),
        block.type === "content_reference" && (h("div", { className: "rounded-xl border border-ink-100 p-4", "data-lesson-reference": true },
            h("p", { className: "text-xs uppercase tracking-wide text-ink-300" }, t.referencedContent),
            block.referenceProblem ? (h("p", { className: "mt-1 text-sm text-band-bad", "data-lesson-reference-problem": true }, block.referenceProblem)) : (h("div", { className: "mt-1 flex flex-col gap-1" },
                h("p", { className: "text-sm font-medium text-ink-900" }, referenceTitle(block) ?? (block.ref ? `${block.ref.module}:${block.ref.contentType}` : "")),
                block.ref && h("p", { className: "text-xs text-ink-300" }, block.ref.sourceRef),
                isMediaReference(block) && (
                // The canonical media library, not a fabricated deep link: the
                // reference stores a stable source ref, and the media surface is
                // reached by the id its own library resolves.
                h(Link, { className: "text-sm underline text-ink-700", href: "/app/video-lessons", "data-lesson-reference-link": true }, t.openMediaLibrary)))))))))));
}
