import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {BackLink} from '../../modules/shared/presentation.js';import {ListeningMap} from './listening-map.js';
export function render(scope) {
    const { id, title, kind, questions, audioUrl, dict, mapDiagram, index, answers, prediction, result, busy, error, player, clipEnd, setIndex, setPrediction, setAnswers, check, setError, ClickableText } = scope;
    const t = dict.fullListeningHub.research, a = dict.fullListeningHub.activity, q = questions[index], feedback = result.find(row => row.number === q?.number);
    return h("div", { className: "listening-workspace mx-auto max-w-5xl space-y-5" },
        h(Link, { className: "btn-secondary inline-flex", href: `/app/listening/tests/${id}` }, dict.fullListeningHub.examStart.back),
        h("h1", { className: "font-display text-3xl" },
            title,
            " \u00B7 ",
            t[kind]),
        audioUrl && h("audio", { controls: true, ref: player, src: audioUrl, preload: "metadata", className: "w-full", onTimeUpdate: () => { if (clipEnd.current !== null && player.current && player.current.currentTime >= clipEnd.current) {
                player.current.pause();
                clipEnd.current = null;
            } } }),
        kind === "map" && mapDiagram && h("div", { className: "card p-5", "data-listening-map-practice": true },
            h(ListeningMap, { diagram: mapDiagram })),
        !q ? h("p", { className: "card p-5" }, t.weakEmpty) : h("section", { className: "card space-y-4 p-5" },
            h("p", { className: "text-sm" },
                index + 1,
                " / ",
                questions.length,
                " \u00B7 Q",
                q.number),
            h("h2", { className: "text-xl" },
                h(ClickableText, { dict: dict, text: q.text, sourceType: "listening", sourceId: id, lexicalAssistance: true, catalogueLookup: true })),
            h("p", null, q.instruction),
            kind === "completion" && h("label", { className: "block" },
                t.prediction,
                h("input", { className: "input mt-2", value: prediction, onChange: e => setPrediction(e.target.value), maxLength: 300 })),
            h("button", { className: "btn-secondary", type: "button", onClick: () => { if (player.current) {
                    player.current.currentTime = q.at;
                    clipEnd.current = q.end ?? q.at + 25;
                    void player.current.play().catch(() => setError(a.momentUnavailable));
                } } }, a.playEvidence),
            h("label", { className: "block" },
                kind === "map" ? t.yourLocation : a.yourMatches,
                q.options.length ? h("select", { className: "input mt-2", value: answers[q.number] ?? "", onChange: e => setAnswers(old => ({ ...old, [q.number]: e.target.value })) },
                    h("option", { value: "" }, a.choose),
                    q.options.map((option, i) => h("option", { key: i, value: /^([A-Z])[).\s]/.exec(option)?.[1] ?? option }, option))) : h("input", { className: "input mt-2", maxLength: 500, value: answers[q.number] ?? "", onChange: e => setAnswers(old => ({ ...old, [q.number]: e.target.value })) })),
            h("button", { className: "btn-primary", type: "button", disabled: busy || !answers[q.number]?.trim(), onClick: () => void check() }, a.checkAll),
            feedback && h("div", { role: "status", className: "rounded-xl border border-ink-100 p-4" },
                h("strong", null,
                    feedback.correct ? a.correct : a.incorrect,
                    " \u00B7 ",
                    feedback.key),
                h("p", { className: "whitespace-pre-line" }, feedback.evidence)),
            h("div", { className: "flex flex-wrap justify-between gap-2" },
                h("button", { className: "btn-secondary", type: "button", disabled: !index || busy, onClick: () => { setIndex(i => i - 1); setPrediction(""); } }, t.previous),
                h("button", { className: "btn-secondary", type: "button", disabled: index === questions.length - 1 || busy, onClick: () => { setIndex(i => i + 1); setPrediction(""); } }, t.next)),
            h("button", { className: "btn-primary", type: "button", disabled: busy || questions.some(row => !answers[row.number]?.trim()), onClick: () => void check(true) }, t.finish)),
        error && h("p", { role: "alert" }, error));
}
