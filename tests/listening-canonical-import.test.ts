// LC1–LC10: canonical Listening package acceptance, plus import authorization
// and the import error contract.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { zipSync, strToU8 } from "fflate";
import { readListeningZip } from "../src/lib/listening/zip";
import { ListeningImportProblem } from "../src/lib/listening/discover";
import { inspectListeningPackage } from "../src/lib/listening/inspect";
import { convertLegacyPackage } from "../src/lib/listening/source-parser";
import { mayImportListening } from "../src/lib/listening/permissions";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

const read = (html: string) => new JSDOM(html).window.document;
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64]);
const EXAM =
  '<div class="lp"><div class="q-instructions">Instructions</div>' +
  Array.from({ length: 40 }, (_, i) => `<p>Question ${i + 1} <input id="l${i + 1}"></p>`).join("") +
  "</div>\nconst KEY = " +
  JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i + 1, "answer" + (i + 1)]))) +
  ";const ALT = {};const PAIR_OF = {};window.RS_WHY = " +
  JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i + 1, { at: i + 1, why: "Authored evidence" }]))) +
  ";";
const ACTIVITIES = {
  "03_keyword_match_1.html": "const KEYS = " + JSON.stringify([{ q: 1, at: 1, end: 4, text: "asked", heard: "heard", link: "asked = heard" }]) + ";",
  "04_keyword_match_2.html": "const ITEMS=" + JSON.stringify([{ q: 2, at: 5, end: 9, heard: "heard2", link: "meaning", options: ["A", "B"], correct: 1 }]) + ";",
  "05_vocabulary_session.html": "const ITEMS = " + JSON.stringify([{ word: "keen", pos: "adj", uz: "ishtiyoqli", def: "interested", ex: "I am keen.", also: ["eager"], quiz: { q: "Meaning?", options: ["interested", "tired"], correct: 0 } }]) + ";",
};
const META = (audio = "audio/full.mp3") =>
  JSON.stringify({ test_id: "cam18-test1", sections: ["Booking", "Tour", "Seminar", "Lecture"], audio_file: audio });

function canonicalJson(transcripts: string[] = ["", "", "", ""]) {
  const files = { "01_full_exam.html": EXAM, "metadata.json": META("full.mp3"), ...ACTIVITIES };
  const p = convertLegacyPackage(files, 1800, read);
  p.sections.forEach((s, i) => { s.transcript = transcripts[i] ?? ""; });
  return JSON.stringify(p);
}

function zip(files: Record<string, Uint8Array | string>) {
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) out[k] = typeof v === "string" ? strToU8(v) : v;
  return readListeningZip(zipSync(out));
}
async function inspect(files: Record<string, Uint8Array | string>) {
  const { entries, textFiles } = zip(files);
  return inspectListeningPackage({ entries, textFiles, zipName: "pkg.zip", probeDuration: async () => 1800, read });
}
async function problem(p: Promise<unknown>) {
  try { await p; } catch (e) { assert.ok(e instanceof ListeningImportProblem, String(e)); return e; }
  return assert.fail("expected a ListeningImportProblem");
}

test("LC1 metadata.json at the ZIP root", async () => {
  const r = await inspect({ "01_full_exam.html": EXAM, "metadata.json": META(), "audio/full.mp3": MP3, ...ACTIVITIES });
  assert.equal(r.payload.testId, "cam18-test1");
  assert.deepEqual(r.payload.sections.map((s) => s.title), ["Booking", "Tour", "Seminar", "Lecture"]);
  assert.equal(r.audio.path, "audio/full.mp3");
});

test("LC2 metadata.json inside one nested package folder", async () => {
  const nested = Object.fromEntries(Object.entries({ "01_full_exam.html": EXAM, "metadata.json": META(), "audio/full.mp3": MP3, ...ACTIVITIES }).map(([k, v]) => [`Cambridge 18/Test 1/${k}`, v]));
  const r = await inspect(nested);
  assert.equal(r.payload.testId, "cam18-test1");
  assert.equal(r.audio.path, "audio/full.mp3");
});

test("LC3 manifest.json package", async () => {
  const r = await inspect({ "01_full_exam.html": EXAM, "manifest.json": META(), "audio/full.mp3": MP3, ...ACTIVITIES });
  assert.equal(r.payload.testId, "cam18-test1");
});

test("LC4 data/package.json canonical package", async () => {
  const r = await inspect({ "data/package.json": canonicalJson(), "full.mp3": MP3 });
  assert.equal(r.family, "canonical");
  assert.equal(r.payload.questions.length, 40);
  assert.equal(r.payload.audio.durationSec, 1800);
});

