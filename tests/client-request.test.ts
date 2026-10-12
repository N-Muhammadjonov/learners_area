import { test } from "node:test";
import assert from "node:assert/strict";
import {
  failureMessage,
  requestJson,
  type ApiResult,
} from "../src/lib/http/client-request";

/**
 * The rule this file exists for: a failed request must come back as a *value*.
 *
 * The bug it guards against was reproduced in a browser before it was fixed. The
 * registration handler did `await fetch(...)` and then `await res.json()`, with
 * `setPending(false)` after both. When the API answered with the platform's HTML
 * error page — which is exactly what a production deployment does while its
 * database is unmigrated — `res.json()` threw, the handler never reached the
 * reset, and the button stayed on "Loading…" with no error and no way to retry.
 * A dropped connection did the same thing one line earlier.
 */

const MESSAGES = {
  errorNetwork: "network message",
  errorServer: "server message",
  errorRateLimited: "rate limited message",
  errorUnknown: "unknown message",
};

/** Replaces global fetch for one test and always restores it. */
async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body: string, status = 200, contentType = "application/json") {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

test("a successful JSON response is returned as data", async () => {
  const result = await withFetch(
    (async () => jsonResponse(JSON.stringify({ ok: true, accountStatus: "pending" }))) as typeof fetch,
    () => requestJson<{ accountStatus: string }>("/api/anything", { body: { a: 1 } })
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, 200);
    assert.equal(result.data.accountStatus, "pending");
  }
});

test("a dropped connection is a value, not an exception", async () => {
  const result = await withFetch(
    (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch,
    () => requestJson("/api/anything", { body: {} })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "network");
    assert.equal(result.status, 0, "no status code was received, so none is invented");
    assert.equal(failureMessage(result, MESSAGES), "network message");
  }
});

test("an HTML error page is classified as a server failure, not a crash", async () => {
  // This is the production shape: a 500 from the platform, HTML, not JSON.
  const result = await withFetch(
    (async () => jsonResponse("<html><body>Internal Server Error</body></html>", 500, "text/html")) as typeof fetch,
    () => requestJson("/api/auth/register", { body: {} })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "server");
    assert.equal(result.status, 500);
    assert.equal(result.error, null, "there is no API error code to read");
    assert.equal(failureMessage(result, MESSAGES), "server message");
  }
});

test("a JSON 500 keeps its status and its code", async () => {
  const result = await withFetch(
    (async () => jsonResponse(JSON.stringify({ error: "service_unavailable" }), 503)) as typeof fetch,
    () => requestJson("/api/auth/register", { body: {} })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 503);
    assert.equal(result.kind, "server");
    assert.equal(result.error, "service_unavailable");
  }
});

test("a 4xx carries the API's own error code to the caller", async () => {
  const result = await withFetch(
    (async () => jsonResponse(JSON.stringify({ error: "email_taken" }), 409)) as typeof fetch,
    () => requestJson("/api/auth/register", { body: {} })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "http");
    assert.equal(result.error, "email_taken");
  }
  assert.equal(failureMessage(result, MESSAGES, { email_taken: "taken message" }), "taken message");
});

test("a rate limit is recognised by status, whatever the body says", async () => {
  const result = await withFetch(
    (async () => jsonResponse(JSON.stringify({ error: "too_many_requests" }), 429)) as typeof fetch,
    () => requestJson("/api/auth/login", { body: {} })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(failureMessage(result, MESSAGES), "rate limited message");
});

test("an empty 2xx body is null data, not a parse failure", async () => {
  const result = await withFetch(
    (async () => new Response(null, { status: 204 })) as typeof fetch,
    () => requestJson("/api/anything")
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data, null);
});

test("a 2xx that is not JSON is reported honestly", async () => {
  const result = await withFetch(
    (async () => jsonResponse("<html>hello</html>", 200, "text/html")) as typeof fetch,
    () => requestJson("/api/anything")
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, "parse");
    assert.equal(failureMessage(result, MESSAGES), "server message");
  }
});

