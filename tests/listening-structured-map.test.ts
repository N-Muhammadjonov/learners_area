import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { convertLegacyPackage, jsonLiteral, structuredQuestionType } from "../src/lib/listening/source-parser";
import { gradePackage } from "../src/lib/listening/package";
import { listeningQuestionIdentity } from "../src/lib/listening/question-identity";
import { activityFacts, mapDiagramSections, testActivities } from "../src/lib/listening/activities";
import { ListeningImportProblem } from "../src/lib/listening/discover";
import { structuredSource, mapSvg } from "./support/structured-listening-fixture";
const parse = (label = "Map / Plan", visual = mapSvg) => convertLegacyPackage({"source.html":structuredSource(label, visual)}, 500, html => new JSDOM(html).window.document, {audioPath:"fixture.mp3"});
const maps = () => parse().questions.filter(q => q.number >= 11 && q.number <= 14);
test("SP-MAP-01 explicit Map / Plan is map, without an invented subtype", () => {
  for (const q of maps()) { assert.equal(q.kind,"map"); assert.equal(q.typeCode,undefined); assert.ok(listeningQuestionIdentity(q).review); }
});
test("SP-MAP-02 map labelling preserves the proven subtype", () => assert.equal(parse("map labelling").questions[10]!.typeCode,"map_labeling"));
test("SP-MAP-03 plan labeling preserves the proven subtype", () => assert.equal(parse("plan labeling").questions[10]!.typeCode,"plan_labeling"));
test("SP-MAP-04 map label pools never become MCQ", () => {
  for (const q of maps()) { assert.ok(q.options.length); assert.equal(listeningQuestionIdentity(q).storageType,"short_answer"); }
  const p=parse(); assert.equal(activityFacts({...p,questions:maps()}).mcq,false);
});
test("SP-MAP-05 source visual is extracted as sanitized coordinates and text", () => {
  const diagram=parse().mapDiagram!; assert.equal(diagram.shapes.length,2); assert.equal(diagram.shapes[1]!.text,"Park entrance"); assert.doesNotMatch(JSON.stringify(diagram),/onload|script|sourceExecuted/);
});
test("SP-MAP-06 real map questions own Part 3", () => assert.deepEqual(mapDiagramSections(parse()),[3]));
test("SP-MAP-07 map activity requires real content, not arbitrary source activity names", () => {
  assert.ok(testActivities(parse()).includes("map"));
  const p=parse("MCQ",""); assert.equal(testActivities(p).includes("map"),false); assert.equal(p.mapDiagram,undefined);
});
test("SP-MAP-08 matching stays matching, never MCQ", () => {
  const q=parse().questions[25]!; assert.equal(q.kind,"matching"); assert.equal(listeningQuestionIdentity(q).storageType,"short_answer");
});
test("SP-MAP-09 authored MCQ stays MCQ", () => assert.equal(listeningQuestionIdentity(parse().questions[14]!).storageType,"multiple_choice"));
test("SP-MAP-10 completion requires source evidence, word bank is not MCQ", () => {
  const p=parse(); for (const [index,type] of [[0,"note_completion"],[30,"sentence_completion"]] as const) {
    const q=p.questions[index]!; assert.equal(q.kind,"completion"); assert.equal(q.typeCode,type); assert.equal(listeningQuestionIdentity(q).storageType,"short_answer");
  }
});
test("SP-MAP-11 unknown source types block for staff review instead of becoming completion", () => {
  assert.equal(structuredQuestionType("Location selection"),null);
  assert.throws(()=>parse("Location selection"), (e: unknown) => e instanceof ListeningImportProblem && e.code === "package_invalid" && /not canonically proven/.test(e.detail.info ?? ""));
});
test("SP-MAP-12 missing map visual blocks honestly, never fabricates one", () => {
  assert.throws(()=>parse("Map / Plan",""), (e: unknown)=>e instanceof ListeningImportProblem && e.code === "map_missing");
});
test("SP-MAP-13 source scripts and handlers never execute", () => {
  parse(); assert.equal((globalThis as Record<string,unknown>).sourceExecuted,undefined);
});
test("SP-MAP-14 incompatible maps refused; repeated identical drawing accepted", () => {
  assert.throws(()=>parse("Map / Plan",mapSvg + mapSvg.replace('width="90"','width="70"')), (e: unknown)=>e instanceof ListeningImportProblem && /Multiple different/.test(e.detail.info ?? ""));
  assert.equal(parse("Map / Plan",mapSvg+mapSvg).mapDiagram!.shapes.length,2);
});
test("SP-MAP-15 authored map/plan spelling variants preserve family", () => {
  for (const label of ["map","plan","map labeling","map_labelling","plan labelling","plan_labeling","Map / Plan"]) assert.equal(structuredQuestionType(label)?.kind,"map");
});

