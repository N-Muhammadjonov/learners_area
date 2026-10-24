import {h,fragment,Link} from '../native.js';import {ListeningMap} from './listening-map.js';import {occurrenceSpans} from './listening-occurrence-spans.js';
import {Card,EmptyState} from './ui.js';import {Button} from '../../modules/shared/presentation.js';import {Input} from '../../modules/shared/inputs.js';
export function render(scope) {
    const { dict, attemptId, testTitle, audioUrl, audioType, questions, answers, submitting, error, setAnswer, onSubmit, MaterialPlayer } = scope;
    return (h("div", { className: "flex flex-col gap-4" },
        h("div", { className: "card" },
            h("h2", { className: "mb-3 font-display text-lg text-ink-900" }, testTitle),
            h(MaterialPlayer, { url: audioUrl, type: audioType, openLabel: "Open audio", emptyLabel: dict.listening.noAudioYet })),
        h("div", { className: "flex flex-col gap-4" },
            questions.map((q) => (h("div", { key: q.id, className: "card" },
                h("p", { className: "mb-2 text-xs font-medium uppercase tracking-wide text-ink-300" },
                    q.order,
                    ". ",
                    q.type.replace(/_/g, " ")),
                h("p", { className: "mb-3 text-sm text-ink-900" }, q.questionText),
                q.type === "multiple_choice" && q.options && (h("div", { className: "flex flex-col gap-1.5" }, q.options.map((opt) => (h("label", { key: opt, className: "flex items-center gap-2 text-sm text-ink-700" },
                    h("input", { type: "radio", name: q.id, checked: answers[q.id] === opt, onChange: () => setAnswer(q.id, opt) }),
                    opt))))),
                q.type === "short_answer" && (h(Input, { placeholder: dict.listening.yourAnswer, value: answers[q.id] ?? "", onChange: (e) => setAnswer(q.id, e.target.value) }))))),
            error && h("p", { role: "alert", className: "text-sm text-band-bad" }, error),
            h(Button, { onClick: onSubmit, disabled: submitting }, submitting ? dict.common.loading : dict.listening.submit))));
}
