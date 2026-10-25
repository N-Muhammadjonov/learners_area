import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {BackLink,Button} from '../../modules/shared/presentation.js';import {Input,Textarea} from '../../modules/shared/inputs.js';
export function render(scope) {
    const { dict, blockId, prompt, options, value, verdict, busy, error, setValue, submit } = scope;
    const t = dict.listening.lessons;
    return (h("div", { className: "rounded-xl border border-ink-100 p-4", "data-lesson-quiz-block": blockId },
        h("p", { className: "text-sm font-medium text-ink-900" }, prompt),
        options ? (h("div", { className: "mt-3 flex flex-col gap-2" }, options.map((option) => (h("label", { key: option, className: "flex items-center gap-2 text-sm text-ink-700" },
            h("input", { type: "radio", name: `lesson-quiz-${blockId}`, value: option, checked: value === option, onChange: () => setValue(option), disabled: busy }),
            option))))) : (h(Input, { className: "mt-3", value: value, onChange: (event) => setValue(event.target.value), disabled: busy })),
        h("div", { className: "mt-3 flex items-center gap-3" },
            h(Button, { variant: "secondary", disabled: busy || !value.trim(), onClick: () => void submit(value), "data-lesson-quiz-submit": true }, busy ? dict.common.saving : t.checkAnswer),
            verdict && (h("span", { className: verdict.correct ? "text-sm text-band-good" : "text-sm text-band-bad", "data-lesson-quiz-verdict": verdict.correct ? "correct" : "incorrect" },
                verdict.correct ? t.answerCorrect : t.answerIncorrect,
                verdict.correctAnswer ? ` ${verdict.correctAnswer}` : ""))),
        error && h("p", { className: "mt-2 text-sm text-band-bad" }, error)));
}
