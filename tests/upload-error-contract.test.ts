// U1–U20: upload error contract, content sniffing and format policy (owner defect: intent_failed).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  describeUploadError,
  failureFromResponse,
  isDangerousFilename,
  normalizeUploadCode,
  uploadErrorMessage,
  UPLOAD_ERROR_CODES,
} from "../src/lib/uploads/errors";
import { verifySignature } from "../src/lib/uploads/signature";
import { canonicalMimeFor, validateUploadFile } from "../src/lib/validation/uploads";
import { classifyThrown, uploadErrorBody, withUploadErrorBoundary } from "../src/lib/uploads/server-errors";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

const bytes = (...xs: (number | string)[]) =>
  new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));

test("U1 an HTML 500 (the old raw 'intent_failed') becomes server_error, retryable", () => {
  const f = failureFromResponse(500, null);
  assert.equal(f.code, "server_error");
  assert.equal(f.retryable, true);
  assert.equal(f.technical, "http_500");
});

test("U2 non-JSON statuses are classified: 401, 403, 404, 413, 429, 504", () => {
  const map = { 401: "unauthenticated", 403: "forbidden", 404: "not_found", 413: "file_too_large", 429: "rate_limited", 504: "upload_timeout" } as const;
  for (const [status, code] of Object.entries(map)) assert.equal(failureFromResponse(Number(status), "<html>").code, code);
});

test("U3 a structured body wins over the status and keeps the correlation id", () => {
  const f = failureFromResponse(503, { error: "storage_not_configured", code: "storage_not_configured", retryable: false, correlationId: "ab12cd34" });
  assert.deepEqual([f.code, f.retryable, f.correlationId], ["storage_not_configured", false, "ab12cd34"]);
});

test("U4 technical server codes map to user-facing families", () => {
  assert.equal(normalizeUploadCode("upload_expired"), "intent_expired");
  assert.equal(normalizeUploadCode("upload_type_mismatch"), "type_mismatch");
  assert.equal(normalizeUploadCode("file_too_large:50 MB"), "file_too_large");
  assert.equal(normalizeUploadCode("intent_failed"), "unknown");
});

test("U5 every code has an English and an Uzbek message, and no message is a raw code", () => {
  for (const code of UPLOAD_ERROR_CODES) {
    for (const dict of [en, uz]) {
      const m = (dict.uploadErrors as Record<string, string>)[code];
      assert.ok(m && m.length > 10, `${code} message missing`);
      assert.notEqual(m, code);
      assert.doesNotMatch(m, /intent_failed|finalize_failed/);
    }
  }
});

test("U6 messages fill {max} and {ref}; the raw code is never shown", () => {
  const msg = uploadErrorMessage({ code: "file_too_large", max: "50 MB" }, en.uploadErrors);
  assert.match(msg, /50 MB/);
  assert.doesNotMatch(msg, /\{max\}|file_too_large/);
  const ref = uploadErrorMessage({ code: "server_error", correlationId: "ab12cd34" }, en.uploadErrors);
  assert.doesNotMatch(ref, /\{ref\}/);
});

test("U7 describeUploadError localizes codes and passes other text through", () => {
  assert.match(describeUploadError("file_too_large:10 MB", en.uploadErrors), /10 MB/);
  assert.equal(describeUploadError("Already localized text", en.uploadErrors), "Already localized text");
  assert.equal(describeUploadError(undefined, en.uploadErrors), "");
});

test("U8 the server body carries code, message, retryable, field and correlation id", () => {
  const body = uploadErrorBody("upload_type_mismatch", { field: "file", correlationId: "x1" });
  assert.deepEqual(body, { error: "upload_type_mismatch", code: "type_mismatch", message: "type_mismatch", field: "file", retryable: false, correlationId: "x1" });
});

test("U9 a thrown missing-storage configuration is storage_not_configured (503), not a 500 page", async () => {
  assert.deepEqual(classifyThrown(new Error("Missing required env var R2_BUCKET")), { code: "storage_not_configured", status: 503 });
  const res = await withUploadErrorBoundary("intent", async () => { throw new Error("STORAGE_PROVIDER is not set"); });
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.code, "storage_not_configured");
  assert.match(json.correlationId, /^[0-9a-f-]{8}$/);
});

test("U10 database and storage outages are classified separately", () => {
  assert.equal(classifyThrown(new Error("connect ECONNREFUSED postgres")).code, "database_unavailable");
  assert.equal(classifyThrown(new Error("presign failed: bucket")).code, "storage_unavailable");
  assert.equal(classifyThrown(new Error("boom")).code, "server_error");
});