test("SP-MAP-16 source-declared Choose TWO is multi-answer, not an inferred single MCQ", () => {
  for (const label of ["Choose TWO / Multiple Answer", "choose two", "choose_two", "Choose TWO / Multiple Answers"])
    assert.deepEqual(structuredQuestionType(label), { kind: "mcq", typeCode: "mcq_multi" });
  assert.deepEqual(structuredQuestionType("MCQ"), { kind: "mcq", typeCode: "mcq_single" });
  assert.equal(structuredQuestionType("Choose FIVE / Multiple Answer"), null, "unsupported source types still stop for review");
});

test("SP-MAP-17 authored Listening Test 1 style HTML retains A-E and all three Choose TWO pairs", () => {
  const original = structuredSource("Map Labelling");
  const source = jsonLiteral(original, "const DATA =") as {
    question_types: Record<string, string>;
    questions: Record<string, {
      pair?: number;
      answer: string;
      options?: { code: string; text: string }[];
    }>;
  };
  const parts = jsonLiteral(original, "const PARTS =");
  source.question_types = {
    "1-10": "Note Completion",
    "11-14": "Map Labelling",
    "15-24": "MCQ",
    "25-30": "Choose TWO / Multiple Answer",
    "31-40": "Sentence Completion",
  };
  for (const [left, right, leftAnswer, rightAnswer] of [
    [25, 26, "B", "E"], [27, 28, "A", "D"], [29, 30, "C", "E"],
  ] as const) {
    const options = ["A", "B", "C", "D", "E"].map(code => ({ code, text: `Option ${code}` }));
    source.questions[String(left)]!.pair = right;
    source.questions[String(right)]!.pair = left;
    source.questions[String(left)]!.answer = leftAnswer;
    source.questions[String(right)]!.answer = rightAnswer;
    source.questions[String(left)]!.options = options;
    source.questions[String(right)]!.options = options;
  }
  const html = `<html><script>const DATA = ${JSON.stringify(source)}; const PARTS = ${JSON.stringify(parts)};</script></html>`;
  const payload = convertLegacyPackage(
    { "Listening Test 1.html": html },
    500,
    text => new JSDOM(text).window.document,
    { audioPath: "embedded-listening-audio.mp3" },
  );
  assert.equal(payload.questions.length, 40);
  assert.equal(payload.questions[17]!.typeCode, "map_labeling");
  for (const q of payload.questions.slice(20, 24))
    assert.equal(q.typeCode, "mcq_single", `Q${q.number} remains single-answer`);
  for (const q of payload.questions.slice(24, 30)) {
    assert.equal(q.typeCode, "mcq_multi", `Q${q.number} is multi-answer`);
    assert.equal(q.options.length, 5, `Q${q.number} retains A–E`);
    assert.equal(q.pair.length, 1, `Q${q.number} retains its pair`);
    const counterpart = payload.questions[q.pair[0]! - 1]!;
    assert.deepEqual(counterpart.pair, [q.number], `Q${q.number} pairing is reciprocal`);
  }
  assert.equal(gradePackage(payload, { 25: "E", 26: "B" }).filter(x => x.correct).length, 2);
  assert.equal(gradePackage(payload, { 25: "B", 26: "B" }).filter(x => x.correct).length, 1);
  assert.equal(payload.audio.path, "embedded-listening-audio.mp3");

  // A fake one-way pair is rejected, not silently dropped.
  source.questions["26"]!.pair = undefined;
  const broken = `<script>const DATA = ${JSON.stringify(source)}; const PARTS = ${JSON.stringify(parts)};</script>`;
  assert.throws(
    () => convertLegacyPackage({ "Listening Test 1.html": broken }, 500,
      text => new JSDOM(text).window.document, { audioPath: "embedded-listening-audio.mp3" }),
    /Invalid answer pair/,
  );
});
