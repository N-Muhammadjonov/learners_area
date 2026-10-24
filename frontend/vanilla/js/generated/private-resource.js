/**
 * Private, user-scoped, in-memory read cache for learner resources.
 *
 * Runtime Stability contract (docs/RUNTIME-STABILITY-ARCHITECTURE.md):
 *
 *   * Memory only. Nothing is written to localStorage, sessionStorage,
 *     IndexedDB or a service worker, so a full reload always starts empty.
 *   * Every entry is keyed by `[scopeId, resource, params]`. The scope is the
 *     authenticated user id handed down by the server-rendered shell. When the
 *     scope changes (account switch) or is cleared (logout) every entry and
 *     every in-flight read is dropped, so user A's data can never be returned
 *     to user B.
 *   * Cached data is presentation only. It is never consulted for identity,
 *     role, accountStatus, ownership or any Retention state; the server stays
 *     authoritative and a 401 still sends the route back through the gate.
 *   * Only idempotent GET reads use this module. Mutations and every Retention
 *     endpoint are deliberately excluded (see RETENTION_EXCLUDED below).
 *   * Identical in-flight reads for the same key share one request.
 *   * Every read has a deadline and at most a small number of retries, and
 *     only for transient failures (network, timeout, 502/503/504).
 */
export class PrivateReadError extends Error {
    kind;
    status;
    constructor(kind, status) {
        super(`private read failed: ${kind} ${status}`);
        this.kind = kind;
        this.status = status;
        this.name = "PrivateReadError";
    }
}
export const DEFAULT_TIMEOUT_MS = 12_000;
export const MAX_RETRIES = 2;
const TRANSIENT_STATUS = new Set([502, 503, 504]);
/** Retention payloads must never be cached, deduplicated or retried here. */
const RETENTION_EXCLUDED = /\/api\/retention|\/api\/owner\/retention|\/api\/admin\/retention/;
export function isRetryable(error) {
    return error instanceof PrivateReadError && (error.kind === "transient" || error.kind === "timeout");
}
let diagnosticSink = null;
/** Stable labels only: resource keys never contain text, answers or tokens. */
export function setPrivateResourceDiagnostics(sink) {
    diagnosticSink = sink;
}
function emit(event, resource, detail) {
    try {
        diagnosticSink?.({ event, resource, detail });
    }
    catch {
        /* diagnostics must never break a read */
    }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * One bounded GET. Resolves with the parsed `{ ok: true }` payload or rejects
 * with a classified PrivateReadError — never pends forever.
 */
export async function fetchPrivateJson(url, options = {}) {
    if (RETENTION_EXCLUDED.test(url))
        throw new Error("Retention endpoints are excluded from the private read cache");
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000));
    const retries = Math.max(0, Math.min(options.retries ?? 1, MAX_RETRIES));
    const retryDelayMs = options.retryDelayMs ?? 300;
    let attempt = 0;
    for (;;) {
        try {
            return await fetchOnce(url, timeoutMs, options.onAuthFailure);
        }
        catch (error) {
            if (attempt >= retries || !isRetryable(error))
                throw error;
            attempt += 1;
            emit("retry", url.split("?")[0] ?? url, attempt);
            await sleep(retryDelayMs * attempt);
        }
    }
}
async function fetchOnce(url, timeoutMs, onAuthFailure) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    try {
        let response;
        try {
            response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        }
        catch {
            throw new PrivateReadError(timedOut ? "timeout" : "transient", 0);
        }
        if (response.status === 401) {
            onAuthFailure?.();
            throw new PrivateReadError("auth", 401);
        }
        if (response.status === 403)
            throw new PrivateReadError("auth", 403);
        if (TRANSIENT_STATUS.has(response.status))
            throw new PrivateReadError("transient", response.status);
        if (response.status >= 500)
            throw new PrivateReadError("server", response.status);
        if (response.status >= 400)
            throw new PrivateReadError("client", response.status);
        let payload;
        try {
            payload = (await response.json());
        }
        catch {
            throw new PrivateReadError(timedOut ? "timeout" : "invalid", response.status);
        }
        if (!payload || payload.ok !== true)
            throw new PrivateReadError("invalid", response.status);
        return payload;
    }
    finally {
        clearTimeout(timer);
    }
}
export function createPrivateResourceCache(now = Date.now) {
    let scope = null;
    let generation = 0;
    const entries = new Map();
    const inflight = new Map();
    const fullKey = (resource) => {
        if (!scope)
            return null;
        return JSON.stringify([scope, resource]);
    };
    function clear(reason) {
        generation += 1;
        entries.clear();
        inflight.clear();
        emit("clear", "*", reason);
    }
    return {
        /** Binds the cache to the authenticated user; a different user clears it. */
        setScope(next) {
            if (next === scope)
                return;
            if (scope !== null || next === null)
                clear(next === null ? "logout" : "scope-change");
            scope = next;
        },
        get scope() {
            return scope;
        },
        clear,
        /** Synchronous snapshot for immediate repeat-visit rendering. */
        peek(resource) {
            const key = fullKey(resource);
            const entry = key ? entries.get(key) : undefined;
            return entry ? { data: entry.data, ageMs: now() - entry.storedAt } : null;
        },
        set(resource, data) {
            const key = fullKey(resource);
            if (key)
                entries.set(key, { data, storedAt: now() });
        },
        /**
         * Reads through the cache. Fresh entries (younger than maxAgeMs) are
         * returned without a request unless `force` is set; identical concurrent
         * reads share one promise. Results from a previous scope are discarded.
         */
        async read(resource, loader, opts = {}) {
            const key = fullKey(resource);
            if (!key)
                return loader(); // no scope yet: never store anything
            const entry = entries.get(key);
            if (!opts.force && entry && now() - entry.storedAt < (opts.maxAgeMs ?? 0)) {
                emit("hit", resource);
                return entry.data;
            }
            const shared = inflight.get(key);
            if (shared) {
                emit("dedupe", resource);
                return shared;
            }
            emit("miss", resource);
            const startedGeneration = generation;
            const promise = loader().then((data) => {
                if (generation === startedGeneration)
                    entries.set(key, { data, storedAt: now() });
                return data;
            }).finally(() => {
                if (inflight.get(key) === promise)
                    inflight.delete(key);
            });
            inflight.set(key, promise);
            return promise;
        },
        /** Narrow invalidation: drops entries whose resource starts with prefix. */
        invalidate(prefix) {
            let dropped = 0;
            for (const key of [...entries.keys()]) {
                const [, resource] = JSON.parse(key);
                if (resource.startsWith(prefix)) {
                    entries.delete(key);
                    dropped += 1;
                }
            }
            emit("invalidate", prefix, dropped);
        },
        size() {
            return entries.size;
        },
    };
}
/** The one browser instance. Module memory only; empty after a reload. */
export const privateResources = createPrivateResourceCache();