test("U11 both upload routes are wrapped in the error boundary and use structured errors", () => {
  for (const route of ["src/app/api/uploads/intent/route.ts", "src/app/api/uploads/finalize/route.ts"]) {
    const src = readFileSync(route, "utf8");
    assert.match(src, /withUploadErrorBoundary\(/);
    assert.doesNotMatch(src, /NextResponse\.json\(\{\s*error:/);
  }
  // Code only: comments may still explain the old failure.
  const client = readFileSync("src/lib/uploads/client.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(client, /"intent_failed"|"finalize_failed"/);
});

test("U12 executables and disguised double extensions are dangerous", () => {
  for (const name of ["setup.exe", "audio.mp3.exe", "notes.pdf.bat", "x.sh", "run.ps1"]) assert.ok(isDangerousFilename(name), name);
  for (const name of ["Cambridge 18.Test 1.mp3", "essay.final.docx", "map.png"]) assert.equal(isDangerousFilename(name), false, name);
  assert.deepEqual(validateUploadFile({ filename: "audio.mp3.exe", contentType: "audio/mpeg", size: 10, category: "audio" }), { ok: false, error: "dangerous_type" });
});

test("U13 Safari's empty or octet-stream MIME is accepted when the extension is legitimate", () => {
  for (const contentType of ["", "application/octet-stream"]) {
    assert.equal(validateUploadFile({ filename: "lecture.m4a", contentType, size: 1000, category: "audio" }).ok, true);
    assert.equal(validateUploadFile({ filename: "report.pdf", contentType, size: 1000, category: "file" }).ok, true);
  }
});

test("U14 broad legitimate formats are accepted per category", () => {
  for (const f of ["a.pdf", "a.docx", "a.rtf", "a.md", "a.json"]) assert.equal(validateUploadFile({ filename: f, contentType: "", size: 10, category: "file" }).ok, true, f);
  for (const f of ["a.mp3", "a.wav", "a.ogg", "a.flac", "a.m4a", "a.webm"]) assert.equal(validateUploadFile({ filename: f, contentType: "", size: 10, category: "audio" }).ok, true, f);
});

test("U15 SVG is not accepted (scriptable image)", () => {
  assert.equal(validateUploadFile({ filename: "logo.svg", contentType: "image/svg+xml", size: 10, category: "image" }).ok, false);
});

test("U16 HTML and XML are stored as inert text/plain; the stored MIME is canonical, not the browser claim", () => {
  assert.equal(canonicalMimeFor("page.html", "file"), "text/plain");
  assert.equal(canonicalMimeFor("data.xml", "file"), "text/plain");
  assert.equal(canonicalMimeFor("a.m4a", "audio"), "audio/mp4");
  assert.equal(canonicalMimeFor("a.MP3", "audio"), "audio/mpeg");
});

test("U17 magic bytes must match the extension", () => {
  assert.deepEqual(verifySignature("a.pdf", bytes("%PDF-1.7")), { ok: true });
  assert.deepEqual(verifySignature("a.pdf", bytes(0x50, 0x4b, 3, 4)), { ok: false, reason: "mismatch" });
  assert.deepEqual(verifySignature("a.docx", bytes(0x50, 0x4b, 3, 4)), { ok: true });
  assert.deepEqual(verifySignature("a.png", bytes(0x89, "PNG")), { ok: true });
  assert.deepEqual(verifySignature("a.jpg", bytes(0xff, 0xd8, 0xff)), { ok: true });
});

test("U18 an executable header is refused whatever the extension says", () => {
  assert.deepEqual(verifySignature("notes.pdf", bytes("MZ", 0x90, 0)), { ok: false, reason: "executable" });
  assert.deepEqual(verifySignature("song.mp3", bytes(0x7f, "ELF")), { ok: false, reason: "executable" });
  assert.deepEqual(verifySignature("a.txt", bytes("#!/bin/sh\n")), { ok: false, reason: "executable" });
});

test("U19 audio containers are sniffed; text files must not contain NUL bytes", () => {
  assert.deepEqual(verifySignature("a.mp3", bytes("ID3", 4, 0)), { ok: true });
  assert.deepEqual(verifySignature("a.m4a", bytes(0, 0, 0, 0x20, "ftypM4A ")), { ok: true });
  assert.deepEqual(verifySignature("a.wav", bytes("RIFF", 0, 0, 0, 0, "WAVE")), { ok: true });
  assert.deepEqual(verifySignature("a.mp3", bytes("hello")), { ok: false, reason: "mismatch" });
  assert.deepEqual(verifySignature("a.csv", bytes("a,b", 0, "c")), { ok: false, reason: "mismatch" });
  assert.deepEqual(verifySignature("empty.pdf", new Uint8Array()), { ok: false, reason: "mismatch" });
});

test("U20 the client checks the signature before asking for an intent and joins duplicate uploads", () => {
  const src = readFileSync("src/lib/uploads/client.ts", "utf8");
  const sig = src.indexOf("verifySignature(file.name");
  const intent = src.indexOf('fetch("/api/uploads/intent"');
  assert.ok(sig > 0 && intent > 0 && sig < intent, "signature check runs before the intent request");
  assert.match(src, /const inflight = new Map<string, UploadHandle>\(\)/);
});
