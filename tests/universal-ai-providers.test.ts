// Universal external AI (owner override 2026-10-03): stable interface, first-class
// adapters for differing APIs, a generic chat-completions adapter for genuinely
// compatible endpoints, SSRF/secret safety, and a server-enforced owner switch.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertPublicHost, checkProviderBaseUrl, isPrivateAddress } from "../src/lib/services/coach/providers/shared/ssrf";
import { createCompatibleProvider, parseCompatibleProviders } from "../src/lib/services/coach/providers/compatible";
import { anthropicProvider } from "../src/lib/services/coach/providers/anthropic";
import { AI_CONTROL_ACTION, combineControl, ownerAiStatus, readOwnerAiControl, type OwnerAiControl } from "../src/lib/services/coach/owner-control";
import { readCoachConfig } from "../src/lib/services/coach/config";
import { runWritingCheck } from "../src/lib/services/writing/check";
import { writingAiReady } from "../src/lib/writing/ai-readiness";
import { speakingAiReadiness } from "../src/lib/speaking/ai-readiness";
import { createTestDatabase, type TestDatabase } from "./support/pglite";

const validOutput = {
  overallEstimate: null, confidence: 0.7, verdict: "mostly_correct",
  criteria: [{ key: "grammar", label: "Grammar", band: 6, limited: false, note: null }],
  strengths: ["clear"], weaknesses: [], nextActions: [], issues: [], recommendedExercises: [],
};
const ctx = { userId: "11111111-2222-3333-4444-555555555555", language: "en" as const };
const grammarInput = { promptText: "Fix it", studentAnswer: "She go home", targetStructure: null, sampleAnswer: null };

async function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>) {
  const saved = { ...process.env };
  const fetcher = globalThis.fetch;
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try { await run(); } finally { globalThis.fetch = fetcher; process.env = saved; }
}

// ---------------------------------------------------------------------------
// SSRF
// ---------------------------------------------------------------------------
test("UA1 static URL guard: https public hosts only; internal, private, credentialed and odd-port URLs refused", () => {
  assert.equal(checkProviderBaseUrl("https://api.example.com/v1").ok, true);
  for (const bad of [
    "http://api.example.com/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.1.2.3/v1",
    "https://169.254.169.254/latest", "https://[::1]/v1", "https://[fd00::1]/v1", "https://user:pw@api.example.com/v1",
    "https://api.example.com:8443/v1", "https://metadata.google.internal/", "https://intranet/v1", "https://svc.local/v1",
    "https://192.168.1.10/v1", "https://100.64.0.1/v1", "https://api.example.com/v1?key=x", "file:///etc/passwd", "not a url",
  ]) assert.equal(checkProviderBaseUrl(bad).ok, false, bad);
  assert.equal(checkProviderBaseUrl("https://api.example.com/v1", ["other.example.com"]).ok, false, "allowlist enforced");
  assert.equal(checkProviderBaseUrl("https://api.example.com/v1", ["api.example.com"]).ok, true);
  assert.ok(isPrivateAddress("::ffff:127.0.0.1"));
  assert.ok(!isPrivateAddress("93.184.216.34"));
});

test("UA2 runtime DNS guard: any private resolution (or a lookup error) blocks the call", async () => {
  assert.equal(await assertPublicHost("api.example.com", async () => [{ address: "93.184.216.34" }]), true);
  assert.equal(await assertPublicHost("api.example.com", async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }]), false);
  assert.equal(await assertPublicHost("api.example.com", async () => [{ address: "169.254.169.254" }]), false);
  assert.equal(await assertPublicHost("api.example.com", async () => { throw new Error("ENOTFOUND"); }), false);
  assert.equal(await assertPublicHost("api.example.com", async () => []), false);
});

