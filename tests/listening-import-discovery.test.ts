// L1–L14: Listening ZIP discovery and inspection (owner defect A).
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { zipSync, strToU8 } from "fflate";
import { readListeningZip } from "../src/lib/listening/zip";
import {
  audioCandidates,
  chooseAudio,
  cuesToText,
  discoverTranscripts,
  ListeningImportProblem,
  packageRoot,
  sniffAudio,
  splitBySectionHeadings,
} from "../src/lib/listening/discover";
import { inspectListeningPackage } from "../src/lib/listening/inspect";

const read = (html: string) => new JSDOM(html).window.document;
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64]);
const M4A = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const WAV = new Uint8Array([...strToU8("RIFF"), 0, 0, 0, 0, ...strToU8("WAVEfmt ")]);
const OGG = new Uint8Array([...strToU8("OggS"), 0, 2, ...new Array(22).fill(0), ...strToU8("OpusHead")]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
const AAC = new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc]);

function examHtml() {
  return (
    '<div class="lp"><div class="q-instructions">Instructions</div>' +
    Array.from({ length: 40 }, (_, i) => `<p>Question ${i + 1} <input id="l${i + 1}"></p>`).join("") +
    "</div>\nconst KEY = " +
    JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i + 1, "answer" + (i + 1)]))) +
    ";const ALT = {};const PAIR_OF = {};window.RS_WHY = " +
    JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i + 1, { at: i + 1, why: "Authored evidence" }]))) +
    ";"
  );
}

// The legacy family's activity pages (keyword match 1/2, vocabulary session).
const LEGACY_ACTIVITIES = {
  "03_keyword_match_1.html": "const KEYS = " + JSON.stringify([{ q: 1, at: 1, end: 4, text: "asked", heard: "heard", link: "asked = heard" }]) + ";",
  "04_keyword_match_2.html": "const ITEMS=" + JSON.stringify([{ q: 2, at: 5, end: 9, heard: "heard2", link: "meaning", options: ["A", "B"], correct: 1 }]) + ";",
  "05_vocabulary_session.html": "const ITEMS = " + JSON.stringify([{ word: "keen", pos: "adj", uz: "ishtiyoqli", def: "interested", ex: "I am keen.", also: ["eager"], quiz: { q: "Meaning?", options: ["interested", "tired"], correct: 0 } }]) + ";",
};

function zip(files: Record<string, Uint8Array | string>) {
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) out[k] = typeof v === "string" ? strToU8(v) : v;
  return readListeningZip(zipSync(out));
}

const probe = async () => 1800;

async function inspect(files: Record<string, Uint8Array | string>, chosenAudioPath?: string) {
  const { entries, textFiles } = zip({ ...LEGACY_ACTIVITIES, ...files });
  return inspectListeningPackage({ entries, textFiles, zipName: "Cambridge 18 Test 1.zip", chosenAudioPath, probeDuration: probe, read });
}

async function problemOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ListeningImportProblem, `expected a typed problem, got ${String(e)}`);
    return e;
  }
  assert.fail("expected a ListeningImportProblem");
}

test("L1 legacy ZIP without metadata.json imports (no 'metadata.json missing')", async () => {
  const r = await inspect({ "exam.html": examHtml(), "audio/full.mp3": MP3 });
  assert.equal(r.family, "legacy");
  assert.equal(r.payload.questions.length, 40);
  assert.equal(r.audio.path, "audio/full.mp3");
  assert.equal(r.payload.testId, "cambridge-18-test-1");
});

test("L2 nested single top-level folder is the package root", () => {
  const { entries } = zip({ "Test 1/01_full_exam.html": examHtml(), "Test 1/audio.mp3": MP3 });
  assert.ok(entries["01_full_exam.html"]);
  assert.ok(entries["audio.mp3"]);
  assert.equal(packageRoot(["Pkg/data/package.json", "Pkg/a.mp3"]), "Pkg/");
});

test("L3 macOS junk (__MACOSX, ._files, .DS_Store) is ignored, not a second root", () => {
  const { entries } = zip({
    "Test/01_full_exam.html": examHtml(),
    "Test/full.mp3": MP3,
    "__MACOSX/Test/._full.mp3": "junk",
    "Test/.DS_Store": "junk",
  });
  assert.deepEqual(Object.keys(entries).sort(), ["01_full_exam.html", "full.mp3"]);
});

