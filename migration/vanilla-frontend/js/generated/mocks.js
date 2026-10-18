import {h,fragment,Link} from '../native.js';
import {Card,StatCard} from './ui.js';
import {Button,RegionFailureNotice as FailureNotice} from '../../modules/shared/presentation.js';
import {BandBadge,StateBadge} from './badges.js';
import {formatDate,formatDateTime} from './time.js';
import {summarizeMocks} from './mock-summary.js';
import {MockBandPanel} from './mock-band.js';
export function render(scope) {
    const { context, dict, user } = scope;
    const t = dict.mocks;
    const Suspense = ({ children }) => fragment({ children }), RegionFailureNotice = p => FailureNotice({ ...p, refresh: context.refresh });
    function MocksContent({ user, dict }) {
        const t = dict.mocks;
        const data = scope.mock;
        return (h("div", { className: "flex flex-col gap-4", "data-mocks-content": true, "data-async-content": "mocks" },
            data.catalogueUnavailable && h(RegionFailureNotice, { region: "mocks-catalogue", message: dict.errors.unknown, retryLabel: dict.errorPage.retry }),
            data.attemptsUnavailable && h(RegionFailureNotice, { region: "mocks-attempts", message: dict.errors.unknown, retryLabel: dict.errorPage.retry }),
            data.attemptTitlesUnavailable && h(RegionFailureNotice, { region: "mocks-attempt-titles", message: dict.errors.unknown, retryLabel: dict.errorPage.retry }),
            h(Card, { "data-mocks-catalogue": true },
                h("h2", { className: "mb-2 font-display text-lg text-ink-900" }, t.catalogue),
                data.catalogueUnavailable ? null : data.tests.length === 0 ? (h("p", { className: "text-sm text-ink-500", "data-mocks-empty": true }, t.noTests)) : (h("ul", { className: "flex flex-col divide-y divide-ink-100" }, data.tests.map((test) => (h("li", { key: test.id, className: "flex items-center justify-between py-2", "data-mock-test": test.id },
                    h("span", { className: "text-sm text-ink-900" }, test.title),
                    h("span", { className: "text-xs text-ink-300" }, test.skill))))))),
            h(Card, { "data-mocks-attempts": true },
                h("div", { className: "flex items-center justify-between" },
                    h("h2", { className: "font-display text-lg text-ink-900" }, t.myAttempts),
                    !data.attemptsUnavailable && (h("span", { className: "text-sm text-ink-500", "data-mocks-finished": data.finishedCount },
                        data.finishedCount,
                        " ",
                        t.finished))),
                data.attemptsUnavailable ? null : data.attempts.length === 0 ? (h("p", { className: "mt-2 text-sm text-ink-500", "data-mocks-attempts-empty": true }, t.noAttempts)) : (h("ul", { className: "mt-2 flex flex-col divide-y divide-ink-100" }, data.attempts.map((attempt) => (h("li", { key: attempt.id, className: "flex items-center justify-between py-2", "data-mock-attempt": attempt.id },
                    h("span", { className: "min-w-0 text-sm text-ink-900" }, attempt.title ?? t.untitled),
                    h("span", { className: "shrink-0 text-xs text-ink-300", "data-mock-state": attempt.finishedAt ? "finished" : "unfinished" }, attempt.finishedAt
                        ? `${t.band} ${attempt.estimatedBand ?? "—"} · ${attempt.rawScore ?? "—"} ${t.raw}`
                        : t.unfinished)))))),
                h("p", { className: "mt-3 text-xs text-ink-300" }, t.unfinishedNote))));
    }
    function MocksSkeleton() {
        return (h("div", { "aria-hidden": "true", className: "flex flex-col gap-4", "data-async-loading": "mocks" },
            h("div", { className: "h-32 animate-pulse rounded-xl bg-ink-50" }),
            h("div", { className: "h-40 animate-pulse rounded-xl bg-ink-50" })));
    }
    return (h("div", { className: "mx-auto flex max-w-3xl flex-col gap-4", "data-route-usable": "mocks" },
        h("div", null,
            h("h1", { className: "font-display text-2xl text-ink-900" }, dict.nav.mocks),
            h("p", { className: "text-sm text-ink-500" }, t.subtitle)),
        h(Card, { "data-mocks-runner-note": true, className: "border-gold/40" },
            h("p", { className: "text-sm text-ink-700" }, t.runnerNote)),
        h(Suspense, { fallback: h(MocksSkeleton, null) },
            h(MocksContent, { user: user, dict: dict }))));
}
