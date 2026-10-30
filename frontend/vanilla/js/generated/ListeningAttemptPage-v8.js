import {h,fragment,Link} from '../native.js';import {ListeningMap} from './listening-map.js';import {occurrenceSpans} from './listening-occurrence-spans.js';
import {Card,EmptyState} from './ui.js';import {Button} from '../../modules/shared/presentation.js';import {Input} from '../../modules/shared/inputs.js';
export function render(scope) {
    const { dict, attempt, test, questions, answers, section, ListeningExam, ListeningAnalysis, ClickableText, OwnerMaterialBlocks } = scope;
    return (h("div", { className: "mx-auto max-w-3xl" },
        section ? (
        /* A finished section shows its OWN result: the learner's answers and the correct
           answers for this section. It is never presented as an Academic test result. */
        h(ListeningAnalysis, { dict: dict, score: attempt.score, total: attempt.totalQuestions, questions: questions, answers: answers })) : attempt.status === "in_progress" ? (h(ListeningExam, { dict: dict, attemptId: attempt.id, testTitle: test.title, audioUrl: test.audioUrl, audioType: test.audioType, questions: questions.map((q) => ({
                id: q.id,
                order: q.order,
                type: q.type,
                questionText: q.questionText,
                options: q.options ?? null,
            })) })) : (h(fragment, null,
            h("div", { className: "mb-3 flex justify-end" },
                h(Link, { href: `/app/listening/attempts/${attempt.id}/revision`, className: "btn-secondary ", "data-revision-link": true },
                    dict.listening.revisionStudio,
                    " \u2192")),
            h(ListeningAnalysis, { dict: dict, score: attempt.score, total: attempt.totalQuestions, questions: questions, answers: answers }),
            test.transcript && (h("div", { className: "card mt-4", "data-interactive-transcript": true },
                h("h3", { className: "mb-2 font-display text-base text-ink-900" }, dict.listening.transcript),
                h("p", { className: "mb-2 text-xs text-ink-300" }, dict.listening.transcriptHint),
                h(ClickableText, { dict: dict, text: test.transcript, sourceType: "listening", sourceId: test.id, className: "academic-text text-sm leading-relaxed text-ink-700" }))))),
        h("div", { className: "mt-4" },
            h(OwnerMaterialBlocks, { ownerType: "listening", ownerId: test.id, ownerVisible: true }))));
}
