// Reviewed src/components/interaction/GlobalControlDiagnostics.tsx effect. Native listeners/observers only; no framework runtime.
import { controlFamily, workspaceKey } from './interaction-navigation.js';
let globalSequence = 0;
const actionOwners = new Set();
export function beginActionMeasurement(category, signal) { const owner = [...actionOwners].at(-1); if (!owner || signal?.aborted)
    return () => { }; category = ['local', 'navigation', 'data-view', 'mutation', 'destructive', 'external'].includes(category) ? category : 'mutation'; const id = 'action-' + (++globalSequence), started = performance.now(); let done = false; console.info('[qa-perf] ' + JSON.stringify({ event: 'interactionStart', id, category, controlFamily: 'button', routeKey: workspaceKey(location.pathname) })); owner.schedule(() => { if (actionOwners.has(owner) && !signal?.aborted)
    console.info('[qa-perf] ' + JSON.stringify({ event: 'firstVisibleResponse', id, category, controlFamily: 'button', responseLatencyMs: round(performance.now() - started), responseSignal: 'next-animation-frame' })); }); return outcome => { if (done || signal?.aborted || !actionOwners.has(owner) || !['success', 'failure'].includes(outcome))
    return; done = true; console.info('[qa-perf] ' + JSON.stringify({ event: 'asyncCompletion', id, outcome, completionLatencyMs: round(performance.now() - started), completionSource: 'awaited-action' })); }; }
const round = value => Math.round(value * 10) / 10;
export function setup({ insideShell = false } = {}) {
    const safeCategory = (v, fallback) => ['local', 'navigation', 'data-view', 'mutation', 'destructive', 'external'].includes(v) ? v : fallback;
    const frames = new Set();
    const schedule = callback => { const id = requestAnimationFrame(() => { frames.delete(id); callback(); }); frames.add(id); };
    const actionOwner = { schedule };
    if (insideShell)
        actionOwners.add(actionOwner);
    const report = (event, fields) => {
        console.info(`[qa-perf] ${JSON.stringify({ event, ...fields })}`);
    };
    const start = (category, element) => {
        const id = `${insideShell ? "shell" : "public"}-${++globalSequence}`;
        const startedAt = performance.now();
        report("interactionStart", {
            id,
            category,
            controlFamily: controlFamily(element.tagName, element.getAttribute("role")),
            routeKey: workspaceKey(location.pathname),
        });
        schedule(() => report("firstVisibleResponse", {
            id,
            category,
            controlFamily: controlFamily(element.tagName, element.getAttribute("role")),
            responseLatencyMs: round(performance.now() - startedAt),
            responseSignal: "next-animation-frame",
        }));
    };
    const click = (event) => {
        if (!(event.target instanceof Element) || Boolean(event.target.closest("[data-shell]:not([data-auth-shell])")) !== insideShell)
            return;
        const control = event.target.closest("a[href],button,input,[role='button'],[role='tab']");
        if (!control || control.getAttribute("aria-disabled") === "true")
            return;
        const link = control instanceof HTMLAnchorElement ? control : control.closest("a[href]");
        if (link) {
            const category = link.origin === location.origin ? "navigation" : "external";
            start(category, control);
            return;
        }
        const form = control.closest("form");
        const submit = form && ((control instanceof HTMLButtonElement && (control.type === "submit" || !control.hasAttribute("type"))) ||
            (control instanceof HTMLInputElement && ["submit", "image"].includes(control.type)));
        if (submit)
            return;
        const category = control.getAttribute("data-interaction-type");
        start(safeCategory(category, "local"), control);
    };
    const change = (event) => {
        if (!(event.target instanceof Element) || Boolean(event.target.closest("[data-shell]:not([data-auth-shell])")) !== insideShell)
            return;
        if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement))
            return;
        const category = event.target.getAttribute("data-interaction-type");
        start(safeCategory(category, "local"), event.target);
    };
    const submit = (event) => {
        if (!(event.target instanceof HTMLFormElement) || Boolean(event.target.closest("[data-shell]:not([data-auth-shell])")) !== insideShell)
            return;
        const category = event.target.getAttribute("data-interaction-type");
        start(safeCategory(category, "mutation"), event.target);
    };
    document.addEventListener("click", click, true);
    document.addEventListener("change", change, true);
    document.addEventListener("submit", submit, true);
    return () => {
        actionOwners.delete(actionOwner);
        frames.forEach(cancelAnimationFrame);
        frames.clear();
        document.removeEventListener("click", click, true);
        document.removeEventListener("change", change, true);
        document.removeEventListener("submit", submit, true);
    };
}
