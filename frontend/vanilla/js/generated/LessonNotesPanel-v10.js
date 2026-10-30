import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {BackLink,Button} from '../../modules/shared/presentation.js';import {Input,Textarea} from '../../modules/shared/inputs.js';
export function render(scope) {
    const { dict, lessonId, text, state, maxLength, setText, flushLatest } = scope;
    const t = dict.courseRoadmap;
    const tooLong = state === "tooLong" || text.length > maxLength;
    const indicator = tooLong ? t.notesTooLong : state === "saving" ? t.notesSaving : state === "saved" ? t.notesSaved : state === "failed" ? t.notesSaveFailed : "";
    const latestTextRef = { current: text };
    return (h("div", { "data-lesson-notes-panel": true },
        h("label", { htmlFor: `notes-${lessonId}`, className: "text-sm font-medium text-ink-700" }, t.myNotes),
        h("p", { className: "mt-1 text-xs text-ink-300" }, t.notesPrivate),
        h(Textarea, { id: `notes-${lessonId}`, className: "mt-2", value: text, placeholder: t.notesPlaceholder, onChange: (event) => {
                // Synchronous, so a flush triggered in the same task as the last keystroke
                // (blur, page hide, unmount) always sees it.
                latestTextRef.current = event.target.value;
                setText(event.target.value);
            }, onBlur: () => flushLatest(false), "data-lesson-notes": true }),
        h("div", { className: "mt-1 flex items-center justify-between gap-2 text-xs" },
            h("span", { className: state === "failed" || tooLong ? "text-band-bad" : "text-ink-300", "data-lesson-notes-state": tooLong ? "too_long" : state }, indicator),
            h("span", { className: "flex items-center gap-2" },
                h("span", { className: "text-ink-300", "data-lesson-notes-count": true },
                    text.length,
                    " / ",
                    maxLength),
                state === "failed" && (h("button", { type: "button", className: "text-ink-700 underline", onClick: () => flushLatest(false), "data-lesson-notes-retry": true }, t.notesRetry))))));
}
