import {h,fragment,Link} from '../native.js';import {ListeningMap} from './listening-map.js';import {occurrenceSpans} from './listening-occurrence-spans.js';
export function render(scope) {
    const { id, userId, title, audioUrl, imageUrl, mapDiagram, mapSections, questions, sections, occurrences, segmentOccurrences, lexicalAssistance, dict, section, answers, result, error, busy, audio, answer, check, setSection, setError, ClickableText } = scope;
    const HISTORICAL_MAP_PART = 2, Image = ({ unoptimized, ...p }) => h('img', p), mapDiagramSections = d => [...new Set((d.questions ?? []).filter(q => q.kind === 'map').map(q => q.section))].sort((a, b) => a - b).length ? [...new Set((d.questions ?? []).filter(q => q.kind === 'map').map(q => q.section))].sort((a, b) => a - b) : [2];
    const textProps = { dict, sourceType: "listening", sourceId: id, catalogueLookup: true, lexicalAssistance };
    return (h("main", { className: "listening-workspace mx-auto max-w-[1600px] space-y-6", "data-listening-study": true },
        h(Link, { "data-back-link": true, className: "btn-secondary", href: `/app/listening/tests/${id}` }, "\u2190 Test hub"),
        h("header", { className: "card space-y-3" },
            h("h1", { className: "font-display text-3xl font-bold" },
                "\uD83C\uDFA7 ",
                title),
            h("p", null, dict.fullListeningHub.study.intro),
            h("audio", { ref: audio, src: audioUrl, controls: true, preload: "none", className: "w-full", onError: () => setError(dict.fullListeningHub.study.audioUnavailable) }),
            h("label", null,
                "Speed",
                " ",
                h("select", { className: "input w-auto", value: audio.current?.playbackRate ?? 1, onChange: (e) => {
                        if (audio.current)
                            audio.current.playbackRate = Number(e.target.value);
                    } }, [0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (h("option", { key: rate, value: rate },
                    rate,
                    "\u00D7")))))),
        h("nav", { className: "flex flex-wrap gap-2", "aria-label": dict.formCopy.sections }, sections.map(({ number: n }) => (h("button", { type: "button", key: n, className: n === section ? "btn-primary" : "btn-secondary", onClick: () => setSection(n) },
            "\uD83C\uDFA7 Section ",
            n)))),
        h("div", { className: "listening-review-grid" },
            h("section", { className: "card academic-text space-y-6" },
                (mapSections ?? [HISTORICAL_MAP_PART]).includes(section) && mapDiagram && h(ListeningMap, { diagram: mapDiagram }),
                (mapSections ?? [HISTORICAL_MAP_PART]).includes(section) && imageUrl && (h(Image, { src: imageUrl, alt: dict.formCopy.listeningMap, width: 560, height: 400, unoptimized: true, className: "h-auto w-full" })),
                questions
                    .filter((q) => q.section === section)
                    .map((q) => (h("article", { key: q.number, className: "space-y-2" },
                    h("p", { className: "text-sm font-semibold" }, q.instruction),
                    h("h2", { className: "font-bold" },
                        "Q",
                        q.number),
                    h(ClickableText, { ...textProps, occurrences: segmentOccurrences[`q${q.number}:text`] ?? [], text: q.text }),
                    q.options.length ? (h(fragment, null,
                        h("div", { className: "space-y-1" }, q.options.map((o, optionIndex) => (h(ClickableText, { key: o, ...textProps, occurrences: segmentOccurrences[`q${q.number}:option:${optionIndex}`] ?? [], text: o })))),
                        h("label", null,
                            "Q",
                            q.number,
                            " answer",
                            h("select", { className: "input", value: answers[q.number] ?? "", onChange: (e) => answer(String(q.number), e.target.value) },
                                h("option", { value: "" }, dict.formCopy.choose),
                                q.options.map((o, i) => (h("option", { key: o, value: /^[A-Z](?:\s|$)/.test(o)
                                        ? o[0]
                                        : String.fromCharCode(65 + i) }, o))))))) : (h("label", null,
                        "Q",
                        q.number,
                        " answer",
                        h("input", { className: "input", maxLength: 500, value: answers[q.number] ?? "", onChange: (e) => answer(String(q.number), e.target.value) }))),
                    result?.results.find((r) => r.number === q.number) && (h("p", null,
                        result.results.find((r) => r.number === q.number).correct
                            ? "✓ Correct"
                            : "✕ Incorrect",
                        " ",
                        "\u00B7 ",
                        result.results.find((r) => r.number === q.number).key)))))),
            sections.find(s => s.number === section)?.transcript && h("aside", { className: "card academic-text space-y-4" },
                h("h2", { className: "font-display text-xl font-bold" }, "\uD83D\uDCD6 Transcript"),
                h(ClickableText, { ...textProps, occurrences: sections.find((s) => s.number === section)?.transcript ? occurrences[section] ?? [] : [], text: sections.find((s) => s.number === section)?.transcript ||
                        "" }))),
        error && h("p", { role: "alert" }, error),
        result && (h("p", { role: "status" },
            "Practice score: ",
            result.score,
            "/",
            result.total)),
        h("button", { type: "button", className: "btn-primary", disabled: busy || !Object.values(answers).some((v) => v.trim()), onClick: () => void check() }, busy ? "Checking…" : "✓ Check practice answers")));
}