// ---------------------------------------------------------------------------
// Server-side compatible configuration
// ---------------------------------------------------------------------------
test("UA3 compatible config: env-var secret references only, reserved ids, duplicates and unsafe URLs refused without echoing values", () => {
  const good = { id: "acme", displayName: "Acme AI", baseURL: "https://api.acme.example/v1/", model: "acme-l", secretRef: "AI_ACME_API_KEY" };
  const raw = JSON.stringify([
    good,
    { ...good, id: "acme" },
    { ...good, id: "keyed", secretRef: "sk-live-THIS-IS-A-KEY" },
    { ...good, id: "riwi" },
    { ...good, id: "inside", baseURL: "https://10.0.0.8/v1" },
    { ...good, id: "extra", apiKey: "sk-should-not-be-here" },
  ]);
  const { entries, issues } = parseCompatibleProviders(raw);
  assert.deepEqual(entries.map((e) => e.id), ["acme"]);
  assert.equal(entries[0]!.baseURL, "https://api.acme.example/v1", "trailing slash normalised");
  assert.equal(issues.length, 5);
  const text = JSON.stringify(issues);
  for (const leak of ["sk-live-THIS-IS-A-KEY", "sk-should-not-be-here", "10.0.0.8"]) assert.ok(!text.includes(leak), `issue echoes ${leak}`);
  assert.equal(parseCompatibleProviders("{not json").issues.length, 1);
  assert.deepEqual(parseCompatibleProviders(undefined), { entries: [], issues: [] });
});

test("UA4 compatible transport: POST {base}/chat/completions with Bearer from the referenced env var, no redirects, identity-free, validated", async () => {
  await withEnv({ AI_ACME_API_KEY: "test-acme-key" }, async () => {
    const entry = parseCompatibleProviders(JSON.stringify([{ id: "acme", displayName: "Acme AI", baseURL: "https://api.acme.example/v1", model: "acme-l", secretRef: "AI_ACME_API_KEY" }])).entries[0]!;
    const provider = createCompatibleProvider(entry, { lookup: async () => [{ address: "93.184.216.34" }] });
    let seen: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seen = { url: String(url), init: init! };
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validOutput) } }] });
    }) as typeof fetch;
    const result = await provider.evaluateGrammar!(ctx, grammarInput);
    assert.equal(result.ok, true);
    assert.equal(seen!.url, "https://api.acme.example/v1/chat/completions");
    assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer test-acme-key");
    assert.equal(seen!.init.redirect, "error");
    const body = JSON.parse(String(seen!.init.body));
    assert.equal(body.model, "acme-l");
    assert.ok(!String(seen!.init.body).includes(ctx.userId), "no user identity in the payload");
    assert.equal(provider.type, "external");

    // Truncated / refused / malformed output is never accepted.
    for (const reply of [
      { choices: [{ finish_reason: "length", message: { content: "{" } }] },
      { choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }] },
      { choices: [{ finish_reason: "stop", message: { content: "{\"overallEstimate\": \"nine\"}" } }] },
    ]) {
      globalThis.fetch = (async () => Response.json(reply)) as typeof fetch;
      assert.equal((await provider.evaluateGrammar!(ctx, grammarInput)).ok, false);
    }
    // Provider error bodies never surface.
    globalThis.fetch = (async () => new Response("TEST-ONLY-SECRET internals", { status: 401 })) as typeof fetch;
    const denied = await provider.evaluateGrammar!(ctx, grammarInput);
    assert.equal(denied.ok, false);
    assert.ok(!JSON.stringify(denied).includes("TEST-ONLY-SECRET"));
    if (!denied.ok) assert.equal(denied.failure.reason, "auth_failed");
  });
});

test("UA5 compatible transport refuses to call a host that resolves privately (DNS rebinding guard)", async () => {
  await withEnv({ AI_ACME_API_KEY: "k" }, async () => {
    const entry = parseCompatibleProviders(JSON.stringify([{ id: "acme", displayName: "Acme", baseURL: "https://api.acme.example/v1", model: "m", secretRef: "AI_ACME_API_KEY" }])).entries[0]!;
    const provider = createCompatibleProvider(entry, { lookup: async () => [{ address: "127.0.0.1" }] });
    globalThis.fetch = (async () => { throw new Error("must not call"); }) as typeof fetch;
    const result = await provider.evaluateGrammar!(ctx, grammarInput);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.reason, "provider_unavailable");
  });
});

