import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {ListeningAnalysis} from './listening-analysis.js';import {BackLink} from '../../modules/shared/presentation.js';
export function render(scope) {
    const { dict, view, SectionListeningActivity, SectionRetakeButton } = scope;
    const t = dict.listening.general;
    return (h("div", { className: "mx-auto flex max-w-3xl flex-col gap-4", "data-listening-section-page": view.testId, "data-listening-section-mode": view.kind },
        h(BackLink, { fallbackHref: "/app/listening/general", label: t.title, "data-listening-section-back": true }),
        view.kind === "exercise" ? (
        /* The ONE activity: audio, questions, navigation, notes, highlight, vocabulary, submit. */
        h(SectionListeningActivity, { dict: dict, attemptId: view.attemptId, testId: view.testId, title: view.title, lexicalAssistance: view.lexicalAssistance, audioUrl: view.audioUrl, mapDiagram: view.mapDiagram, imageUrl: view.imageUrl, duration: view.duration, initial: view.initial, audioPosition: view.audioPosition, audioStartedAt: view.audioStartedAt, questions: view.questions })) : (h("div", { className: "flex flex-col gap-4", "data-listening-section-result": true },
            h("h1", { className: "font-display text-2xl text-ink-900" }, view.title),
            h(ListeningAnalysis, { dict: dict, score: view.score, total: view.total, questions: view.questions, answers: view.answers }),
            h("div", { className: "flex flex-wrap items-center gap-3" },
                h(SectionRetakeButton, { sectionId: view.testId, label: t.retake, messages: dict.auth }),
                h(Link, { className: "btn-secondary", href: "/app/listening/general" }, t.backToCatalogue))))));
}
