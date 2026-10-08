import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { convertLegacyPackage, structuredQuestionType } from "../src/lib/listening/source-parser";
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
