import {h,fragment,Link} from '../native.js';import {ListeningMap} from './listening-map.js';import {occurrenceSpans} from './listening-occurrence-spans.js';
export function render(scope) {
    const { id, audioUrl, questions, allowed, dict, audio, rate, answers, result, busy, setResult, setRate, setAnswers, check } = scope;
    const HISTORICAL_MAP_PART = 2, Image = ({ unoptimized, ...p }) => h('img', p), mapDiagramSections = d => [...new Set((d.questions ?? []).filter(q => q.kind === 'map').map(q => q.section))].sort((a, b) => a - b).length ? [...new Set((d.questions ?? []).filter(q => q.kind === 'map').map(q => q.section))].sort((a, b) => a - b) : [2];
    return (h("details", { className: "card space-y-3" },
        h("summary", null, dict.fullListeningHub.speed.summary),
        h("p", null, dict.fullListeningHub.speed.ladder),
        h("audio", { ref: audio, src: audioUrl ?? undefined, controls: true, preload: "none", onError: () => setResult(dict.fullListeningHub.speed.audioUnavailable) }),
        h("label", null,
            dict.fullListeningHub.speed.speed,
            h("select", { className: "input", value: rate, onChange: (e) => {
                    const next = Number(e.target.value);
                    setRate(next);
                    if (audio.current)
                        audio.current.playbackRate = next;
                } }, [1, 1.25, 1.5, 1.75, 2].map((r) => (h("option", { value: r, key: r, disabled: !allowed.includes(r) },
                r,
                "\u00D7",
                allowed.includes(r) ? "" : ` · ${dict.fullListeningHub.speed.locked}`))))),
        questions.map((q) => (h("label", { key: q.number, className: "block" },
            "Q",
            q.number,
            ". ",
            q.text,
            h("input", { className: "input", maxLength: 500, value: answers[q.number] ?? "", onChange: (e) => setAnswers((old) => ({ ...old, [q.number]: e.target.value })) })))),
        h("button", { type: "button", className: "btn-primary", disabled: busy, onClick: () => void check() }, dict.fullListeningHub.speed.check),
        result && h("p", { role: "status" }, result)));
}