test("UA6 first-class Anthropic adapter uses its own API shape and fails closed without configuration", async () => {
  await withEnv({ ANTHROPIC_API_KEY: undefined, ANTHROPIC_EVALUATION_MODEL: undefined }, async () => {
    globalThis.fetch = (async () => { throw new Error("must not call"); }) as typeof fetch;
    const r = await anthropicProvider.evaluateGrammar!(ctx, grammarInput);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.failure.reason, "not_configured");
  });
  await withEnv({ ANTHROPIC_API_KEY: "test-anthropic", ANTHROPIC_EVALUATION_MODEL: "claude-test" }, async () => {
    let init: RequestInit | undefined;
    let url = "";
    globalThis.fetch = (async (u: string | URL, i?: RequestInit) => {
      url = String(u); init = i;
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(validOutput) }] });
    }) as typeof fetch;
    const r = await anthropicProvider.evaluateGrammar!(ctx, grammarInput);
    assert.equal(r.ok, true);
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const headers = init!.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "test-anthropic");
    assert.ok(headers["anthropic-version"]);
    const body = JSON.parse(String(init!.body));
    assert.equal(typeof body.system, "string");
    assert.equal(body.messages[0].role, "user");
    assert.ok(!String(init!.body).includes(ctx.userId));
    globalThis.fetch = (async () => new Response("x", { status: 429 })) as typeof fetch;
    const limited = await anthropicProvider.evaluateGrammar!(ctx, grammarInput);
    if (!limited.ok) assert.equal(limited.failure.reason, "rate_limited"); else assert.fail("must fail");
  });
});

// ---------------------------------------------------------------------------
// Owner master switch
// ---------------------------------------------------------------------------
const owner = (o: Partial<OwnerAiControl>): OwnerAiControl => ({ externalEnabled: true, providerId: null, model: null, fallback: "riwi", updatedAt: null, updatedBy: null, source: "owner", ...o });

test("UA7 effective config = deployment ceiling AND owner switch; owner picks registered providers only", () => {
  const env = { ...readCoachConfig(), externalEnabled: true, aiPrimaryProvider: "openai" };
  const registered = (id: string) => ["riwi", "openai", "anthropic"].includes(id);
  assert.equal(combineControl({ ...env, externalEnabled: false }, owner({ externalEnabled: true }), registered).externalEnabled, false, "ceiling wins");
  assert.equal(combineControl(env, owner({ externalEnabled: false }), registered).externalEnabled, false, "owner off wins");
  assert.equal(combineControl(env, owner({ providerId: "anthropic" }), registered).aiPrimaryProvider, "anthropic");
  assert.equal(combineControl(env, owner({ providerId: "ghost" }), registered).aiPrimaryProvider, "openai", "unregistered choice ignored");
  assert.equal(combineControl(env, owner({ providerId: "riwi" }), registered).aiPrimaryProvider, "riwi");
});

let database: TestDatabase;
before(async () => { database = await createTestDatabase(); });
after(async () => { await database.close(); });

test("UA8 the switch is read from the audit trail: default, latest wins, malformed or unreadable → OFF (fail-closed)", async () => {
  assert.equal((await readOwnerAiControl(database.db)).source, "default");
  await database.query(`insert into audit_log (action, target_type, target_id, metadata, created_at) values ($1, 'ai_control', 'global', $2::jsonb, now() - interval '1 minute')`, [AI_CONTROL_ACTION, JSON.stringify({ externalEnabled: true, providerId: "anthropic" })]);
  await database.query(`insert into audit_log (action, target_type, target_id, metadata) values ($1, 'ai_control', 'global', $2::jsonb)`, [AI_CONTROL_ACTION, JSON.stringify({ externalEnabled: false, providerId: null })]);
  const latest = await readOwnerAiControl(database.db);
  assert.equal(latest.externalEnabled, false);
  assert.equal(latest.source, "owner");
  await database.query(`insert into audit_log (action, metadata) values ($1, $2::jsonb)`, [AI_CONTROL_ACTION, JSON.stringify({ externalEnabled: "yes" })]);
  const malformed = await readOwnerAiControl(database.db);
  assert.equal(malformed.externalEnabled, false);
  assert.equal(malformed.source, "unavailable");
  const broken = { select: () => { throw new Error("db down"); } } as unknown as Parameters<typeof readOwnerAiControl>[0];
  const unreadable = await readOwnerAiControl(broken);
  assert.equal(unreadable.externalEnabled, false);
  assert.equal(unreadable.source, "unavailable");
});

