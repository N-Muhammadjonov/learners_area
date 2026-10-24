import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {BackLink,Button} from '../../modules/shared/presentation.js';import {Input,Textarea} from '../../modules/shared/inputs.js';
export function render(scope) {
    const { dict, detail, mediaUrl, tab, ListeningLessonBody, LessonNotesPanel } = scope;
    const t = dict.listening.lessons, TABS = ["description", "teacher-notes", "xulosangiz"];
    return (h("div", { className: "mx-auto flex max-w-3xl flex-col gap-5", "data-route-usable": "listening-lesson" },
        h("div", null,
            h(BackLink, { fallbackHref: "/app/listening/lessons", label: t.backToList, "data-listening-lesson-back": true }),
            h("h1", { className: "mt-2 font-display text-2xl text-ink-900" }, detail.lesson.title),
            h("p", { className: "mt-1 text-xs uppercase tracking-wide text-ink-300" }, t.areaLabel)),
        h(Card, { "data-listening-lesson-body-card": true },
            h("h2", { className: "mb-3 font-display text-lg text-ink-900" }, t.bodyTitle),
            detail.media && detail.media.mediaKind === "audio" && mediaUrl && (h("figure", { className: "mb-4 flex flex-col gap-2" },
                h("audio", { controls: true, preload: "none", className: "w-full", src: mediaUrl, "data-listening-lesson-audio": true }),
                h("figcaption", { className: "text-xs text-ink-300" },
                    t.mediaKind.audio,
                    detail.media.durationSeconds ? ` · ${Math.round(detail.media.durationSeconds / 60)} ${t.minutes}` : ""))),
            detail.media && detail.media.mediaKind === "video" && mediaUrl && (h("video", { controls: true, preload: "none", className: "mb-4 w-full rounded-md bg-ink-950", src: mediaUrl, "data-listening-lesson-video": true })),
            detail.media && !mediaUrl && (
            // A provider-hosted item is played by the canonical media studio, not by a
            // second player invented here.
            h("p", { className: "mb-4 text-sm text-ink-500", "data-listening-lesson-media-elsewhere": true },
                h(Link, { className: "underline", href: `/app/video-lessons/${detail.media.id}`, "data-listening-lesson-media-link": true }, detail.media.title))),
            h(ListeningLessonBody, { dict: dict, blocks: detail.blocks })),
        h("div", { className: "flex flex-wrap gap-2", role: "tablist", "data-listening-lesson-tabs": true }, TABS.map((candidate) => (h(Link, { key: candidate, href: `/app/listening/lessons/${detail.lesson.id}?tab=${candidate}`, role: "tab", "aria-selected": tab === candidate, className: tab === candidate ? "btn-primary" : "btn-secondary", "data-listening-lesson-tab": candidate, "data-active": tab === candidate ? "true" : "false" }, t.tabs[candidate === "teacher-notes" ? "teacherNotes" : candidate])))),
        h(Card, { "data-listening-lesson-panel": tab },
            tab === "description" && (h("div", { className: "flex flex-col gap-2" },
                detail.lesson.summary ? (h("p", { className: "text-sm leading-relaxed text-ink-700", "data-listening-description": true }, detail.lesson.summary)) : (h("p", { className: "text-sm text-ink-500", "data-listening-description-empty": true }, t.descriptionEmpty)),
                detail.media?.focus && (h("p", { className: "text-sm leading-relaxed text-ink-700", "data-listening-description-focus": true }, detail.media.focus)),
                detail.lesson.estimatedMinutes ? (h("p", { className: "text-xs text-ink-300" }, t.descriptionMinutes.replace("{n}", String(detail.lesson.estimatedMinutes)))) : null)),
            tab === "teacher-notes" && (h("div", { className: "flex flex-col gap-2" },
                h("p", { className: "text-xs text-ink-300" }, detail.teacherNotesSource === "media" ? t.teacherNotesLegacyHint : t.teacherNotesHint),
                detail.teacherNotes ? (h("p", { className: "whitespace-pre-line text-sm leading-relaxed text-ink-700", "data-listening-teacher-notes": true, "data-teacher-notes-source": detail.teacherNotesSource ?? "none" }, detail.teacherNotes)) : (h("p", { className: "text-sm text-ink-500", "data-listening-teacher-notes-empty": true }, t.teacherNotesEmpty)))),
            tab === "xulosangiz" && (h("div", { className: "flex flex-col gap-2" },
                h("p", { className: "text-xs text-ink-300" }, t.xulosangizHint),
                h(LessonNotesPanel, { dict: dict, lessonId: detail.lesson.id, initialNotes: detail.note }))))));
}
