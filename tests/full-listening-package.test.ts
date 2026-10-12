import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import {
  jsonLiteral,
  convertLegacyPackage,
} from "../src/lib/listening/source-parser";
import {
  gradePackage,
  listeningPackageSchema,
  publicationIssues,
} from "../src/lib/listening/package";
import { readListeningZip } from "../src/lib/listening/zip";
import { zipSync, strToU8 } from "fflate";
const source = process.env.LISTENING_SOURCE_ZIP;
function fixture() {
  const files = {
    "01_full_exam.html":
      '<div class="lp"><div class="q-instructions">Instructions</div>' +
      Array.from(
        { length: 40 },
        (_, i) => `<p>Question ${i + 1} <input id="l${i + 1}"></p>`,
      ).join("") +
      "</div>\nconst KEY = " +
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [i + 1, "answer" + (i + 1)]),
        ),
      ) +
      ";const ALT = {};const PAIR_OF = {};window.RS_WHY = " +
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [
            i + 1,
            { at: i + 1, why: "Authored evidence" },
          ]),
        ),
      ) +
      ";",
    "metadata.json": JSON.stringify({
      test_id: "fixture",
      sections: ["One", "Two", "Three", "Four"],
      audio_file: "audio/full.mp3",
    }),
    "03_keyword_match_1.html":
      "const KEYS = " +
      JSON.stringify([
        {
          q: 1,
          at: 1,
          end: 4,
          text: "asked",
          heard: "heard",
          link: "asked = heard",
        },
      ]) +
      ";",
    "04_keyword_match_2.html":
      "const ITEMS=" +
      JSON.stringify([
        {
          q: 2,
          at: 5,
          end: 9,
          heard: "heard2",
          link: "meaning",
          options: ["A", "B"],
          correct: 1,
        },
      ]) +
      ";",
    "05_vocabulary_session.html":
      "const ITEMS = " +
      JSON.stringify([
        {
          word: "keen",
          pos: "adj",
          uz: "ishtiyoqli",
          def: "interested",
          ex: "I am keen.",
          also: ["eager"],
          quiz: { q: "Meaning?", options: ["interested", "tired"], correct: 0 },
        },
      ]) +
      ";",
  };
  return convertLegacyPackage(
    files,
    100,
    (html) => new JSDOM(html).window.document,
  );
}
test("Legacy HTML is data only: malicious code is never evaluated", () => {
  assert.throws(() =>
    jsonLiteral("const ITEMS = (()=>{throw 1})()", "const ITEMS ="),
  );
  assert.deepEqual(
    jsonLiteral(
      'const ITEMS = [{"text":"braces } and \\" quote"}]',
      "const ITEMS =",
    ),
    [{ text: 'braces } and " quote' }],
  );
});
test("Forty logical questions and four independent sections; optional transcripts preserve authored questions", () => {
  const p = fixture();
  assert.equal(p.questions.length, 40);
  assert.equal(publicationIssues(p).length, 0);
  p.questions[39]!.number = 1;
  assert.equal(listeningPackageSchema.safeParse(p).success, false);
});
test("Unsafe asset paths, out-of-range clips and foreign section are refused", () => {
  for (const mutate of [
    (p: ReturnType<typeof fixture>) => {
      p.audio.path = "../secret.mp3";
    },
    (p: ReturnType<typeof fixture>) => {
      p.keyword2[0]!.end = 200;
    },
    (p: ReturnType<typeof fixture>) => {
      p.sections = p.sections.filter(s => s.number !== 4);
      p.questions[1]!.section = 4;
    },
  ]) {
    const p = fixture();
    mutate(p);
    assert.equal(listeningPackageSchema.safeParse(p).success, false);
  }
});
test("Choose TWO supports swapped letters without double-credit for a repeated letter", () => {
  const p = fixture();
  p.questions[24]!.key = "B";
  p.questions[25]!.key = "E";
  p.questions[24]!.pair = [26];
  p.questions[25]!.pair = [25];
  assert.equal(
    gradePackage(p, { 25: "E", 26: "B" }).filter((x) => x.correct).length,
    2,
  );
  assert.equal(
    gradePackage(p, { 25: "B", 26: "B" }).filter((x) => x.correct).length,
    1,
  );
  assert.equal(gradePackage(p, {}).filter((x) => x.correct).length, 0);
});
test("ZIP path traversal refused before reading package data", () => {
  assert.throws(
    () => readListeningZip(zipSync({ "../secret.json": strToU8("{}") })),
    /Unsafe ZIP/,
  );
});
test(
  "Uploaded owner source: counts, no fabricated transcript and valid source parsing",
  { skip: !source },
  () => {
    const { textFiles, entries } = readListeningZip(
      new Uint8Array(readFileSync(source!)),
    );
    const p = convertLegacyPackage(
      textFiles,
      1645.061224,
      (html) => new JSDOM(html).window.document,
    );
    assert.equal(p.testId, "listening-test-1");
    assert.equal(p.questions.length, 40);
    assert.ok(p.questions[17]!.options.includes("A Music room"));
    assert.match(p.questions[17]!.instruction, /Label the map/);
    assert.ok(p.questions[24]!.options.some(o => o.includes("Modern Forensic Techniques")));
    assert.match(p.questions[24]!.text, /Choose TWO/);
    assert.equal(p.keyword1.length, 20);
    assert.equal(p.keyword2.length, 20);
    assert.equal(p.vocabulary.length, 20);
    assert.ok(p.vocabulary.every(word => !word.quiz), "source authors study cards, not a quiz");
    assert.ok(p.mapDiagram?.shapes.length);
    assert.equal(publicationIssues(p).length, 0);
    assert.equal(entries[p.audio.path]!.length, 16450918);
  },
);

test("Duplicate filenames in ZIP headers cannot overwrite a validated asset", () => {
 const bytes=Buffer.from(zipSync({"a.json":strToU8("{}"),"b.json":strToU8("{}")}));
 const marker=Buffer.from("b.json");
 for(let offset=bytes.indexOf(marker);offset>=0;offset=bytes.indexOf(marker,offset+marker.length)) bytes[offset]=97;
 assert.throws(()=>readListeningZip(bytes),/Duplicate ZIP filename/);
});

test("Absent canonical transcript fields default to empty without changing Script Completion", () => {
  const original = fixture();
  const input = JSON.parse(JSON.stringify(original));
  for (const section of input.sections) delete section.transcript;
  const parsed = listeningPackageSchema.parse(input);
  assert.ok(parsed.sections.every((section) => section.transcript === ""));
  assert.deepEqual(parsed.questions, original.questions);
  assert.deepEqual(parsed.keyword1, original.keyword1);
  assert.deepEqual(parsed.keyword2, original.keyword2);
  assert.deepEqual(publicationIssues(parsed), []);
  parsed.sections[0]!.transcript = "Authored transcript awaiting audio review";
  parsed.sections[0]!.reviewRequired = true;
  assert.equal(publicationIssues(parsed).length, 0);
});