test("L4 every accepted audio container is recognised by its bytes", () => {
  assert.equal(sniffAudio(MP3), "mp3");
  assert.equal(sniffAudio(M4A), "m4a");
  assert.equal(sniffAudio(WAV), "wav");
  assert.equal(sniffAudio(OGG), "opus");
  assert.equal(sniffAudio(WEBM), "webm");
  assert.equal(sniffAudio(AAC), "aac");
  assert.equal(sniffAudio(strToU8("hello")), null);
});

test("L5 an audio extension with non-audio bytes is rejected, not imported", async () => {
  const { candidates, rejected } = audioCandidates({ "full.mp3": strToU8("<html>not audio</html>") });
  assert.equal(candidates.length, 0);
  assert.deepEqual(rejected.map((r) => r.path), ["full.mp3"]);
  const e = await problemOf(inspect({ "exam.html": examHtml(), "full.mp3": strToU8("MZ fake") }));
  assert.equal(e.code, "audio_signature_mismatch");
});

test("L6 several recordings with no reference ask staff to choose (with the list)", async () => {
  const e = await problemOf(inspect({ "exam.html": examHtml(), "a/s1.mp3": MP3, "a/s2.m4a": M4A }));
  assert.equal(e.code, "audio_ambiguous");
  assert.deepEqual(e.detail.files, ["a/s1.mp3", "a/s2.m4a"]);
});

test("L7 the staff choice resolves the ambiguity and the format follows the bytes", async () => {
  const r = await inspect({ "exam.html": examHtml(), "a/s1.mp3": MP3, "a/s2.m4a": M4A }, "a/s2.m4a");
  assert.equal(r.audio.path, "a/s2.m4a");
  assert.equal(r.audio.mimeType, "audio/mp4");
  assert.equal(r.payload.audio.path, "a/s2.m4a");
});

test("L8 a 'full' recording wins over section clips; a metadata reference wins over names", () => {
  const c = audioCandidates({ "s1.mp3": MP3, "full_test.mp3": MP3, "s2.mp3": MP3 }).candidates;
  const named = chooseAudio(c);
  assert.equal(named.kind === "chosen" && named.audio.path, "full_test.mp3");
  const ref = chooseAudio(c, "s2.mp3");
  assert.equal(ref.kind === "chosen" && ref.reason, "referenced");
});

test("L9 no recording at all is a typed problem listing the files", async () => {
  const e = await problemOf(inspect({ "exam.html": examHtml(), "notes.txt": "hello" }));
  assert.equal(e.code, "no_audio");
  assert.ok(e.detail.files!.includes("exam.html"));
});

test("L10 no exam page and no canonical package is 'no_question_source', not a crash", async () => {
  const e = await problemOf(inspect({ "full.mp3": MP3, "readme.txt": "x" }));
  assert.equal(e.code, "no_question_source");
});

test("L11 per-section transcript files are extracted (txt, vtt, html)", () => {
  const found = discoverTranscripts({
    "transcripts/section1.txt": "Good morning, welcome.",
    "transcripts/section_2.vtt": "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHello <b>there</b>\n",
    "transcripts/part3_script.html": "<p>Tutor: Right.</p><script>alert(1)</script>",
  });
  assert.equal(found.bySection[1], "Good morning, welcome.");
  assert.equal(found.bySection[2], "Hello there");
  assert.equal(found.bySection[3], "Tutor: Right.");
  assert.equal(cuesToText("WEBVTT\n\n00:00.000 --> 00:01.000\nA"), "A");
});

test("L12 one full transcript is split at Section headings; untied files are reported", () => {
  const split = splitBySectionHeadings("SECTION 1\nOne text\nSECTION 2\nTwo text\n");
  assert.deepEqual(split, { 1: "One text", 2: "Two text" });
  const found = discoverTranscripts({ "transcript.txt": "No headings at all." });
  assert.deepEqual(found.unassigned, ["transcript.txt"]);
});

test("L13 optional transcripts are reported per section without blocking authored exercises", async () => {
  const r = await inspect({ "exam.html": examHtml(), "full.mp3": MP3, "section1_transcript.txt": "Spoken words." });
  assert.deepEqual(r.transcriptStatus.map((s) => s.present), [true]);
  assert.deepEqual(r.blockers.map((b) => `${b.kind}:${b.section}`), []);
});

test("L14 unsafe or duplicate ZIP entries are still refused", () => {
  assert.throws(() => readListeningZip(zipSync({ "../secret.json": strToU8("{}") })), /Unsafe ZIP/);
  assert.throws(() => zip({ "A/x.mp3": MP3, "x.mp3": MP3, "A/metadata.json": "{}" }), /Duplicate ZIP filename/);
});
