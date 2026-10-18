import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {BackLink} from '../../modules/shared/presentation.js';import {ListeningMap} from './listening-map.js';
export function ListeningAnalysis({ dict, score, total, questions, answers, }) {
    const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));
    return (h("div", { className: "flex flex-col gap-4" },
        h(Card, { className: "flex flex-col items-center gap-1 py-6 text-center" },
            h("span", { className: "text-xs uppercase tracking-wide text-ink-300" }, dict.listening.score),
            h("span", { className: "font-display text-4xl text-ink-900" }, score === null || total === null ? dict.listening.notGradedYet : `${score}/${total}`)),
        questions.map((q) => {
            const a = answerByQuestion.get(q.id);
            /*
             * This used to be a truthiness test on `a?.isCorrect`, in three places at once: the card
             * border, the badge, and the decision to reveal the answer key. Because NULL, false and
             * "no row" are all falsy, a completed-but-ungraded attempt painted EVERY question with the
             * red bad-band border and a red "Incorrect" badge — a grading verdict nobody had reached, and
             * an implied score of zero — while the header directly above correctly said "Not graded yet".
             * The same screen contradicted itself.
             *
             * The verdict is now derived once, from the row, and every visual decision follows from it.
             */
            const verdict = a === undefined ? "unanswered"
                : a.isCorrect === null ? "notGraded"
                    : a.isCorrect ? "correct"
                        : "incorrect";
            /*
             * Neutral tokens for the two states that are not failures. `band-bad` would assert a wrong
             * answer and `band-warn` would assert a warning; neither was issued.
             *
             * The first attempt here used `bg-ink-50`, which does not exist: the theme's ink palette is
             * 950/900/700/500/300/100, so Tailwind generated no rule at all and the badge rendered with
             * NO background — the label sitting bare on the card while its correct/incorrect neighbours
             * kept their pill. Measured in the browser, the badge's computed background was
             * rgba(0,0,0,0). A class name that looks like a token is not a token.
             *
             * `bg-ink-100 text-ink-700` is generated, and its contrast was computed from the theme's own
             * values in both palettes rather than assumed: 9.36:1 in Day Mode and 10.03:1 in Night Mode,
             * against the 4.5:1 WCAG AA threshold for text this size.
             */
            const tone = verdict === "correct" ? { card: "border-band-good/40", badge: "bg-band-good/10 text-band-good" }
                : verdict === "incorrect" ? { card: "border-band-bad/40", badge: "bg-band-bad/10 text-band-bad" }
                    : { card: "border-ink-100", badge: "bg-ink-100 text-ink-700" };
            const label = verdict === "correct" ? dict.listening.correct
                : verdict === "incorrect" ? dict.listening.incorrect
                    : verdict === "notGraded" ? dict.listening.notGraded
                        : dict.listening.unanswered;
            return (h(Card, { key: q.id, className: tone.card, "data-listening-verdict": verdict },
                h("div", { className: "mb-2 flex items-center justify-between" },
                    h("p", { className: "text-sm font-medium text-ink-900" },
                        q.order,
                        ". ",
                        q.questionText),
                    h("span", { className: `badge ${tone.badge}`, "data-listening-verdict-label": verdict }, label)),
                h("p", { className: "text-sm text-ink-500" },
                    dict.listening.yourAnswer,
                    ": ",
                    h("span", { className: "text-ink-900" }, a?.userAnswer || "—")),
                verdict !== "correct" && (h("p", { className: "text-sm text-ink-500", "data-listening-answer-key": true },
                    dict.listening.correctAnswer,
                    ": ",
                    h("span", { className: "text-ink-900" }, q.correctAnswer))),
                q.explanation.trim() ? (h("p", { className: "mt-1 text-xs text-ink-500", "data-listening-analysis-evidence": true }, q.explanation)) : null));
        })));
}
