// Reviewed src/components/diagnostics/PerformanceDiagnostics.tsx effect. Native listeners/observers only; no framework runtime.
let diagnosticDocumentId = null;
export function setup({ insideShell = false } = {}) {
    diagnosticDocumentId ??= typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(performance.timeOrigin);
    const documentId = diagnosticDocumentId;
    const documentEntry = performance.getEntriesByType("navigation")[0];
    console.info(`[qa-perf] ${JSON.stringify({ event: "documentLifecycle", documentId, type: documentEntry?.type ?? "unknown" })}`);
    let sequence = 0;
    let sample = null;
    const frames = new Set();
    let timer;
    const round = (value) => Math.round(value * 10) / 10;
    const report = (event, data) => {
        console.info(`[qa-perf] ${JSON.stringify({ event, documentId, ...data })}`);
    };
    const modules = new Set(["dashboard", "reading", "vocabulary", "notifications", "support", "listening", "writing", "speaking", "grammar", "assignments", "video-lessons", "live-classes", "progress", "mocks", "management", "teacher", "admin", "owner"]);
    const moduleFor = (url) => {
        const segment = url.pathname.split("/")[2] ?? "other";
        return modules.has(segment) ? segment : "other";
    };
    const afterPaint = (fn) => {
        const schedule = (callback) => {
            const id = requestAnimationFrame(() => { frames.delete(id); callback(); });
            frames.add(id);
        };
        schedule(() => schedule(fn));
    };
    report("nativeReady", { module: moduleFor(new URL(location.href)), sinceDocumentStartMs: round(performance.now()) });
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav)
        report("document", { ttfbMs: round(nav.responseStart - nav.requestStart), responseMs: round(nav.responseEnd - nav.requestStart), domInteractiveMs: round(nav.domInteractive), transferBytes: nav.transferSize });
    const observers = [];
    for (const type of ["longtask", "largest-contentful-paint", "resource"]) {
        if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes.includes(type))
            continue;
        let observer;
        try {
            observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (type === "resource") {
                        const resource = entry;
                        const url = new URL(resource.name);
                        if (url.origin !== location.origin)
                            continue;
                        const kind = url.searchParams.has("_rsc") ? "rsc" : url.pathname.startsWith("/api/") ? "api" : resource.initiatorType;
                        if (!["rsc", "api", "script", "css"].includes(kind))
                            continue;
                        report("resource", { kind, startMs: round(entry.startTime), durationMs: round(entry.duration), ttfbMs: round(resource.responseStart - resource.requestStart), bytes: resource.transferSize });
                    }
                    else
                        report(type, { startMs: round(entry.startTime), durationMs: round(entry.duration) });
                }
            });
            observer.observe({ type, buffered: true });
            observers.push(observer);
        }
        catch {
            observer?.disconnect();
        }
    }
    const state = (current) => {
        if (current.kind === "navigation") {
            const locationMatches = location.pathname + location.search === current.target;
            const routePending = Boolean(document.querySelector("[data-entry-frame], [data-route-loading]"));
            const workspacePending = Boolean(document.querySelector("[data-workspace-loading]"));
            const navigationPending = Boolean(document.querySelector("[data-navigation-pending]"));
            const asyncPending = Boolean(document.querySelector("[data-async-loading]"));
            const ready = !document.querySelector("[data-migration-unavailable], [data-integration-required]") && locationMatches && !routePending && !workspacePending && !navigationPending && Boolean(document.querySelector("[data-shell-main]")?.textContent?.trim());
            return {
                loading: routePending || workspacePending || navigationPending || asyncPending,
                ready,
                dataReady: ready && !asyncPending,
                failed: Boolean(document.querySelector("[data-app-error]")),
            };
        }
        if (current.kind === "search-open")
            return { loading: false, ready: Boolean(document.querySelector("[data-global-search-dialog]")), failed: false };
        if (current.kind === "search") {
            const status = document.querySelector("[data-global-search-dialog]")?.getAttribute("data-search-state");
            return { loading: status === "loading", ready: status === "ready" || status === "error", failed: status === "error" };
        }
        return { loading: Boolean(document.querySelector("[data-report-send]:disabled")), ready: Boolean(document.querySelector("[data-report-sent], [data-report-failed]")), failed: Boolean(document.querySelector("[data-report-failed]")) };
    };
    const finishNavigation = (current, failed) => {
        if (!current.usableReported || !current.dataReported)
            return;
        report("interaction", {
            id: current.id,
            kind: current.kind,
            module: current.module,
            failed,
            total_interaction_ms: round(performance.now() - current.started),
        });
        sample = null;
        clearTimeout(timer);
    };
    function inspect() {
        const current = sample;
        if (!current)
            return;
        const status = state(current);
        if (!current.feedbackQueued && status.loading) {
            current.feedbackQueued = true;
            afterPaint(() => {
                if (sample !== current)
                    return;
                current.feedbackAt = performance.now();
                report("firstVisibleResponse", {
                    id: current.id,
                    kind: current.kind,
                    module: current.module,
                    clickToFirstResponseMs: round(current.feedbackAt - current.started),
                    responseSignal: "double-animation-frame-paint-opportunity",
                });
            });
        }
        if (current.kind === "navigation") {
            if (status.ready && !current.contentQueued && !current.usableReported) {
                current.contentQueued = true;
                afterPaint(() => {
                    current.contentQueued = false;
                    if (sample !== current || !state(current).ready || current.usableReported)
                        return;
                    const usableAt = performance.now();
                    current.usableAt = usableAt;
                    current.usableReported = true;
                    if (current.feedbackAt === undefined) {
                        current.feedbackAt = usableAt;
                        report("firstVisibleResponse", {
                            id: current.id,
                            kind: current.kind,
                            module: current.module,
                            clickToFirstResponseMs: round(usableAt - current.started),
                            responseSignal: "destination-paint-opportunity",
                        });
                    }
                    report("usableView", {
                        id: current.id,
                        module: current.module,
                        failed: state(current).failed,
                        clickToUsableViewMs: round(usableAt - current.started),
                        clickToFirstResponseMs: current.feedbackAt === undefined ? null : round(current.feedbackAt - current.started),
                    });
                    finishNavigation(current, state(current).failed);
                    if (sample === current)
                        inspect();
                });
            }
            const navStatus = status;
            if (navStatus.dataReady && !current.dataQueued && !current.dataReported) {
                current.dataQueued = true;
                afterPaint(() => {
                    current.dataQueued = false;
                    const settled = state(current);
                    if (sample !== current || !settled.ready || !settled.dataReady || current.dataReported)
                        return;
                    const completedAt = performance.now();
                    current.dataReported = true;
                    report("asyncDataCompletion", {
                        id: current.id,
                        module: current.module,
                        completionSource: "route-content-and-async-regions-settled",
                        clickToDataCompletionMs: round(completedAt - current.started),
                        usableToDataCompletionMs: current.usableAt === undefined ? null : round(completedAt - current.usableAt),
                    });
                    finishNavigation(current, settled.failed);
                });
            }
            return;
        }
        if (!status.ready || current.contentQueued)
            return;
        current.contentQueued = true;
        afterPaint(() => {
            current.contentQueued = false;
            if (sample !== current || !state(current).ready)
                return;
            const end = performance.now();
            report("usableView", {
                id: current.id,
                kind: current.kind,
                module: current.module,
                failed: state(current).failed,
                clickToUsableViewMs: round(end - current.started),
                clickToFirstResponseMs: current.feedbackAt === undefined ? null : round(current.feedbackAt - current.started),
            });
            sample = null;
            clearTimeout(timer);
        });
    }
    const begin = (kind, module, target) => {
        if (sample)
            report("superseded", { id: sample.id, kind: sample.kind });
        frames.forEach(cancelAnimationFrame);
        frames.clear();
        clearTimeout(timer);
        sample = {
            id: ++sequence, kind, module, target, started: performance.now(),
            feedbackQueued: false, contentQueued: false, usableReported: false, dataQueued: false, dataReported: false,
        };
        report("start", { id: sequence, kind, module, startMs: round(sample.started) });
        timer = setTimeout(() => {
            if (sample)
                report("incomplete", { id: sample.id, kind: sample.kind, total_interaction_ms: round(performance.now() - sample.started) });
            sample = null;
        }, 30_000);
    };
    const click = (event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !(event.target instanceof Element))
            return;
        if (event.target.closest("[data-global-search-trigger]"))
            return begin("search-open", "search");
        if (event.target.closest("[data-report-send]"))
            return begin("support-send", "support");
        const link = event.target.closest("a[href]");
        if (!link || link.target === "_blank" || link.hasAttribute("download"))
            return;
        const url = new URL(link.href);
        if (url.origin === location.origin && url.pathname + url.search !== location.pathname + location.search)
            begin("navigation", moduleFor(url), url.pathname + url.search);
    };
    const input = (event) => {
        if (!(event.target instanceof HTMLInputElement) || !event.target.closest("[data-global-search]"))
            return;
        if (event.target.value.trim().length >= 2)
            begin("search", "search");
        else if (sample?.kind === "search") {
            sample = null;
            clearTimeout(timer);
        }
    };
    const mutations = new MutationObserver(inspect);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-navigation-pending", "data-entry-frame", "data-route-loading", "data-async-loading", "data-search-state", "disabled"] });
    document.addEventListener("click", click, true);
    document.addEventListener("input", input, true);
    return () => {
        sample = null;
        clearTimeout(timer);
        frames.forEach(cancelAnimationFrame);
        observers.forEach((observer) => observer.disconnect());
        mutations.disconnect();
        document.removeEventListener("click", click, true);
        document.removeEventListener("input", input, true);
    };
}
