import {h,fragment} from '../native.js';
const stateClass = {
    locked: "badge-locked",
    available: "badge bg-signal-100 text-signal-700",
    assigned: "badge bg-band-warn/10 text-band-warn",
    in_progress: "badge bg-band-warn/10 text-band-warn",
    completed: "badge-done",
};
const stateLabel = {
    locked: "Locked",
    available: "Available",
    assigned: "Assigned",
    in_progress: "In progress",
    completed: "Completed",
};
export function StateBadge({ state }) {
    return h("span", { className: stateClass[state] }, stateLabel[state]);
}
export function BandBadge({ band }) {
    if (band === null || band === undefined) {
        return h("span", { className: "badge-locked" }, "\u2014");
    }
    const tone = band >= 7 ? "text-band-good" : band >= 5.5 ? "text-band-warn" : "text-band-bad";
    return h("span", { className: `badge bg-paper-sunken font-mono ${tone}` }, band.toFixed(1));
}
const vocabStateClass = {
    new: "badge bg-ink-100 text-ink-500",
    learning: "badge bg-band-warn/10 text-band-warn",
    known: "badge bg-band-good/10 text-band-good",
    active: "badge bg-signal-100 text-signal-700",
    mastered: "badge bg-gold/20 text-ink-900",
};
export function VocabBadge({ state, label }) {
    return h("span", { className: vocabStateClass[state] }, label);
}
