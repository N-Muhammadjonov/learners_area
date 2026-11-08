import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {BackLink} from '../../modules/shared/presentation.js';import {ListeningMap} from './listening-map.js';
export function render(scope) {
    const { dict, attemptId, testId, title, audioUrl, imageUrl, mapDiagram, mapSections, questions, initial, audioPosition, audioStartedAt, duration, sectionMode, answers, section, mediaDuration, started, position, error, saved, busy, notesOpen, notes, confirm, audio, container, change, play, submit, setNotesOpen, updateNotes, setSection, setConfirm, setError, setMediaDuration, setPosition, pos, ReadingText } = scope;
    const HISTORICAL_MAP_PART = 2, answered = questions.filter(q => answers[q.id]?.trim()).length;
    const Image = ({ unoptimized, ...props }) => h("img", props);
    return (h("div", { ref: container, className: "listening-workspace mx-auto max-w-5xl space-y-5 bg-paper p-4 overflow-auto", "data-listening-attempt-mode": sectionMode ? "section" : "full_exam" },
        h("header", { className: "card flex flex-wrap items-center gap-4" },
            h("h1", { className: "font-display text-2xl" }, sectionMode ? title : `${title} · Full Exam`),
            h("span", { "data-listening-answered-count": "" },
                answered,
                " / ",
                questions.length,
                " answered"),
            h("span", { "data-listening-position": "" },
                Math.floor(position / 60),
                ":",
                String(Math.floor(position % 60)).padStart(2, "0"),
                mediaDuration > 0 && (h(fragment, null,
                    " / ",
                    Math.floor(mediaDuration / 60),
                    ":",
                    String(Math.floor(mediaDuration % 60)).padStart(2, "0")))),
            h("button", { type: "button", className: "btn-secondary", "aria-expanded": notesOpen, "aria-controls": "listening-exam-notes", onClick: () => setNotesOpen(open => !open) }, dict.fullListeningHub.examScreen.noteTaking),
            h("label", null,
                dict.fullListeningHub.examScreen.volume,
                h("input", { "aria-label": dict.fullListeningHub.examScreen.volume, type: "range", min: 0, max: 1, step: 0.05, value: audio.current?.volume ?? 1, onChange: (e) => {
                        if (audio.current)
                            audio.current.volume = Number(e.target.value);
                    } })),
            h("button", { type: "button", className: "btn-secondary", onClick: async () => {
                    try {
                        if (document.fullscreenElement)
                            await document.exitFullscreen();
                        else if (container.current?.requestFullscreen)
                            await container.current.requestFullscreen();
                        else
                            setError(dict.fullListeningHub.examScreen.fullscreenUnavailable);
                    }
                    catch {
                        setError(dict.fullListeningHub.examScreen.fullscreenFailed);
                    }
                } }, dict.fullListeningHub.examScreen.fullscreen)),
        notesOpen && h("aside", { id: "listening-exam-notes", className: "card space-y-2 p-4" },
            h("label", { className: "block", htmlFor: "listening-notes-text" }, dict.fullListeningHub.examScreen.noteTaking),
            h("textarea", { id: "listening-notes-text", className: "input min-h-40", maxLength: 12000, value: notes, onChange: e => updateNotes(e.target.value) }),
            h("p", { className: "text-xs text-ink-500" }, dict.fullListeningHub.examScreen.notesLocal)),
        h("audio", { ref: audio, src: audioUrl, preload: sectionMode ? "none" : "auto", onLoadedMetadata: () => {
                if (audio.current) {
                    audio.current.currentTime = audioPosition;
                    if (duration === undefined && Number.isFinite(audio.current.duration))
                        setMediaDuration(audio.current.duration);
                }
            }, onRateChange: () => {
                if (audio.current)
                    audio.current.playbackRate = 1;
            }, onTimeUpdate: () => {
                pos.current = audio.current?.currentTime ?? 0;
                setPosition(pos.current);
            }, onEnded: () => {
                setConfirm(true);
            }, onError: () => setError(dict.fullListeningHub.examScreen.recordingUnavailable) }),
        h("button", { type: "button", className: "btn-primary", "data-listening-start-audio": "", onClick: () => void play(), disabled: busy || (mediaDuration > 0 && position >= mediaDuration - 0.5) }, started
            ? dict.fullListeningHub.examScreen.resume
            : dict.fullListeningHub.examScreen.begin),
        h("p", { role: "status", "data-listening-save-status": "" }, saved),
        error && h("p", { role: "alert", "data-listening-error": "" }, error),
        !sectionMode && (h("nav", { className: "flex flex-wrap gap-2", "aria-label": dict.fullListeningHub.examScreen.sections, "data-listening-exam-sections": true }, [1, 2, 3, 4].map((s) => (h("button", { type: "button", className: section === s ? "btn-primary" : "btn-secondary", key: s, "aria-pressed": section === s, onClick: () => setSection(s) }, dict.fullListeningHub.examScreen.section.replace("{n}", String(s))))))),
        (mapSections ?? [HISTORICAL_MAP_PART]).includes(section) && mapDiagram && h(ListeningMap, { diagram: mapDiagram }),
        (mapSections ?? [HISTORICAL_MAP_PART]).includes(section) && imageUrl && (h("div", { className: "card" },
            h(Image, { width: 560, height: 400, unoptimized: true, src: imageUrl, alt: dict.fullListeningHub.examScreen.mapAlt.replace("{n}", "2"), className: "mx-auto max-h-96 max-w-full" }))),
        questions
            .filter((q) => sectionMode || q.section === section)
            .map((q) => {
            /*
             * The control comes from the SHARED model whenever the caller resolved a canonical type
             * code for this question (`listeningInputModeFor`). Without one — the package path —
             * the historical options-based mapping stands, so no accepted exam screen changes.
             */
            const mode = q.input ?? (q.options.some((option) => option.trim()) ? "select" : "text");
            return (h("div", { id: `question-${q.number}`, key: q.id, className: "card space-y-3" },
                q.instruction && h(ReadingText, { text: q.instruction, textKey: `${q.id}:instruction`, className: "text-sm" }),
                h("label", { className: "block font-medium", htmlFor: `answer-${q.id}` },
                    "Q",
                    q.number,
                    ". ",
                    h(ReadingText, { text: q.text, textKey: `${q.id}:text` })),
                mode === "select" ? (h("select", { className: "input", id: `answer-${q.id}`, "data-listening-answer-control": "select", value: answers[q.id] ?? "", onChange: (e) => change(q.id, e.target.value) },
                    h("option", { value: "" }, dict.fullListeningHub.examScreen.chooseAnswer),
                    q.options.map((o, i) => {
                        const letter = /^[A-Z](?:\s|$)/.test(o)
                            ? o[0]
                            : String.fromCharCode(65 + i);
                        return (h("option", { key: o, value: letter }, o));
                    }))) : mode === "multi" ? (
                /* Choose-two/three: every choice is its own control, and the answer is the set the
                   learner picked — graded by the registry's `multi_all`, never by "first letter". */
                h("fieldset", { className: "flex flex-col gap-1", "data-listening-answer-control": "multi", id: `answer-${q.id}` }, q.options.map((o, i) => {
                    const letter = /^[A-Z](?:\s|$)/.test(o) ? o[0] : String.fromCharCode(65 + i);
                    const chosen = (answers[q.id] ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
                    return (h("label", { key: o, className: "flex items-center gap-2 text-sm text-ink-700" },
                        h("input", { type: "checkbox", checked: chosen.includes(letter), onChange: () => change(q.id, chosen.includes(letter) ? chosen.filter((entry) => entry !== letter).join(",") : [...chosen, letter].join(",")) }),
                        o));
                }))) : (h("input", { id: `answer-${q.id}`, className: "input", "data-listening-answer-control": "text", maxLength: 500, value: answers[q.id] ?? "", autoComplete: "off", onChange: (e) => change(q.id, e.target.value) }))));
        }),
        h("nav", { className: "listening-question-nav", "aria-label": dict.fullListeningHub.examScreen.questionNav }, questions.map((q) => (h("button", { type: "button", className: answers[q.id]?.trim() ? "btn-primary" : "btn-secondary", "data-listening-question-index": q.id, key: q.id, onClick: () => {
                setSection(q.section);
                setTimeout(() => document
                    .getElementById(`question-${q.number}`)
                    ?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
            }, "aria-label": `Question ${q.number}, ${answers[q.id]?.trim() ? "answered" : "unanswered"}` }, q.number)))),
        h("button", { type: "button", className: "btn-primary", disabled: busy, onClick: () => setConfirm(true) }, dict.fullListeningHub.examScreen.submit),
        confirm && (h("div", { className: "card space-y-3", role: "dialog", "aria-label": dict.fullListeningHub.examScreen.confirmLabel },
            h("p", null, dict.fullListeningHub.examScreen.confirmText
                .replace("{answered}", String(answered))
                .replace("{unanswered}", String(questions.length - answered))),
            h("button", { type: "button", className: "btn-primary", disabled: busy, onClick: () => void submit() }, dict.fullListeningHub.examScreen.confirm),
            h("button", { type: "button", className: "btn-secondary", disabled: busy, onClick: () => setConfirm(false) }, dict.fullListeningHub.examScreen.keepWorking)))));
}