test("LC5 canonical discovery is case-insensitive (DATA/PACKAGE.JSON)", async () => {
  const r = await inspect({ "DATA/PACKAGE.JSON": canonicalJson(), "full.mp3": MP3 });
  assert.equal(r.family, "canonical");
});

test("LC6 the manifest's audio reference wins over filename heuristics", async () => {
  const r = await inspect({ "01_full_exam.html": EXAM, "metadata.json": META("audio/part_a.mp3"), "audio/part_a.mp3": MP3, "audio/full_test.mp3": MP3, ...ACTIVITIES });
  assert.equal(r.audio.path, "audio/part_a.mp3");
});

test("LC7 canonical transcripts are preserved", async () => {
  const r = await inspect({ "data/package.json": canonicalJson(["One.", "Two.", "Three.", "Four."]), "full.mp3": MP3 });
  assert.deepEqual(r.payload.sections.map((s) => s.transcript), ["One.", "Two.", "Three.", "Four."]);
  assert.equal(r.blockers.length, 0);
});

test("LC8 invalid metadata is not silently invented: derived values are labelled", async () => {
  const r = await inspect({ "01_full_exam.html": EXAM, "metadata.json": JSON.stringify({ test_id: "Bad ID!", sections: ["only one"], audio_file: "full.mp3" }), "full.mp3": MP3, ...ACTIVITIES });
  assert.deepEqual(r.payload.sections.map((s) => s.title), ["Section 1", "Section 2", "Section 3", "Section 4"]);
  assert.match(r.payload.provenance, /metadata inferred from package contents/);
  assert.match(r.payload.testId, /^[a-z0-9-]+$/);
});

test("LC9 an invalid data/package.json falls back to the exam page only when it exists", async () => {
  const r = await inspect({ "data/package.json": "{\"broken\":true}", "01_full_exam.html": EXAM, "full.mp3": MP3, ...ACTIVITIES });
  assert.equal(r.family, "legacy");
  assert.ok(r.canonicalFallback);
  const e = await problem(inspect({ "data/package.json": "{\"broken\":true}", "full.mp3": MP3 }));
  assert.equal(e.code, "package_invalid");
});

test("LC10 metadata naming a missing recording is an actionable error with the present recordings", async () => {
  const e = await problem(inspect({ "01_full_exam.html": EXAM, "metadata.json": META("audio/missing.mp3"), "audio/other.mp3": MP3, ...ACTIVITIES }));
  assert.equal(e.code, "audio_reference_missing");
  assert.equal(e.detail.info, "audio/missing.mp3");
  assert.deepEqual(e.detail.files, ["audio/other.mp3"]);
  for (const d of [en, uz]) assert.match(d.listeningImport.problems.audio_reference_missing, /\{ref\}/);
});

test("ZIP limits stay: size ceiling, file count, text asset size", () => {
  const src = readFileSync("src/lib/import/archive.ts", "utf8");
  assert.match(src, /MAX_TOTAL = 200 \* 1024 \* 1024/);
  assert.match(src, /\+\+count > 200/);
  assert.match(readFileSync("src/lib/listening/zip.ts", "utf8"), /5 \* 1024 \* 1024/);
  const many: Record<string, Uint8Array> = {};
  for (let i = 0; i < 201; i++) many[`f${i}.txt`] = strToU8("x");
  assert.throws(() => readListeningZip(zipSync(many)), /too many files/);
  assert.throws(() => readListeningZip(zipSync({ "big.txt": new Uint8Array(5 * 1024 * 1024 + 1) })), /Text asset too large/);
});

test("Listening import authorization: student/teacher denied, admin/owner allowed (page and API share it)", () => {
  assert.equal(mayImportListening("student"), false);
  assert.equal(mayImportListening("teacher"), false);
  assert.equal(mayImportListening("admin"), true);
  assert.equal(mayImportListening("owner"), true);
  const api = readFileSync("src/app/api/admin/listening/import/route.ts", "utf8");
  assert.match(api, /if \(!mayImportListening\(user\.role\)\)/);
  assert.doesNotMatch(api, /isStaff/);
  assert.match(readFileSync("src/app/(app)/admin/listening/import/page.tsx", "utf8"), /mayImportListening\(administrator\.role\)/);
});

test("every error code the import API returns has readable en/uz text", () => {
  const api = readFileSync("src/app/api/admin/listening/import/route.ts", "utf8");
  const codes = new Set([...api.matchAll(/error: "([a-z0-9_]+)"/g)].map((m) => m[1]!));
  assert.ok(codes.size >= 8, [...codes].join(","));
  for (const code of codes) for (const d of [en, uz]) {
    const msg = (d.listeningImport.importErrors as Record<string, string>)[code];
    assert.ok(msg && !msg.includes("_"), `${code} lacks readable text`);
  }
});
