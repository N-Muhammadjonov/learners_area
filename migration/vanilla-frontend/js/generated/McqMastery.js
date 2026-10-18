// Reviewed source render expression: src/components/listening/McqMastery.tsx. State/events are native modules.
import {h,fragment,Link} from '../native.js';
import {Card} from './ui.js';
import {Button,BackLink} from '../../modules/shared/presentation.js';
import {IconAlert,IconClose,IconTarget,IconSparkles} from './icons.js';
import {ModuleEmoji} from './module-emoji.js';
const STAGE_LABEL = {
    listen: "mcqStageListen",
    notes: "mcqStageNotes",
    committed: "mcqStageCommitted",
    revealed: "mcqStageRevealed",
    chosen: "mcqStageChosen",
    reasoned: "mcqStageReasoned",
};
const FIELD_LABEL = {
    notes: "mcqNotesLabel",
    ownAnswer: "mcqOwnAnswerLabel",
    chosenAnswer: "mcqChoose",
    reasoning: "mcqReasoningLabel",
};
export function render(scope) {
    const { questions, open, payload, text, error, busy, openDrill, advance, setText, dict, dayNavigation, audioUrl } = scope;
    return (h(Card, null,
        h("div", { className: "flex flex-wrap items-center justify-between gap-2" },
            h("h2", { className: "font-display text-lg text-ink-900" }, dict.listening.mcqTitle),
            h("span", { className: "text-xs text-ink-300" }, dict.listening.mcqHint)),
        h("ul", { className: "mt-3 flex flex-col divide-y divide-ink-100" }, questions.map((q) => {
            const isOpen = open === q.id && payload;
            return (h("li", { key: q.id, className: "py-3", "data-mcq-question": q.id, "data-mcq-stage": q.stage },
                h("div", { className: "flex items-start justify-between gap-3" },
                    h("div", null,
                        h("p", { className: "text-sm text-ink-900" },
                            q.order,
                            ". ",
                            q.questionText),
                        h("p", { className: "text-xs text-ink-300" }, dict.listening[STAGE_LABEL[q.stage]])),
                    !isOpen && (h(Button, { variant: "secondary", onClick: () => openDrill(q.id), disabled: busy, "data-mcq-open": q.id }, q.stage === "listen" ? dict.listening.mcqStart : dict.listening.mcqResume))),
                isOpen && payload && payload.question.id === q.id && (h("div", { className: "mt-3 rounded-sm border border-ink-100 p-3" },
                    audioUrl && h("audio", { key: q.id, src: `${audioUrl}#t=${q.at ?? 0}`, controls: true, preload: "none", className: "mb-3 max-w-full", "aria-label": `${dict.fullListeningHub.research.listenPart} · ${q.order}` }),
                    !payload.options && (h("p", { className: "mb-2 text-xs text-ink-300", "data-mcq-options-hidden": true }, dict.listening.mcqHiddenNote)),
                    payload.next?.field && payload.next.field !== "chosenAnswer" && (h(fragment, null,
                        h("label", { className: "mb-1 block text-xs font-medium text-ink-500", htmlFor: `mcq-${q.id}` }, dict.listening[FIELD_LABEL[payload.next.field]]),
                        h("textarea", { id: `mcq-${q.id}`, className: "input min-h-[70px] w-full", value: text, onChange: (e) => setText(e.target.value), "data-mcq-input": true }))),
                    payload.options && (h("div", { className: "flex flex-col gap-1.5", "data-mcq-options": true },
                        payload.options.map((option) => (h("label", { key: option, className: "flex items-start gap-2 rounded-sm border border-ink-100 px-3 py-2 text-sm" },
                            h("input", { type: payload.multiple ? "checkbox" : "radio", name: `choice-${q.id}`, "data-mcq-option": option, disabled: payload.session.stage !== "revealed", checked: payload.multiple ? (() => { try {
                                    return JSON.parse((payload.session.stage === "revealed" ? text : payload.session.chosenAnswer) || "[]").includes(option);
                                }
                                catch {
                                    return false;
                                } })() : (payload.session.stage === "revealed" ? text : payload.session.chosenAnswer) === option, onChange: () => {
                                    if (!payload.multiple) {
                                        setText(option);
                                        return;
                                    }
                                    let selected = [];
                                    try {
                                        selected = JSON.parse(text || "[]");
                                    }
                                    catch { /* Fresh selection. */ }
                                    setText(JSON.stringify(selected.includes(option) ? selected.filter(o => o !== option) : [...selected, option]));
                                } }),
                            h("span", { className: "min-w-0 break-words" }, option)))),
                        payload.session.stage === "revealed" && payload.next?.field === "chosenAnswer" && (h("p", { className: "mt-1 text-xs text-ink-300" }, dict.listening.mcqChoose)))),
                    payload.outcome && (h("p", { className: `mt-2 text-sm ${payload.outcome === "correct" ? "text-band-good" : "text-band-bad"}`, "data-mcq-outcome": payload.outcome }, payload.outcome === "correct"
                        ? dict.listening.mcqOutcomeCorrect
                        : dict.listening.mcqOutcomeIncorrect)),
                    payload.explanation && (h("p", { className: "mt-1 text-sm text-ink-500", "data-mcq-explanation": true }, payload.explanation)),
                    h("div", { className: "mt-3 flex flex-wrap items-center gap-2" },
                        payload.next ? (h(Button, { onClick: advance, disabled: busy ||
                                (payload.next.field !== null && text.trim().length < payload.next.minLength), "data-mcq-advance": payload.next.to }, payload.next.to === "revealed"
                            ? dict.listening.mcqReveal
                            : dict.listening.mcqContinue)) : (h("span", { className: "text-sm text-band-good", "data-mcq-done": true }, dict.listening.mcqDone)),
                        !payload.next && dayNavigation && h(Link, { className: "btn-primary", href: dayNavigation.nextHref ?? "/app/listening/mcq", "data-mcq-next": true }, dayNavigation.nextHref ? dict.fullListeningHub.research.next : dict.listening.mcqProgram.backToDays),
                        h("span", { className: "text-xs text-ink-300" }, dict.listening.mcqPracticeOnly)),
                    error && h("p", { className: "mt-2 text-sm text-band-bad" }, error)))));
        }))));
}
