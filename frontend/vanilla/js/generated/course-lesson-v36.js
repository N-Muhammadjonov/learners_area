// Original JSX; missing VideoStudio explicitly surfaced, never substituted with an iframe.
import {h,fragment} from '../native.js';import {Card} from './ui.js';import {StateBadge} from './badges.js';import {BackLink,Button} from '../../modules/shared/presentation.js';import {formatDate} from './time.js';
export function render({ dict, lesson, unitTitle, state, notes, completedAt, openable, video, videoNotice, OwnerMaterialBlocks, LessonWorkspace }) {
    return (h("div", { className: "mx-auto flex max-w-3xl flex-col gap-4" },
        h("div", null,
            h(BackLink, { fallbackHref: "/app/courses/ielts", label: dict.courseRoadmap.back, "data-lesson-back": true }),
            h("div", { className: "mt-2 flex flex-wrap items-center justify-between gap-2" },
                h("h1", { className: "font-display text-2xl text-ink-900" }, lesson.title),
                h("span", { "data-lesson-state": state },
                    h(StateBadge, { state: state }))),
            unitTitle && h("p", { className: "text-sm text-ink-300" }, unitTitle),
            lesson.summary && h("p", { className: "mt-1 text-sm text-ink-500" }, lesson.summary)),
        lesson.recordingUrl && (h(Card, { "data-lesson-recording": true },
            h("h2", { className: "mb-2 font-display text-lg text-ink-900" }, dict.courseRoadmap.recording),
            h("video", { controls: true, src: lesson.recordingUrl, className: "w-full rounded-md bg-ink-950" }))),
        video ? (videoNotice()) : null,
        h(OwnerMaterialBlocks, { ownerType: "lesson", ownerId: lesson.id, ownerVisible: openable }),
        !openable ? (h(Card, { "data-lesson-closed": true },
            h("p", { className: "text-sm text-ink-500" }, dict.courseRoadmap.notOpenYet))) : (h(LessonWorkspace, { dict: dict, lessonId: lesson.id, state: state, initialNotes: notes ?? "", completedAt: completedAt ? completedAt.toISOString() : null }))));
}
