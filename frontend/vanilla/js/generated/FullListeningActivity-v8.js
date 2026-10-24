import {h,fragment,Link} from '../native.js';import {ListeningMap} from './listening-map.js';import {occurrenceSpans} from './listening-occurrence-spans.js';
export function render(scope) {
    const { id, userId, title, activity, data, audioUrl, imageUrl, dict, occurrences, segmentOccurrences, lexicalAssistance, mapSections, answers, error, result, busy, vocabSelection, vocabFolders, vocabFolderId, foldersLoading, vocabSaving, quiz, revealed, selected, reviewPart, audio, end, studyText, ClickableText, ListeningSpeedPractice, McqMastery, answer, save, clip, chooseVocabularyFolder, vocabulary, setError, setReviewPart, setSelected, setRevealed, setQuiz, setVocabFolderId, setVocabSelection, setAnswers, setResult } = scope;
    const HISTORICAL_MAP_PART = 2, Image = ({ unoptimized, ...p }) => h('img', p), mapDiagramSections = d => [...new Set((d.questions ?? []).filter(q => q.kind === 'map').map(q => q.section))].sort((a, b) => a - b).length ? [...new Set((d.questions ?? []).filter(q => q.kind === 'map').map(q => q.section))].sort((a, b) => a - b) : [2];
    const showReviewMap = !data.studyPack || (mapSections ?? mapDiagramSections(data)).includes(reviewPart);
    const q = data.questions?.find((x) => x.number === selected);
    const scriptPart = data.studyPack?.scriptParts?.find(part => part.part === reviewPart);
    const scriptChunks = [];
    if (scriptPart) {
        let cursor = 0;
        for (const gap of scriptPart.gaps) {
            const at = scriptPart.transcript.indexOf(gap.match, cursor);
            if (at < 0)
                continue;
            scriptChunks.push({ text: scriptPart.transcript.slice(cursor, at), gap });
            cursor = at + gap.match.length;
        }
        scriptChunks.push({ text: scriptPart.transcript.slice(cursor) });
    }
    return (h("div", { className: "listening-workspace mx-auto max-w-[1600px] space-y-6" },
        h(Link, { className: "btn-secondary", href: `/app/listening/tests/${id}` }, "\u2190 Test hub"),
        h("h1", { className: "font-display text-3xl" },
            title,
            " \u00B7 ",
            data.studyPack ? activity === 3 ? dict.fullListeningHub.research.script : activity === 4 ? dict.fullListeningHub.research.recall : dict.fullListeningHub.activities[activity - 1] : dict.fullListeningHub.activities[activity - 1]),
        activity === 2 &&
            data.mapDiagram &&
            showReviewMap && (h(ListeningMap, { diagram: data.mapDiagram })),
        activity !== 5 && audioUrl && (h("audio", { ref: audio, src: audioUrl, preload: "none", controls: true, className: "w-full", onTimeUpdate: () => {
                if (end.current !== null &&
                    audio.current &&
                    audio.current.currentTime >= end.current) {
                    audio.current.pause();
                    end.current = null;
                }
            }, onError: () => setError(dict.fullListeningHub.activity.recordingUnavailable) })),
        activity === 2 && (h(fragment, null,
            data.report && (h("p", { className: "card" },
                "Full Exam: ",
                data.report.score,
                " / ",
                data.report.total)),
            data.studyPack && h("nav", { className: "flex flex-wrap gap-2", "aria-label": dict.fullListeningHub.research.review }, data.sections?.map(part => h("button", { type: "button", key: part.number, className: reviewPart === part.number ? "btn-primary" : "btn-secondary", onClick: () => { setReviewPart(part.number); setSelected(data.questions?.find(question => question.section === part.number)?.number ?? 1); } },
                "PART ",
                part.number))),
            data.studyPack && h("button", { type: "button", className: "btn-secondary", onClick: () => { const range = data.studyPack?.partRanges[String(reviewPart)]; if (range)
                    void clip(range[0], range[1]); } },
                "\u25B6 ",
                dict.fullListeningHub.research.listenPart),
            h("nav", { className: "flex flex-wrap gap-2" }, data.questions?.filter(question => !data.studyPack || question.section === reviewPart).map((x) => (h("button", { type: "button", key: x.number, className: selected === x.number ? "btn-primary" : "btn-secondary", onClick: () => {
                    setSelected(x.number);
                    answer(String(x.number), "reviewed");
                } },
                "Q",
                x.number,
                answers[x.number] ? " ✓" : "")))),
            imageUrl && showReviewMap && h(Image, { src: imageUrl, alt: dict.importPreview.image, width: 1000, height: 600, unoptimized: true, className: "h-auto max-h-96 w-auto max-w-full" }),
            h("div", { className: "listening-review-grid" },
                h("section", { className: "card space-y-4" }, q && (h(fragment, null,
                    h("h2", null,
                        "Q",
                        q.number,
                        ". ",
                        studyText(q.text, `q${q.number}:text`, true)),
                    h("p", null,
                        "Answer: ",
                        q.key,
                        q.alternatives.length
                            ? ` · Also accepted: ${q.alternatives.join(" / ")}`
                            : ""),
                    h("p", null,
                        "Your answer:",
                        " ",
                        data.report?.answers.find((a) => a.number === q.number)
                            ?.userAnswer || "—"),
                    h("div", null, studyText(q.evidence.why, `q${q.number}:why`)),
                    h("button", { type: "button", className: "btn-primary", onClick: () => void clip(Math.max(0, q.evidence.at - 4), q.evidence.at + 22) }, dict.fullListeningHub.activity.playEvidence),
                    h("button", { type: "button", className: "btn-secondary", onClick: () => answer(String(q.number), "reviewed") }, dict.fullListeningHub.activity.markReviewed)))),
                h("aside", { className: "card space-y-5" },
                    h("h2", null, dict.fullListeningHub.activity.transcript),
                    data.sections?.map((s) => (h("section", { key: s.number },
                        h("h3", null,
                            "Section ",
                            s.number,
                            " \u00B7 ",
                            s.title),
                        s.transcript ? (h(ClickableText, { dict: dict, sourceType: "listening", sourceId: id, text: s.transcript, occurrences: occurrences[s.number] ?? [], lexicalAssistance: lexicalAssistance, catalogueLookup: true })) : (h("p", { role: "status" }, dict.fullListeningHub.transcriptMissing))))))))),
        activity === 2 && data.questions && (h(ListeningSpeedPractice, { dict: dict, id: id, audioUrl: audioUrl, questions: data.questions, allowed: data.speeds ?? [1] })),
        activity === 2 && data.mcq && (h(McqMastery, { dict: dict, questions: data.mcq })),
        activity === 4 && data.studyPack && h("div", { className: "space-y-4" }, data.studyPack.recall.map(part => h("article", { key: part.part, className: "card space-y-3 p-5" },
            h("h2", { className: "font-display text-xl" },
                "PART ",
                part.part,
                " \u00B7 ",
                part.title),
            h("button", { type: "button", className: "btn-secondary", onClick: () => { const range = data.studyPack.partRanges[String(part.part)]; if (range)
                    void clip(range[0], range[1]); } },
                "\u25B6 ",
                dict.fullListeningHub.research.listenPart),
            h("label", { className: "block" },
                dict.fullListeningHub.research.recallPrompt,
                h("textarea", { className: "input mt-2 min-h-32", maxLength: 4000, value: answers[part.part] ?? "", onChange: event => answer(String(part.part), event.target.value) })),
            h("button", { type: "button", className: "btn-secondary", onClick: () => setRevealed(old => ({ ...old, [part.part]: !old[part.part] })), "aria-expanded": Boolean(revealed[part.part]) }, dict.fullListeningHub.research.focusPoints),
            revealed[part.part] && h("ul", { className: "list-disc pl-5" }, part.points.map(point => h("li", { key: point }, point)))))),
        activity === 3 && scriptPart && h("section", { className: "space-y-4" },
            h("nav", { className: "flex flex-wrap gap-2", "aria-label": dict.fullListeningHub.research.script }, data.studyPack.scriptParts.map(part => h("button", { key: part.part, type: "button", className: reviewPart === part.part ? "btn-primary" : "btn-secondary", onClick: () => setReviewPart(part.part) },
                "PART ",
                part.part))),
            h("button", { type: "button", className: "btn-secondary", onClick: () => { const range = data.studyPack.partRanges[String(reviewPart)]; if (range)
                    void clip(range[0], range[1]); } }, dict.fullListeningHub.research.listenPart),
            h("div", { className: "card p-5 leading-9 whitespace-pre-line" }, scriptChunks.map((chunk, i) => h("span", { key: i },
                studyText(chunk.text, `script:${reviewPart}:${i}`, true, occurrenceSpans(scriptPart.transcript, chunk.text, occurrences[reviewPart] ?? [])),
                chunk.gap && h("span", { className: "inline-flex flex-wrap items-center gap-2 mx-1" },
                    h("strong", null, chunk.gap.q),
                    h("input", { className: "input inline-block !w-48", "aria-label": `PART ${reviewPart} · ${chunk.gap.q}`, maxLength: 200, value: answers[chunk.gap.q] ?? "", onChange: event => answer(String(chunk.gap.q), event.target.value) }),
                    (result || revealed[chunk.gap.q]) && h("span", { className: "text-sm" }, answers[chunk.gap.q]?.trim().toLowerCase() === chunk.gap.answer.toLowerCase() ? dict.fullListeningHub.activity.correct : chunk.gap.answer))))),
            h("button", { type: "button", className: "btn-primary", disabled: busy || scriptPart.gaps.some(gap => !answers[gap.q]?.trim()), onClick: () => { setRevealed(old => ({ ...old, ...Object.fromEntries(scriptPart.gaps.map(gap => [gap.q, true])) })); void save(false); } }, dict.fullListeningHub.activity.checkAll)),
        activity === 3 && !scriptPart && (h(fragment, null,
            h("p", null, dict.fullListeningHub.study.keywordIntro),
            data.keyword1?.map((x) => (h("article", { className: "card listening-review-grid", key: x.q },
                h("div", null,
                    h("h2", null,
                        "Q",
                        x.sourceQuestion ?? x.q,
                        " \u00B7 PART ",
                        x.part ?? data.questionSections?.[x.sourceQuestion ?? x.q] ?? data.questions?.find(q => q.number === x.q)?.section ?? 1),
                    h("div", null, studyText(x.text, `k1:${x.q}:text`)),
                    h("button", { type: "button", className: "btn-secondary", onClick: () => void clip(x.at, x.end) }, "\u25B6 Play moment")),
                h("div", null,
                    h("p", null, dict.fullListeningHub.activity.speakerSaid),
                    !data.studyPack && h("blockquote", null, studyText(x.heard, `k${activity === 3 ? 1 : 2}:${x.q}:heard`)),
                    h("label", null,
                        dict.fullListeningHub.activity.yourMatches,
                        h("textarea", { className: "input mt-2", value: answers[x.q] ?? "", onChange: (e) => answer(String(x.q), e.target.value) })),
                    result && h("div", null,
                        "Model: ",
                        studyText(x.link, `k1:${x.q}:link`)))))))),
        activity === 4 && (h(fragment, null,
            h("p", null, "Hear \u2192 Meaning. Listen first, choose the meaning, then reveal the source relationship."),
            data.keyword2?.map((x) => (h("article", { className: "card space-y-3", key: x.q },
                h("h2", null,
                    "Q",
                    x.sourceQuestion ?? x.q,
                    " \u00B7 PART ",
                    x.part ?? data.questionSections?.[x.sourceQuestion ?? x.q] ?? data.questions?.find(q => q.number === x.q)?.section ?? 1),
                h("button", { type: "button", className: "btn-primary", onClick: () => void clip(x.at, x.end) }, "\u25B6 Hear moment"),
                h("label", null,
                    "Meaning",
                    "options" in x ? h("select", { className: "input", value: answers[x.q] ?? "", disabled: !!revealed[x.q], onChange: (e) => answer(String(x.q), e.target.value) },
                        h("option", { value: "" }, dict.fullListeningHub.activity.chooseMeaning),
                        x.options.map((o, i) => (h("option", { key: o, value: i }, o)))) : h("input", { className: "input", value: answers[x.q] ?? "", disabled: !!revealed[x.q], onChange: (e) => answer(String(x.q), e.target.value) })),
                h("button", { type: "button", className: "btn-secondary", disabled: !answers[x.q], onClick: () => setRevealed((old) => ({ ...old, [x.q]: true })) }, dict.fullListeningHub.activity.commitReveal),
                revealed[x.q] && (h(fragment, null,
                    h("blockquote", null, studyText(x.heard, `k2:${x.q}:heard`)),
                    h("div", null, studyText(x.link, `k2:${x.q}:link`))))))))),
        activity === 5 && (h(fragment, null,
            h("nav", { className: "flex gap-3" },
                h("button", { type: "button", className: !quiz ? "btn-primary" : "btn-secondary", onClick: () => setQuiz(false) }, "Study"),
                h("button", { type: "button", className: quiz ? "btn-primary" : "btn-secondary", disabled: !data.vocabulary?.some(x => x.quiz), onClick: () => setQuiz(true) }, "Quiz")),
            data.vocabulary?.map((x, i) => (h("article", { key: `${i}:${x.term}`, className: "card space-y-3", "data-session-sense": x.senseId ?? "" }, !quiz || !x.quiz ? (h(fragment, null,
                h("h2", { className: "font-display text-xl" },
                    x.term,
                    " ",
                    h("span", { className: "text-sm" }, x.partOfSpeech),
                    x.ipa && h("span", { className: "ml-2 font-mono text-sm" },
                        "/",
                        x.ipa,
                        "/")),
                x.translationUz && h("p", null, x.translationUz),
                h("p", null, x.definitionEn),
                h("div", { className: "academic-text" }, studyText(x.example, `v:${i}:example`)),
                h("p", null,
                    "Also said as: ",
                    x.also.join(" · ")),
                h("button", { type: "button", className: "btn-secondary", onClick: () => {
                        if (typeof speechSynthesis === "undefined") {
                            setError(dict.fullListeningHub.activity.pronunciationUnavailable);
                            return;
                        }
                        speechSynthesis.cancel();
                        const utterance = new SpeechSynthesisUtterance(x.term);
                        utterance.lang = "en-GB";
                        speechSynthesis.speak(utterance);
                    } }, dict.fullListeningHub.activity.sayIt),
                h("button", { type: "button", className: "btn-primary", onClick: () => void chooseVocabularyFolder(i) }, "+ Vocabulary"),
                vocabSelection === i && h("fieldset", { className: "space-y-3 rounded-xl border border-signal-600/30 p-3", "data-listening-vocabulary-folder": true },
                    h("legend", { className: "text-sm" }, dict.vocabulary.games.set.folder),
                    h("select", { className: "input", value: vocabFolderId, disabled: foldersLoading || vocabSaving, onChange: e => setVocabFolderId(e.target.value), "aria-label": dict.vocabulary.games.set.folder },
                        h("option", { value: "" }, dict.nav.listening),
                        vocabFolders.map(folder => h("option", { key: folder.id, value: folder.id }, folder.name))),
                    h("div", { className: "flex gap-2" },
                        h("button", { type: "button", className: "btn-primary", disabled: foldersLoading || vocabSaving, onClick: () => void vocabulary(i) }, vocabSaving ? dict.common.saving : dict.vocabulary.add.button),
                        h("button", { type: "button", className: "btn-secondary", disabled: vocabSaving, onClick: () => setVocabSelection(null) }, dict.common.cancel))))) : (h(fragment, null,
                h("h2", null, x.quiz.q),
                h("label", null,
                    "Answer",
                    h("select", { className: "input", value: answers[i] ?? "", onChange: (e) => answer(String(i), e.target.value) },
                        h("option", { value: "" }, dict.fullListeningHub.activity.choose),
                        x.quiz.options.map((o, n) => (h("option", { key: o, value: n }, o))))),
                result && (h("p", null,
                    Number(answers[i]) === x.quiz.correct
                        ? dict.fullListeningHub.activity.correct
                        : dict.fullListeningHub.activity.incorrect,
                    " ",
                    "\u00B7 ",
                    x.quiz.options[x.quiz.correct]))))))))),
        h("div", { className: "flex flex-wrap gap-3" },
            h("button", { type: "button", className: "btn-secondary", disabled: busy, onClick: () => void save(false) }, dict.fullListeningHub.activity.saveProgress),
            h("button", { type: "button", className: "btn-primary", disabled: busy, onClick: () => void save(true) }, activity === 2 ? dict.fullListeningHub.activity.completeReviewed : dict.fullListeningHub.activity.checkAll),
            h("button", { type: "button", className: "btn-secondary", disabled: busy, onClick: () => {
                    setAnswers({});
                    setResult(null);
                    setRevealed({});
                } }, dict.fullListeningHub.activity.tryAgain)),
        error && h("p", { role: "alert" }, error),
        result && (h("p", { role: "status", className: "card" },
            result.score === null ? dict.fullListeningHub.completed : `${result.score} / ${result.total}`,
            " \u00B7 ",
            dict.fullListeningHub.completed))));
}
