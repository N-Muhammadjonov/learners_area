// §6–8 (2026-10-03): the external-AI provider matrix. OpenAI and Anthropic have
// first-class adapters (their APIs differ: Responses / Messages). Gemini, DeepSeek,
// Qwen (Alibaba DashScope), Grok (xAI), Groq and Mistral each publish an endpoint that
// speaks the exact contract the compatible adapter needs:
//   POST {baseURL}/chat/completions, Authorization: Bearer, messages[system,user],
//   response_format {type: json_object}, max_tokens, stream false,
//   reply = choices[0].message.content with finish_reason "stop".
// These tests prove the adapter produces exactly that request for each vendor's
// documented base URL, validates the reply, and keeps every safety property. They do
// NOT prove a live call: no provider key exists in this environment (LIVE = NO).
// Grok (xAI, api.x.ai) and Groq (inference platform, api.groq.com) are DIFFERENT entries.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCompatibleProvider, parseCompatibleProviders, type CompatibleEntry } from "../src/lib/services/coach/providers/compatible";
import { instructions, writingCheckInstructions, writingGradeInstructions } from "../src/lib/services/coach/providers/shared/prompts";
import { PinnedHttpsError } from "../src/lib/services/coach/providers/shared/ssrf";

const PUBLIC = async () => [{ address: "93.184.216.34" }];
const output = {
  overallEstimate: null, confidence: 0.7, verdict: "mostly_correct",
  criteria: [{ key: "grammar", label: "Grammar", band: null, limited: false, note: null }],
  strengths: ["clear"], weaknesses: [], nextActions: [], issues: [], recommendedExercises: [],
};
const ctx = { userId: "11111111-2222-3333-4444-555555555555", language: "en" as const };
const grammarInput = { promptText: "Fix it", studentAnswer: "She go home", targetStructure: null, sampleAnswer: null };
const ok = (content: string, finish = "stop") => ({
  status: 200, contentType: "application/json",
  text: JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }] }),
});

/** Server-side configuration examples, one per vendor (models are placeholders the owner replaces). */
export const MATRIX: Array<CompatibleEntry & { vendor: string; host: string }> = [
  { vendor: "Google Gemini", id: "gemini", displayName: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", model: "owner-chosen-gemini-model", secretRef: "AI_GEMINI_API_KEY", host: "generativelanguage.googleapis.com" },
  { vendor: "DeepSeek", id: "deepseek", displayName: "DeepSeek", baseURL: "https://api.deepseek.com", model: "owner-chosen-deepseek-model", secretRef: "AI_DEEPSEEK_API_KEY", host: "api.deepseek.com" },
  { vendor: "Alibaba Qwen", id: "qwen", displayName: "Qwen", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "owner-chosen-qwen-model", secretRef: "AI_QWEN_API_KEY", host: "dashscope-intl.aliyuncs.com" },
  { vendor: "xAI Grok", id: "grok", displayName: "Grok", baseURL: "https://api.x.ai/v1", model: "owner-chosen-grok-model", secretRef: "AI_XAI_API_KEY", host: "api.x.ai" },
  { vendor: "Groq", id: "groq", displayName: "Groq", baseURL: "https://api.groq.com/openai/v1", model: "owner-chosen-groq-model", secretRef: "AI_GROQ_API_KEY", host: "api.groq.com" },
  { vendor: "Mistral", id: "mistral", displayName: "Mistral", baseURL: "https://api.mistral.ai/v1", model: "owner-chosen-mistral-model", secretRef: "AI_MISTRAL_API_KEY", host: "api.mistral.ai" },
];
const entries = MATRIX.map(({ vendor: _v, host: _h, ...e }) => ({ ...e, capabilities: ["writing-evaluation", "grammar-evaluation", "structured-output"] as CompatibleEntry["capabilities"] }));

async function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>) {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { await run(); } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("PM1 every named vendor's documented base URL passes the server-side config + SSRF guard; Grok and Groq are distinct", () => {
  const raw = JSON.stringify(entries);
  const allow = MATRIX.map((m) => m.host).join(",");
  const parsed = parseCompatibleProviders(raw, allow);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.entries.map((e) => e.id), ["gemini", "deepseek", "qwen", "grok", "groq", "mistral"]);
  const grok = parsed.entries.find((e) => e.id === "grok")!, groq = parsed.entries.find((e) => e.id === "groq")!;
  assert.notEqual(new URL(grok.baseURL).hostname, new URL(groq.baseURL).hostname, "Grok (xAI) != Groq");
  assert.notEqual(grok.secretRef, groq.secretRef);
  // Allowlist pins hosts: a Qwen entry pointed elsewhere is refused.
  const moved = parseCompatibleProviders(JSON.stringify([{ ...entries[2], baseURL: "https://evil.example.com/v1" }]), allow);
  assert.equal(moved.entries.length, 0);
});

