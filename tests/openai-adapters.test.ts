import test from "node:test";
import assert from "node:assert/strict";
import { openAiProvider } from "../src/lib/services/coach/providers/openai";
import { openAiSttProvider } from "../src/lib/services/coach/stt/openai";
import { SpeechToTextService } from "../src/lib/services/coach/stt";

const ctx = { userId: "PRIVATE-LOCAL-ID", language: "en" as const };
const input = { targetWord: "work", definition: "activity", studentSentence: "I work here." };
const output = { overallEstimate: null, confidence: 0.7, verdict: "correct", criteria: [], strengths: ["Clear"], weaknesses: [], issues: [], nextActions: [], recommendedExercises: [] };
async function configured(run: () => Promise<void>) {
  const saved = { ...process.env }; const fetcher = globalThis.fetch;
  process.env.OPENAI_API_KEY = "TEST-ONLY-SECRET"; process.env.OPENAI_EVALUATION_MODEL = "test-model";
  try { await run(); } finally { globalThis.fetch = fetcher; process.env = saved; }
}
test("OpenAI explicit configuration is required; no request on missing model", async () => configured(async () => {
  delete process.env.OPENAI_EVALUATION_MODEL;
  globalThis.fetch = async () => { throw new Error("must not call"); };
  const result = await openAiProvider.evaluateVocabulary!(ctx, input);
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.failure.reason, "not_configured");
}));
test("OpenAI Responses request excludes identity, disables response storage and validates JSON", async () => configured(async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const request = JSON.parse(String(init?.body));
    assert.equal(request.store, false); assert.ok(!String(init?.body).includes(ctx.userId));
    assert.equal(request.text.format.type, "json_object");
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  };
  const result = await openAiProvider.evaluateVocabulary!(ctx, input);
  assert.equal(result.ok, true);
}));
test("OpenAI refuses malformed and incomplete output instead of inventing feedback", async () => configured(async () => {
  for (const body of [{ status: "incomplete" }, { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"madeUp":true}' }] }] }]) {
    globalThis.fetch = async () => Response.json(body);
    const result = await openAiProvider.evaluateVocabulary!(ctx, input);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.failure.reason, "invalid_response");
  }
}));
test("OpenAI auth and quota failures do not expose provider error payloads", async () => configured(async () => {
  for (const status of [401, 429, 503]) {
    globalThis.fetch = async () => new Response("TEST-ONLY-SECRET provider internals", { status });
    const result = await openAiProvider.evaluateVocabulary!(ctx, input);
    assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes("TEST-ONLY-SECRET"));
  }
}));
test("OpenAI speaking never invents pronunciation or a missing transcript", async () => configured(async () => {
  globalThis.fetch = async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...output, criteria: [{ key: "pronunciation", label: "Pronunciation", band: 9 }] }) }] }] });
  const request = { part: "part1" as const, promptText: "Work?", transcript: "I work here", transcriptOrigin: "manual" as const, durationMs: null, pronunciationAvailable: true };
  const result = await openAiProvider.evaluateSpeaking!(ctx, request);
  assert.equal(result.ok, true); if (result.ok) assert.equal(result.output.criteria.find((c) => c.key === "pronunciation")?.band, null);
  assert.equal((await openAiProvider.evaluateSpeaking!(ctx, { ...request, transcript: null })).ok, false);
}));
test("Transcription cannot send audio when external services are disabled", async () => configured(async () => {
  process.env.STT_PRIMARY_PROVIDER = "openai"; process.env.AI_EXTERNAL_ENABLED = "false";
  globalThis.fetch = async () => { throw new Error("must not call"); };
  const result = await SpeechToTextService.transcribe({ objectKey: "audio/owned.webm", contentType: "audio/webm", durationMs: 1000, language: "en" });
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.failure.reason, "not_configured");
}));
test("OpenAI transcription fails closed before private storage access when not configured", async () => configured(async () => {
  delete process.env.OPENAI_STT_MODEL;
  assert.equal((await openAiSttProvider.transcribe({ objectKey: "../private", contentType: null, durationMs: null, language: "en" })).ok, false);
}));
