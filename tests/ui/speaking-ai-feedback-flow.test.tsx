import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import en from "../../src/lib/i18n/en";

const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event"] as const) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
class Media extends dom.window.EventTarget {
  static isTypeSupported() { return true; } state = "inactive"; mimeType = "audio/webm";
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; const event = new dom.window.Event("dataavailable"); Object.defineProperty(event, "data", { value: new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3]), "voice bytes"]) }); this.dispatchEvent(event); this.dispatchEvent(new dom.window.Event("stop")); }
}
class Speech {
  lang = ""; continuous = false; interimResults = false;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
  onend: (() => void) | null = null; onerror: ((event: { error?: string }) => void) | null = null;
  start() { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "I enjoy learning languages with friends." } }] }); }
  stop() { this.onend?.(); } abort() {}
}
class Xhr extends dom.window.EventTarget {
  upload = new dom.window.EventTarget(); status = 200; timeout = 0; responseText = "";
  open() {} setRequestHeader() {} send() { queueMicrotask(() => this.dispatchEvent(new dom.window.Event("load"))); } abort() { this.dispatchEvent(new dom.window.Event("abort")); }
}
window.MediaRecorder = Media as unknown as typeof MediaRecorder;
Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Media });
window.SpeechRecognition = Speech;
Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: Xhr });
Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
URL.createObjectURL = () => "blob:recording"; URL.revokeObjectURL = () => {};

function button(label: string) { return [...document.querySelectorAll("button")].find(el => el.textContent === label)!; }

test("explicit Send preserves feedback in the session, deduplicates clicks, and Next completes the same item", async () => {
  const { AiExaminerSession } = await import("../../src/components/speaking/AiExaminerSession");
  const session = { id: "session", mode: "part1", status: "active", currentItemIndex: 0, limitations: [] };
  const prompt = { id: "prompt", part: "part1", topic: "Study", answerSeconds: 45, promptText: "What do you enjoy learning?", cueCard: null };
  const item = { id: "item", ordinal: 1, topicKey: "study", topicPosition: 1, questionPosition: 1, status: "pending", attemptId: null, prompt };
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url, options) => {
    const path = String(url); const body = options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : {};
    calls.push({ url: path, body });
    if (path === "/api/speaking/ai/sessions") return Response.json({ session, items: [item] });
    if (path === "/api/live-partner") return Response.json({ ok: true });
    if (path === "/api/speaking/attempts") return Response.json({ attempt: { id: "attempt" } });
    if (path === "/api/uploads/intent") return Response.json({ uploadId: "upload", objectKey: "private/recording", mode: "direct", uploadUrl: "https://upload.test.invalid", contentType: "audio/webm" });
    if (path === "/api/uploads/finalize" || path === "/api/speaking/attempts/attempt") return Response.json({ ok: true });
    if (path === "/api/speaking/attempts/attempt/submit") return Response.json({ evaluated: true, evaluation: { id: "evaluation", checkedBy: "RIWI", fallbackUsed: false, overallEstimate: null, criteria: [], strengths: ["Your answer explains a clear interest."], weaknesses: [], issues: [], nextActions: [] } });
    if (path.endsWith("/items/item/complete")) return Response.json({ ok: true });
    if (path.endsWith("/session/complete")) return Response.json({ summary: { answered: 1, skipped: 0, evaluated: 1, unevaluated: 0, completeEvidence: true, totalDurationMs: 1, textBasedEstimate: null, criteria: [], strengths: [], weaknesses: [], recurringWeaknesses: [] } });
    assert.fail(`Unexpected request ${path}`);
  }) as typeof fetch;
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(<AiExaminerSession dict={en} prompts={[]} readiness={{ aiEvaluation: false } as React.ComponentProps<typeof AiExaminerSession>["readiness"]} isStaff={false} />));
    await act(async () => button(en.speakingAi.startAnswer).click());
    await act(async () => button(en.speakingAi.stop).click());
    assert.equal(document.querySelector("textarea")!.value, "I enjoy learning languages with friends.");
    assert.equal(calls.filter(call => call.url.includes("/uploads/") || call.url.endsWith("/submit")).length, 0);
    await act(async () => { const send = button(en.speakingAi.sendToRiwi); send.click(); send.click(); });
    const submits = calls.filter(call => call.url.endsWith("/submit"));
    assert.equal(submits.length, 1); assert.equal(calls.filter(call => call.url === "/api/uploads/intent").length, 1);
    assert.equal(submits[0]!.body.browserTranscriptRaw, "I enjoy learning languages with friends.");
    assert.equal(submits[0]!.body.browserTranscript, submits[0]!.body.browserTranscriptRaw);
    assert.ok(document.querySelector("[data-ai-feedback]"), "receiving an attempt id must not remount and erase feedback");
    assert.ok(document.body.textContent!.includes("Your answer explains a clear interest."));
    await act(async () => button(en.speakingAi.next).click());
    assert.deepEqual(calls.find(call => call.url.endsWith("/items/item/complete"))!.body, { action: "answered", attemptId: "attempt" });
    assert.ok(document.querySelector("[data-ai-finished]"));
  } finally { await act(async () => root.unmount()); }
});

test("unmount during explicit Send ignores a late evaluation and never advances the detached session", async () => {
 const { AiQuestionRecorder } = await import("../../src/components/speaking/AiQuestionRecorder");
 let resolve!: (response:Response)=>void;let evaluated=0;let submitCount=0;
 globalThis.fetch=(async(url)=>{
  const path=String(url);
  if(path==='/api/live-partner')return Response.json({ok:true});
  if(path==='/api/speaking/attempts')return Response.json({attempt:{id:'attempt'}});
  if(path==='/api/uploads/intent')return Response.json({uploadId:'upload',objectKey:'private/recording',mode:'direct',uploadUrl:'https://upload.test.invalid',contentType:'audio/webm'});
  if(path==='/api/uploads/finalize'||path==='/api/speaking/attempts/attempt')return Response.json({ok:true});
  if(path.endsWith('/submit')){submitCount++;return new Promise<Response>(done=>{resolve=done;});}
  assert.fail(path);
 }) as typeof fetch;
 const root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(<AiQuestionRecorder dict={en} prompt={{id:'prompt',part:'part1',answerSeconds:45,promptText:'Question',cueCard:null} as React.ComponentProps<typeof AiQuestionRecorder>['prompt']} sessionId='session' itemId='item' index={1} onEvaluated={()=>evaluated++} onNext={()=>assert.fail('detached Next')} />));
  await act(async()=>button(en.speakingAi.startAnswer).click());await act(async()=>button(en.speakingAi.stop).click());
  await act(async()=>button(en.speakingAi.sendToRiwi).click());assert.equal(submitCount,1);
  await act(async()=>root.unmount());await act(async()=>resolve(Response.json({evaluation:{id:'eval',strengths:[],weaknesses:[],issues:[],criteria:[],nextActions:[]}})));
  assert.equal(evaluated,0);
 }finally{await act(async()=>root.unmount());}
});