for (const m of MATRIX) {
  test(`PM2 ${m.vendor}: exact chat-completions request, Bearer from the referenced env var, identity-free, validated reply`, async () => {
    const entry = entries.find((e) => e.id === m.id)!;
    await withEnv({ [m.secretRef]: `TEST-KEY-${m.id}` }, async () => {
      let seen: { url: string; headers: Record<string, string>; body: string; allowHosts?: readonly string[] } | null = null;
      const provider = createCompatibleProvider(entry, {
        lookup: PUBLIC,
        allowHosts: [m.host],
        request: async (url, headers, body, options) => {
          seen = { url: String(url), headers, body, allowHosts: options?.allowHosts };
          return ok(JSON.stringify(output));
        },
      });
      assert.equal(provider.type, "external");
      assert.equal(provider.model, entry.model);
      const result = await provider.evaluateGrammar!(ctx, grammarInput);
      assert.ok(result.ok, JSON.stringify(result));
      const s = seen as unknown as { url: string; headers: Record<string, string>; body: string; allowHosts?: readonly string[] };
      assert.equal(s.url, `${m.baseURL}/chat/completions`);
      assert.deepEqual(s.allowHosts, [m.host]);
      assert.equal(s.headers.Authorization, `Bearer TEST-KEY-${m.id}`);
      const body = JSON.parse(s.body);
      assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model", "response_format", "stream"]);
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.equal(body.stream, false);
      assert.equal(body.model, entry.model);
      assert.deepEqual(body.messages.map((x: { role: string }) => x.role), ["system", "user"]);
      // Qwen/DeepSeek reject json_object unless the messages contain the word "json".
      assert.match(body.messages[0].content, /json/i);
      const text = JSON.stringify(body);
      assert.ok(!text.includes(ctx.userId), "no account id is sent");
      assert.ok(!/email|telegram|phone/i.test(body.messages[1].content), "no identity fields are sent");
    });
  });
}

test("PM3 every shared system prompt contains the word JSON (DeepSeek/Qwen JSON-mode precondition)", () => {
  for (const p of [instructions, writingGradeInstructions("task1"), writingGradeInstructions("task2"), writingCheckInstructions("translation"), writingCheckInstructions("activation"), writingCheckInstructions("pattern")]) {
    assert.match(p, /\bJSON\b/);
  }
});

