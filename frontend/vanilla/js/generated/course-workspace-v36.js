import {h,fragment} from '../native.js';import {Card} from './ui.js';import {StateBadge} from './badges.js';import {BackLink,Button} from '../../modules/shared/presentation.js';import {formatDate} from './time.js';
export function render({ dict, lessonId, current, busy, error, completedAt, showNotes, initialNotes, move, LessonNotesPanel }) {
    const t = dict.courseRoadmap;
    return (h(Card, { "data-lesson-workspace": true },
        h("div", { className: "flex flex-wrap items-center gap-2", "data-lesson-actions": true },
            h(Button, { variant: "secondary", disabled: busy || current === "in_progress" || current === "completed", onClick: () => void move("in_progress"), "data-lesson-start": true }, t.startLesson),
            h(Button, { disabled: busy || current === "completed", onClick: () => void move("completed"), "data-lesson-complete": true }, t.completeLesson),
            current === "completed" && (h("span", { className: "text-sm text-band-good", "data-lesson-done": true },
                t.completedOn,
                completedAt ? ` ${formatDate(completedAt)}` : ""))),
        error && (h("p", { className: "mt-2 text-sm text-band-bad", "data-lesson-error": true }, error)),
        showNotes && h("div", { className: "mt-4" },
            h(LessonNotesPanel, { dict: dict, lessonId: lessonId, initialNotes: initialNotes }))));
}