test("UA9 enforcement: a Writing check passes the owner's OFF to the resolver, and readiness reports unavailable", async () => {
  let overrides: unknown = null;
  const fakeResolve = (async (_req: unknown, _ctx: unknown, o: unknown) => { overrides = o; return { ok: false, error: "external_required", attempts: [] }; }) as unknown as Parameters<typeof runWritingCheck>[3] extends infer D ? D extends { resolve?: infer R } ? R : never : never;
  const check = { kind: "pattern" as const, pattern: "p", sourceExample: "s", sourceTopic: "a", newTopic: "b", answer: "x y z" };
  const out = await runWritingCheck("u", "en", check, { resolve: fakeResolve, control: async () => ({ externalEnabled: false, aiPrimaryProvider: "openai" }) });
  assert.equal(out.ok, false);
  assert.deepEqual(overrides, { externalEnabled: false, aiPrimaryProvider: "openai", modelOverride: null });
  const off = async () => ({ ...readCoachConfig(), externalEnabled: false, aiPrimaryProvider: "openai" });
  assert.equal(await writingAiReady(({ OPENAI_API_KEY: "k", OPENAI_EVALUATION_MODEL: "m" } as unknown as NodeJS.ProcessEnv), off), false);
  const speaking = await speakingAiReadiness(({ OPENAI_API_KEY: "k", OPENAI_EVALUATION_MODEL: "m" } as unknown as NodeJS.ProcessEnv), off);
  assert.equal(speaking.aiEvaluation, false);
  assert.equal(speaking.transcription, false, "transcription is external too");
});

test("UA10 owner status carries no secret values, keys or endpoint URLs", async () => {
  await withEnv({ OPENAI_API_KEY: "TEST-SECRET-VALUE-123", OPENAI_EVALUATION_MODEL: "m", AI_COMPATIBLE_PROVIDERS: JSON.stringify([{ id: "acme", displayName: "Acme", baseURL: "https://10.0.0.9/v1", model: "m", secretRef: "AI_ACME_API_KEY" }]) }, async () => {
    const status = await ownerAiStatus(process.env, database.db);
    const json = JSON.stringify(status);
    assert.ok(!json.includes("TEST-SECRET-VALUE-123"));
    assert.ok(!json.includes("10.0.0.9"), "refused endpoint is not echoed");
    const openai = status.providers.find((p) => p.id === "openai")!;
    assert.equal(openai.secretsPresent, true);
    assert.ok(status.providers.some((p) => p.id === "riwi" && p.type === "internal"));
  });
});

test("UA11 owner route: OWNER-only on GET and POST; the request schema accepts no URL, key or endpoint", () => {
  const src = readFileSync("src/app/api/owner/ai-control/route.ts", "utf8");
  assert.equal((src.match(/await requireOwner\(\)/g) ?? []).length, 2);
  assert.match(src, /\.strict\(\)/);
  assert.doesNotMatch(src.slice(src.indexOf("const schema"), src.indexOf("export async function GET")), /url|baseURL|key|secret|endpoint/i);
  for (const entry of ["src/lib/services/coach/service.ts", "src/lib/services/writing/check.ts", "src/lib/writing/ai-readiness.ts", "src/lib/speaking/ai-readiness.ts"]) {
    assert.match(readFileSync(entry, "utf8"), /effectiveCoachConfig/, `${entry} must enforce the owner switch`);
  }
});

// ---------------------------------------------------------------------------
// Owner model + fallback policy (continuation 2026-10-03)
// ---------------------------------------------------------------------------
import { MODEL_ID, setOwnerAiControl, AiControlError } from "../src/lib/services/coach/owner-control";
import { resolveEvaluation } from "../src/lib/services/coach/resolver";