for (const id of ["qwen", "groq"] as const) {
  const entry = entries.find((e) => e.id === id)!;
  const host = MATRIX.find((vendor) => vendor.id === id)!.host;
  const secret = `TEST-SECRET-${id.toUpperCase()}-DO-NOT-LEAK`;

  test(`PM4 ${id}: pinned SSRF guard refuses private/metadata DNS answers and unsafe endpoint configurations`, async () => {
    await withEnv({ [entry.secretRef]: secret }, async () => {
      for (const address of ["10.0.0.7", "127.0.0.1", "169.254.169.254", "fd00::1", "::1"]) {
        const r = await createCompatibleProvider(entry, { lookup: async () => [{ address }] }).evaluateGrammar!(ctx, grammarInput);
        assert.ok(!r.ok, address);
        if (!r.ok) assert.equal(r.failure.reason, "provider_unavailable", `${address} is refused before connection`);
      }
      const r = await createCompatibleProvider(entry, { lookup: async () => { throw new Error("ENOTFOUND"); } }).evaluateGrammar!(ctx, grammarInput);
      assert.ok(!r.ok, "DNS failure blocks the call");
      for (const bad of ["http://api.groq.com/openai/v1", "https://localhost/v1", "https://169.254.169.254/v1", "https://dashscope-intl.aliyuncs.com:8443/compatible-mode/v1", "https://key@api.groq.com/openai/v1"]) {
        assert.equal(parseCompatibleProviders(JSON.stringify([{ ...entry, baseURL: bad }])).entries.length, 0, bad);
      }
    });
  });

  test(`PM5 ${id}: malformed, truncated, refused and HTTP-error replies fail validation without leaking the body or the key`, async () => {
    await withEnv({ [entry.secretRef]: secret }, async () => {
      const contentType = "application/json";
      const refused = { status: 200, contentType, text: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }] }) };
      const cases = [
        ok("not json"),
        ok(JSON.stringify({ overallEstimate: 99 })),
        ok(JSON.stringify(output), "length"),
        refused,
        { status: 200, contentType, text: JSON.stringify({ choices: [] }) },
        { status: 500, contentType: "text/plain", text: `upstream internals ${secret}` },
        { status: 401, contentType: "text/plain", text: `bad key ${secret}` },
        { status: 429, contentType: "text/plain", text: "slow down" },
      ];
      let reply = cases[0]!;
      const provider = createCompatibleProvider(entry, {
        allowHosts: [host],
        request: async () => reply,
      });
      for (const next of cases) {
        reply = next;
        const r = await provider.evaluateGrammar!(ctx, grammarInput);
        assert.ok(!r.ok);
        const dump = JSON.stringify(r);
        assert.ok(!dump.includes(secret) && !dump.includes("internals") && !dump.includes("bad key"), dump);
      }
    });
  });

  test(`PM6 ${id}: the call honours abort and returns without leaving a pending transport`, async () => {
    await withEnv({ [entry.secretRef]: secret }, async () => {
      const provider = createCompatibleProvider(entry, {
        allowHosts: [host],
        request: async (_url, _headers, _body, options) => new Promise((_resolve, reject) => {
          const signal = options?.signal;
          const abort = () => reject(new PinnedHttpsError("aborted"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        }),
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 50); // ref'd, unlike AbortSignal.timeout
      const started = Date.now();
      try {
        const r = await provider.evaluateGrammar!({ ...ctx, signal: controller.signal }, grammarInput);
        assert.ok(!r.ok);
        assert.ok(Date.now() - started < 5_000, "returns at the abort deadline, not later");
      } finally { clearTimeout(timer); }
    });
  });

  test(`PM7 ${id}: a missing key or model means not_configured and zero request seam calls`, async () => {
    await withEnv({ [entry.secretRef]: undefined }, async () => {
      let calls = 0;
      const provider = createCompatibleProvider(entry, {
        allowHosts: [host],
        request: async () => { calls += 1; return ok("{}"); },
      });
      const r = await provider.evaluateGrammar!(ctx, grammarInput);
      assert.ok(!r.ok && r.failure.reason === "not_configured");
      assert.equal(calls, 0);
    });
  });
}

test("PM8 configuration refuses a key pasted in place of an env-var NAME, and never echoes it", () => {
  const leaked = "gsk_live_should_never_be_echoed_1234567890";
  const r = parseCompatibleProviders(JSON.stringify([{ ...entries[4], secretRef: leaked }]));
  assert.equal(r.entries.length, 0);
  assert.ok(!JSON.stringify(r.issues).includes(leaked));
});

test("PM9 .env.example documents every matrix vendor with an empty key and no real secret", () => {
  const example = readFileSync(".env.example", "utf8");
  for (const m of MATRIX) {
    assert.ok(example.includes(m.host), `${m.vendor} base URL example`);
    assert.match(example, new RegExp(`^# ?${m.secretRef}=$`, "m"), `${m.vendor} key placeholder is empty`);
  }
  assert.ok(!/(sk-|gsk_|xai-)[A-Za-z0-9]{12,}/.test(example), "no real-looking key");
});

test("PM10 bounded retry applies to compatible providers: retryable 5xx stops at maxAttempts and auth failures are not retried", async () => {
  const secretRef = "AI_QWEN_API_KEY";
  const host = "api.qwen-test.example";
  const providers = JSON.stringify([{ id: "qwen", displayName: "Qwen", baseURL: `https://${host}/compatible-mode/v1`, model: "owner-chosen-qwen-model", secretRef, capabilities: ["grammar-evaluation", "structured-output"] }]);
  await withEnv({ AI_COMPATIBLE_PROVIDERS: providers, AI_COMPATIBLE_ALLOWED_HOSTS: host, [secretRef]: "TEST-KEY" }, async () => {
    const [{ resolveEvaluation }, { providerRegistry }] = await Promise.all([
      import("../src/lib/services/coach/resolver"),
      import("../src/lib/services/coach/registry"),
    ]);
    const configured = parseCompatibleProviders(providers, host).entries[0];
    const original = providerRegistry.get("qwen");
    assert.ok(configured && original, "server config should register the compatible provider");
    let mode: "down" | "recover" | "unauthorized" = "down";
    let calls = 0;
    const provider = createCompatibleProvider(configured, {
      allowHosts: [host],
      request: async () => {
        calls += 1;
        if (mode === "unauthorized") return { status: 401, contentType: "text/plain", text: "no" };
        if (mode === "recover" && calls === 2) return ok(JSON.stringify(output));
        return { status: 503, contentType: "text/plain", text: "down" };
      },
    });
    providerRegistry.register(provider);
    try {
      const request = { evaluationType: "grammar", input: grammarInput } as Parameters<typeof resolveEvaluation>[0];
      const strict = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "qwen", maxAttempts: 3, retryBackoffMs: 0 }, { fallback: "none" });
      assert.equal(calls, 3, "exactly maxAttempts for retryable 5xx");
      assert.ok(!strict.ok, "strict policy: no substitute result");

      mode = "recover";
      calls = 0;
      const recovered = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "qwen", maxAttempts: 2, retryBackoffMs: 0 }, { fallback: "none" });
      assert.ok(recovered.ok);
      if (!recovered.ok) return;
      assert.equal(calls, 2);
      assert.equal(recovered.result.providerId, "qwen");
      assert.equal(recovered.result.providerType, "external");
      assert.equal(recovered.result.model, "owner-chosen-qwen-model");
      assert.equal(recovered.result.fallbackUsed, false);

      mode = "unauthorized";
      calls = 0;
      await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "qwen", maxAttempts: 3, retryBackoffMs: 0 }, { fallback: "none" });
      assert.equal(calls, 1, "auth failure is not retried");
    } finally {
      providerRegistry.register(original.provider);
    }
  });
});
