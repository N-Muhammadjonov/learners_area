// Source-extracted pure UI. No React/Next/server runtime.
import {h,fragment,Link} from '../native.js';import {Card,ProgressBar} from './ui.js';import {StateBadge} from './badges.js';
import {RegionFailureNotice as Notice} from '../../modules/shared/presentation.js';
const MASTERY_SESSIONS = 3;
export function render({ rows, dict, area, refresh }) {
    const RegionFailureNotice = props => Notice({ ...props, refresh });
    const selectedRows = rows.filter(row => row.topic.skillArea === area);
    const masteryUnavailable = selectedRows.some(row => row.masteryUnavailable);
    return (h(fragment, null,
        masteryUnavailable && (h(RegionFailureNotice, { region: "grammar-mastery", message: dict.errors.unknown, retryLabel: dict.errorPage.retry })),
        h("div", { className: "flex flex-col gap-3", "data-grammar-topics": true, "data-async-content": "grammar-topics" },
            h("section", { key: area, className: "space-y-3", "data-grammar-skill": area },
                h("h2", { className: "font-display text-xl" }, area === "writing" ? dict.grammar.forWriting : dict.grammar.forSpeaking),
                selectedRows.map(({ topic, totalExercises, mastery }) => (h(Link, { key: topic.id, href: `/app/grammar/${topic.id}` },
                    h(Card, { className: "hover:border-signal-400", "data-topic-row": topic.id },
                        h("div", { className: "mb-2 flex items-center justify-between" },
                            h("p", { className: "text-sm font-medium text-ink-900" }, topic.title),
                            h("span", { className: "flex items-center gap-2 text-xs text-ink-300" },
                                mastery?.mastered && (h("span", { className: "badge bg-band-good/10 text-band-good", "data-topic-mastered": topic.id }, dict.grammar.masteryMastered)),
                                mastery ? (h("span", { "data-topic-score": topic.id },
                                    dict.grammar.masteryScore,
                                    ": ",
                                    mastery.scorePercent,
                                    "% \u00B7 ",
                                    mastery.sessions,
                                    "/",
                                    MASTERY_SESSIONS,
                                    " ",
                                    dict.grammar.masterySessions.toLowerCase())) : h("span", { "data-topic-mastery-unavailable": topic.id }, "\u2014"))),
                        mastery && h(ProgressBar, { value: mastery.scorePercent }),
                        h("p", { className: "mt-1 text-xs text-ink-300" },
                            dict.grammar.masteryActivities,
                            ": ",
                            totalExercises,
                            " ",
                            dict.grammar.exercises)))))))));
}
export function loading() {
    return (h("div", { "aria-hidden": "true", className: "flex flex-col gap-3", "data-grammar-topics-skeleton": true, "data-async-loading": "grammar-topics" }, [0, 1, 2].map((row) => h("div", { key: row, className: "h-24 animate-pulse rounded-xl bg-ink-50" }))));
}
