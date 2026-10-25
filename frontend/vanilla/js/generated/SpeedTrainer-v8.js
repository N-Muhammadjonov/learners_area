import {h,fragment,Link} from '../native.js';import {ListeningMap} from './listening-map.js';import {occurrenceSpans} from './listening-occurrence-spans.js';
import {Card,EmptyState} from './ui.js';import {Button} from '../../modules/shared/presentation.js';import {Input} from '../../modules/shared/inputs.js';
export function render(scope) {
    const { dict, audioUrl, rateControlSupported, status, transcript, sourceId, audioRef, rate, showTranscript, failed, applyRate, setShowTranscript, setFailed, ClickableText } = scope;
    const SPEED_RATES = [1, 1.25, 1.5, 1.75, 2];
    if (!rateControlSupported) {
        return (h(Card, { "data-speed-unsupported": true },
            h("h2", { className: "font-display text-lg text-ink-900" }, dict.listening.speedTitle),
            h("p", { className: "mt-1 text-sm text-ink-500" }, dict.listening.speedUnsupported)));
    }
    if (!status.unlocked) {
        return (h(Card, { "data-speed-locked": true, "data-speed-percent": status.percent },
            h("h2", { className: "font-display text-lg text-ink-900" }, dict.listening.speedTitle),
            h("p", { className: "mt-1 text-sm text-ink-500" }, (status.notAttemptedYet ? dict.listening.speedNoAttempt : dict.listening.speedLocked)
                .replace("{percent}", String(status.thresholdPercent))
                .replace("{current}", String(status.percent)))));
    }
    return (h(Card, { "data-speed-unlocked": true },
        h("div", { className: "flex flex-wrap items-center justify-between gap-2" },
            h("h2", { className: "font-display text-lg text-ink-900" }, dict.listening.speedTitle),
            h("span", { className: "text-xs text-ink-300" }, dict.listening.speedHint)),
        h("audio", { ref: audioRef, controls: true, preload: "none", src: audioUrl ?? undefined, className: "mt-3 w-full", onError: () => setFailed(true), "data-speed-audio": true }),
        h("div", { className: "mt-3 flex flex-wrap items-center gap-2" },
            h("span", { className: "text-xs font-medium uppercase tracking-wide text-ink-300" }, dict.listening.speedRate),
            SPEED_RATES.map((value) => (h("button", { key: value, type: "button", "data-speed-rate": value, "aria-pressed": rate === value, className: `badge ${rate === value ? "bg-signal-600 text-paper" : "bg-paper-sunken text-ink-500"}`, onClick: () => applyRate(value) },
                value.toFixed(2).replace(/0$/, ""),
                "\u00D7"))),
            transcript && (h("button", { type: "button", "data-speed-transcript": true, className: "badge bg-paper-sunken text-ink-500", onClick: () => setShowTranscript((v) => !v) }, showTranscript ? dict.listening.speedHideTranscript : dict.listening.speedTranscript))),
        failed && (h("p", { className: "mt-2 text-sm text-band-bad", "data-speed-error": true }, dict.listening.speedAudioError)),
        transcript && showTranscript && (h(ClickableText, { dict: dict, text: transcript, sourceType: "listening", sourceId: sourceId, className: "academic-text mt-3 rounded-sm bg-paper-sunken p-3 text-sm text-ink-700" }))));
}
