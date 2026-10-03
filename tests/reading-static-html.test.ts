import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { readReadingSource, readingTextSource } from "../src/lib/import/reading-source";
import { generalReadingBundle } from "../src/lib/reading/import-schema";
const read = (html: string) => new JSDOM(html).window.document;
const source = '<title>Work</title><article data-reading-passage>People change careers.</article><p class="question"><span class="qtext">What do people change?</span><input id="q1"></p><script>const KEY = {"1":"careers"}; throw new Error("must never execute");</script>';
test("authored single-passage HTML needs neither three parts nor a transcript, and its script stays inert", async () => {
  const result = await readReadingSource(new File([source], "work.html", {type:"text/html"}), undefined, read);
  assert.equal(result.kind, "structured");
  if (result.kind !== "structured") return;
  const bundle = generalReadingBundle.parse(result.bundle);
  assert.match(bundle.sourceRef, /^html-reading-[a-f0-9]{64}$/);
  assert.equal(bundle.passages.length, 1);
  assert.equal(bundle.passages[0]!.questions[0]!.answer, "careers");
  assert.equal(bundle.passages[0]!.questions[0]!.explanation, "");
});
test("missing authored keys or ambiguous passage routing never invent answers", () => {
  assert.equal(readingTextSource(source.replace('{"1":"careers"}', '{}'), ".html", read).bundle, null);
  assert.equal(readingTextSource(source.replace('</article>', '</article><article data-reading-passage>Other passage.</article>'), ".html", read).bundle, null);
});
