/**
 * The one way a client component talks to this app's own API.
 *
 * Why this exists, in one sentence: `await fetch(...)` followed by
 * `await res.json()` runs only when everything goes right, and every way it can
 * go wrong leaves the same scar — the `setPending(false)` line after it never
 * runs, so the button stays on "Loading…" forever while the user waits for a
 * reply that is never coming.
 *
 * There are exactly two realistic ways that happens in production:
 *
 *   1. the request never completes (offline, DNS, TLS, a proxy, a dropped
 *      connection). `fetch` rejects, the exception escapes the handler;
 *   2. the response is not JSON. A 500 from the platform is an HTML error page,
 *      so `res.json()` throws a SyntaxError — and that is precisely the state a
 *      production deployment is in when its database has not been migrated yet.
 *
 * So `requestJson` never throws. It returns a discriminated result that says what
 * happened, and the caller decides what to show. Nothing here decides policy: it
 * does not retry, does not swallow the status code and does not invent a message.
 *
 * i18n boundary: this module returns a *reason*, not a sentence. The sentence
 * comes from the dictionary, through `failureMessage()` below, so both locales
 * stay in charge of their own wording.
 */

export type ApiFailureKind =
  /** The request or response body did not complete; status is 0 before headers. */
  | "network"
  /** 5xx: the server (or the platform in front of it) failed. */
  | "server"
  /** A 4xx with a body we could read; `error` carries the API's own code. */
  | "http"
  /** A 2xx whose body was not JSON. */
  | "parse";

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; kind: ApiFailureKind; error: string | null; reason?: string; data?: unknown };

/**
 * The dictionary entries this helper reads. Every one is optional except the two
 * transport sentences, because `dict.auth` and `dict.errors` carry different keys
 * and a caller may legitimately have only one of them to hand.
 */
export type FailureMessages = {
  errorNetwork: string;
  errorServer: string;
  errorRateLimited?: string;
  errorUnknown?: string;
};

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** FormData is passed through untouched — the browser sets its own boundary. */
  form?: FormData;
  signal?: AbortSignal;
  /** Includes headers AND body. No automatic retry of a possibly committed write. */
  timeoutMs?: number;
  /**
   * Keep the request alive past document teardown (page hide, tab close, hard
   * navigation). Only the exit path needs it: an exit flush must outlive the page, and
   * a normal `fetch` is cancelled with it. The body must stay small — browsers cap
   * keepalive payloads (~64 KB) — which a lesson note is.
   */
  keepalive?: boolean;
};

export async function requestJson<T = unknown>(
  url: string,
  options: RequestOptions = {}
): Promise<ApiResult<T>> {
  const { method = "POST", body, form, signal, timeoutMs = 25_000, keepalive = false } = options;
  const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, 2_147_483_647)
    : 25_000;
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort();
    }
  }, deadlineMs);
  try {
    return await readResponse();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }

  async function readResponse(): Promise<ApiResult<T>> {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal: controller.signal,
        cache: "no-store",
        ...(keepalive ? { keepalive: true } : {}),
        // Same-origin API calls need no credentials flag: the session cookie is
        // first-party. Sending `include` would only widen what the browser allows.
        headers: form ? undefined : body === undefined ? undefined : { "Content-Type": "application/json" },
        body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
    } catch (cause) {
      // An aborted request is not a failure the user should see: the component that
      // aborted it knows why, and reporting "connection problem" would be a lie.
      if (timedOut) return { ok: false, status: 0, kind: "network", error: "timeout" };
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) {
        return { ok: false, status: 0, kind: "network", error: "aborted" };
      }
      return { ok: false, status: 0, kind: "network", error: null };
    }

    // Read the body as text first, so a non-JSON response is a value we can inspect
    // rather than an exception we have to catch twice.
    let raw = "";
    try {
      raw = await response.text();
    } catch {
      return {
        ok: false,
        status: response.status,
        kind: "network",
        error: timedOut ? "timeout" : controller.signal.aborted ? "aborted" : "body_interrupted",
      };
    }

    let parsed: unknown = null;
    let parsedOk = false;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
        parsedOk = true;
      } catch {
        parsedOk = false;
      }
    }

    const errorValue = parsedOk && parsed && typeof parsed === "object"
      ? (parsed as { error?: unknown }).error : null;
    const errorCode = typeof errorValue === "string" ? errorValue
      : errorValue && typeof errorValue === "object" && typeof (errorValue as { code?: unknown }).code === "string"
        ? (errorValue as { code: string }).code : null;

    if (!response.ok) {
      const kind: ApiFailureKind = response.status >= 500 ? "server" : "http";
      const candidate = parsedOk && parsed && typeof parsed === "object" ? (parsed as { reason?: unknown }).reason : null;
      const reason = errorCode === "service_unavailable" && typeof candidate === "string" &&
        ["schema_missing", "column_missing", "database_missing", "auth_failed", "unreachable", "capacity"].includes(candidate)
        ? candidate : undefined;
      // Preserve only structured validator codes needed by existing controls.
      // Arbitrary server messages/metadata must not enter auth diagnostics.
      const object = parsedOk && parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
      const codes = (value: unknown) => Array.isArray(value)
        ? value.filter((code): code is string => typeof code === "string" && /^[a-z][a-z0-9_]{0,99}$/.test(code)).slice(0, 100) : [];
      const nestedIssues = errorValue && typeof errorValue === "object" ? codes((errorValue as {issues?: unknown}).issues) : [];
      const issues = codes(object?.issues);
      const blockers = Array.isArray(object?.blockers) ? object.blockers.filter((b): b is {kind: string; section: number} =>
        !!b && typeof b === "object" && ["transcript_missing", "transcript_review"].includes(b.kind) &&
        Number.isInteger(b.section) && b.section >= 1 && b.section <= 4).map(b => ({kind: b.kind, section: b.section})) : [];
      const data = nestedIssues.length ? {error: {issues: nestedIssues}}
        : blockers.length ? {error: errorCode, blockers}
        : issues.length ? {error: errorCode, issues} : null;
      return { ok: false, status: response.status, kind, error: errorCode, ...(reason ? { reason } : {}), ...(data ? {data} : {}) };
    }

    if (!parsedOk) {
      // 2xx that is not JSON: an empty body is legitimate for some callers, so an
      // empty response is treated as `null` data rather than a parse failure.
      if (raw.length === 0) return { ok: true, status: response.status, data: null as T };
      return { ok: false, status: response.status, kind: "parse", error: null };
    }

    return { ok: true, status: response.status, data: parsed as T };
  }
}

/**
 * Turns a failed result into the sentence the user reads.
 *
 * Order matters: a rate limit is worth its own wording (it tells the user to
 * wait) and an API error code the dictionary knows wins over a generic sentence.
 * Anything else falls back to the transport reason, never to silence.
 */
export function failureMessage(
  result: Extract<ApiResult<unknown>, { ok: false }>,
  messages: FailureMessages,
  known: Record<string, string> = {}
): string {
  if (result.status === 429 && messages.errorRateLimited) return messages.errorRateLimited;
  const fromApi = result.error ? known[result.error] : undefined;
  if (fromApi) return fromApi;
  if (result.kind === "network") return messages.errorNetwork;
  if (result.kind === "server") return messages.errorServer;
  if (result.kind === "parse") return messages.errorServer;
  return messages.errorUnknown ?? messages.errorServer;
}