test("UA12 owner model override reaches the provider call and is recorded truthfully in internal provenance", async () => {
  await withEnv({ OPENAI_API_KEY: "k", OPENAI_EVALUATION_MODEL: "env-default-model" }, async () => {
    let sentModel = "";
    globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
      sentModel = JSON.parse(String(init!.body)).model;
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validOutput) }] }] });
    }) as typeof fetch;
    const out = await resolveEvaluation({ evaluationType: "grammar", input: grammarInput } as Parameters<typeof resolveEvaluation>[0], ctx,
      { externalEnabled: true, aiPrimaryProvider: "openai", modelOverride: "owner-chosen-model" }, { fallback: "none" });
    assert.ok(out.ok, JSON.stringify(out.ok ? "" : out));
    if (!out.ok) return;
    assert.equal(sentModel, "owner-chosen-model");
    assert.equal(out.result.providerId, "openai");
    assert.equal(out.result.model, "owner-chosen-model", "provenance records the model actually used");
    assert.equal(out.result.fallbackUsed, false);
  });
});

test("UA13 a model is an identifier, never an endpoint; legacy switch rows default safely; strict policy means no fallback", async () => {
  const [actor] = await database.query<{ id: string }>(`insert into users (email, name, role, account_status) values ('ua13-owner@example.test', 'Owner', 'owner', 'active') returning id`);
  const uid = actor!.id;
  for (const ok of ["gpt-4.1-mini", "claude-sonnet-4-5", "models/gemini-2.5-pro", "deepseek-chat", "mistral-large-latest", "grok-4"]) assert.ok(MODEL_ID.test(ok), ok);
  for (const bad of ["https://evil.example/v1", "http://10.0.0.1", "a b", "", "x".repeat(101), "../etc", "-flag"]) assert.ok(!MODEL_ID.test(bad), bad);
  await assert.rejects(setOwnerAiControl(uid, { externalEnabled: true, providerId: "openai", model: "https://evil.example" }, database.db), (e: unknown) => e instanceof AiControlError && e.code === "invalid_model");
  await assert.rejects(setOwnerAiControl(uid, { externalEnabled: true, providerId: "riwi", model: "m" }, database.db), (e: unknown) => e instanceof AiControlError && e.code === "invalid_model");
  // A legacy row written before model/fallback existed is still an OWNER row with defaults.
  await database.query(`insert into audit_log (action, metadata) values ($1, $2::jsonb)`, [AI_CONTROL_ACTION, JSON.stringify({ externalEnabled: true, providerId: "openai" })]);
  const legacy = await readOwnerAiControl(database.db);
  assert.equal(legacy.source, "owner");
  assert.equal(legacy.model, null);
  assert.equal(legacy.fallback, "riwi");
  await setOwnerAiControl(uid, { externalEnabled: true, providerId: "openai", model: "owner-model", fallback: "none" }, database.db);
  const strict = await readOwnerAiControl(database.db);
  assert.equal(strict.fallback, "none");
  const env = { ...readCoachConfig(), externalEnabled: true, aiPrimaryProvider: "riwi" };
  const eff = combineControl(env, strict, (id) => ["openai", "riwi"].includes(id));
  assert.equal(eff.modelOverride, "owner-model");
  assert.equal(eff.ownerFallback, "none");
  // Model override never leaks onto a provider the owner did not select.
  assert.equal(combineControl(env, { ...strict, providerId: "ghost" }, (id) => id === "riwi").modelOverride, null);
  // Failure under strict policy: external fails → no RIWI substitute.
  await withEnv({ OPENAI_API_KEY: "k", OPENAI_EVALUATION_MODEL: "m" }, async () => {
    globalThis.fetch = (async () => new Response("x", { status: 500 })) as typeof fetch;
    const out = await resolveEvaluation({ evaluationType: "grammar", input: grammarInput } as Parameters<typeof resolveEvaluation>[0], ctx,
      { externalEnabled: true, aiPrimaryProvider: "openai", maxAttempts: 1 }, { fallback: "none" });
    assert.equal(out.ok, false);
  });
  const svc = readFileSync("src/lib/services/coach/service.ts", "utf8");
  assert.match(svc, /params\.policy\?\.fallback === "none" \|\| control\.ownerFallback === "none"/, "stricter policy wins");
});