test("an aborted request is not reported as a connection problem", async () => {
  const result = await withFetch(
    (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch,
    () => requestJson("/api/anything", { signal: new AbortController().signal })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "aborted", "the aborting component knows why it aborted");
});

test("the same request never throws, whatever the transport does", async () => {
  const transports: (() => Promise<Response>)[] = [
    async () => jsonResponse("{}"),
    async () => jsonResponse("nonsense", 200, "text/html"),
    async () => jsonResponse("{}", 500),
    async () => new Response("", { status: 502 }),
    async () => {
      throw new Error("boom");
    },
    async () => new Response("[]", { status: 200 }),
  ];
  for (const transport of transports) {
    const result: ApiResult<unknown> = await withFetch(
      (async () => await transport()) as typeof fetch,
      () => requestJson("/api/anything")
    );
    assert.equal(typeof result.ok, "boolean", "a result is always returned");
  }
});

test("a form body is passed through with no content-type of our own", async () => {
  let seen: RequestInit | undefined;
  await withFetch(
    (async (_url: string, init: RequestInit) => {
      seen = init;
      return jsonResponse(JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch,
    () => requestJson("/api/uploads", { form: new FormData() })
  );
  assert.ok(seen);
  const headers = (seen.headers ?? {}) as Record<string, string>;
  assert.equal(headers["Content-Type"], undefined, "the browser must set the multipart boundary");
});

test("stalled headers time out without retrying a potentially committed write", async () => {
  let calls = 0;
  const result = await withFetch(async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  }, () => requestJson("/api/anything", { body: { write: true }, timeoutMs: 15 }));
  assert.deepEqual(result, { ok: false, status: 0, kind: "network", error: "timeout" });
  assert.equal(calls, 1);
});

test("deadline includes a stalled response body after successful headers", async () => {
  const result = await withFetch(async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'));
      init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
    },
  })), () => requestJson("/api/anything", { timeoutMs: 15 }));
  assert.deepEqual(result, { ok: false, status: 200, kind: "network", error: "timeout" });
});

test("a truncated successful response is never reported as an empty success", async () => {
  const result = await withFetch(async () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError("connection lost")); },
  })), () => requestJson("/api/anything"));
  assert.deepEqual(result, { ok: false, status: 200, kind: "network", error: "body_interrupted" });
});

test("caller cancellation interrupts body reading and is distinguished from timeout", async () => {
  const caller = new AbortController();
  const result = await withFetch(async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
      queueMicrotask(() => caller.abort(new Error("navigation")));
    },
  })), () => requestJson("/api/anything", { signal: caller.signal }));
  assert.deepEqual(result, { ok: false, status: 200, kind: "network", error: "aborted" });
});

test("already cancelled callers remain cancelled", async () => {
  const result = await withFetch(async (_url, init) => {
    init?.signal?.throwIfAborted();
    assert.fail("cancelled request must not continue");
  }, () => requestJson("/api/anything", { signal: AbortSignal.abort() }));
  assert.deepEqual(result, { ok: false, status: 0, kind: "network", error: "aborted" });
});

test("settled requests detach caller listener and cancel deadline", async (t) => {
  const caller = new AbortController();
  const remove = t.mock.method(caller.signal, "removeEventListener");
  let transportSignal: AbortSignal | null | undefined;
  await withFetch(async (_url, init) => {
    transportSignal = init?.signal;
    return jsonResponse("{}");
  }, () => requestJson("/api/anything", { signal: caller.signal, timeoutMs: 15 }));
  caller.abort();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(transportSignal?.aborted, false);
});


test("only fixed outage reasons survive; arbitrary server metadata never enters login diagnostics", async () => {
  for (const reason of ["schema_missing", "column_missing", "database_missing", "auth_failed", "unreachable", "capacity"]) {
    const result = await withFetch((async () => jsonResponse(JSON.stringify({ error: "service_unavailable", reason }), 503)) as typeof fetch, () => requestJson("/api/auth/login"));
    assert.ok(!result.ok);
    assert.equal(result.reason, reason);
  }
  const result = await withFetch((async () => jsonResponse(JSON.stringify({ error: "service_unavailable", reason: "password=private@host", message: "secret", query: "private SQL" }), 503)) as typeof fetch, () => requestJson("/api/auth/login"));
  assert.ok(!result.ok);
  assert.equal(result.reason, undefined);
  assert.doesNotMatch(JSON.stringify(result), /password|private|secret|SQL/);
});
