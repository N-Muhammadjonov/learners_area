import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { forwardToBackend } from "../src/lib/backend/proxy";

function setup(t: TestContext, fetcher: typeof fetch) {
  const original = globalThis.fetch;
  const saved = { origin: process.env.BACKEND_INTERNAL_URL, token: process.env.BACKEND_SERVICE_TOKEN, public: process.env.PUBLIC_BASE_URL };
  process.env.BACKEND_INTERNAL_URL = "http://127.0.0.1:8000";
  process.env.BACKEND_SERVICE_TOKEN = "test-only-service-token-32-characters-long";
  delete process.env.PUBLIC_BASE_URL;
  globalThis.fetch = fetcher;
  t.after(() => {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries({ BACKEND_INTERNAL_URL: saved.origin, BACKEND_SERVICE_TOKEN: saved.token, PUBLIC_BASE_URL: saved.public })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test("relay preserves browser URL, cookies and ranges, and replaces forged private headers", async t => {
  setup(t, async (url, options) => {
    assert.equal(String(url), "http://127.0.0.1:8000/api/resources/audio/key.mp3?download=1");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("cookie"), "la_session=learner-session");
    assert.equal(headers.get("range"), "bytes=7-9");
    assert.equal(headers.get("x-forwarded-host"), "preview.example");
    assert.equal(headers.get("x-forwarded-proto"), "https");
    assert.equal(headers.get("x-backend-service-token"), process.env.BACKEND_SERVICE_TOKEN);
    assert.equal(options?.redirect, "manual");
    return new Response(new Uint8Array([7, 8, 9]), { status: 206, headers: { "content-range": "bytes 7-9/20", "content-type": "audio/mpeg" } });
  });
  const result = await forwardToBackend(new Request("https://preview.example/api/resources/audio/key.mp3?download=1", {
    headers: { cookie: "la_session=learner-session", range: "bytes=7-9", "x-forwarded-host": "attacker.example", "x-backend-service-token": "forged" },
  }));
  assert.equal(result.status, 206);
  assert.equal(result.headers.get("content-range"), "bytes 7-9/20");
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [7, 8, 9]);
});

test("multipart and binary upload bytes stream unchanged", async t => {
  const bytes = new Uint8Array([0, 255, 128, 13, 10, 6]);
  setup(t, async (_url, options) => {
    assert.equal(options?.method, "POST");
    assert.equal(new Headers(options?.headers).get("content-type"), "multipart/form-data; boundary=la-test");
    assert.deepEqual(new Uint8Array(await new Response(options?.body).arrayBuffer()), bytes);
    return Response.json({ ok: true });
  });
  const response = await forwardToBackend(new Request("https://preview.example/api/uploads", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=la-test" }, body: bytes }));
  assert.deepEqual(await response.json(), { ok: true });
});

test("session clear and replacement cookies stay separate, including Partitioned", async t => {
  const cookies = ["la_session=; Max-Age=0; Path=/", "la_session=new; HttpOnly; Secure; SameSite=None; Partitioned; Path=/", "la_locale=uz; Path=/"];
  setup(t, async () => {
    const headers = new Headers({ location: "https://preview.example/app" });
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    return new Response(null, { status: 307, headers });
  });
  const response = await forwardToBackend(new Request("https://preview.example/api/auth/google/callback"));
  assert.equal(response.status, 307);
  assert.deepEqual(response.headers.getSetCookie(), cookies);
  assert.equal(response.headers.get("location"), "https://preview.example/app");
});

test("HEAD retains metadata and carries no body", async t => {
  setup(t, async () => new Response(null, { headers: { "content-type": "image/png", etag: "la-photo" } }));
  const response = await forwardToBackend(new Request("https://preview.example/api/profile/photo/id", { method: "HEAD" }));
  assert.equal(response.headers.get("etag"), "la-photo");
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test("implicit Next HEAD remains available for Python GET endpoints", async t => {
  const methods: string[] = [];
  setup(t, async (_url, options) => {
    methods.push(options?.method ?? "GET");
    return options?.method === "HEAD" ? new Response(null, { status: 405, headers: { allow: "GET" } }) : Response.json({ ok: true });
  });
  const response = await forwardToBackend(new Request("https://preview.example/api/version", { method: "HEAD" }));
  assert.equal(response.status, 200);
  assert.deepEqual(methods, ["HEAD", "GET"]);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test("backend outages return a fixed error and never execute a legacy handler", async t => {
  setup(t, async () => { throw new Error("private connection credentials must not escape"); });
  const response = await forwardToBackend(new Request("https://preview.example/api/auth/login", { method: "POST", body: "{}" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "service_unavailable", reason: "backend_unreachable" });
});

test("all 207 original method exports delegate directly to the Python transport", async () => {
  const manifest = JSON.parse(readFileSync("services/backend/contracts/next-routes.json", "utf8")) as { routes: { method: string; source: string }[] };
  assert.equal(manifest.routes.length, 207);
  for (const route of manifest.routes) {
    const loaded = await import(new URL(`../${route.source}`, import.meta.url).href);
    assert.equal(loaded[route.method], forwardToBackend, `${route.method} ${route.source}`);
  }
  const client = readFileSync("src/db/client.ts", "utf8");
  assert.doesNotMatch(client, /DATABASE_URL|new Pool|connectionString/);
});
