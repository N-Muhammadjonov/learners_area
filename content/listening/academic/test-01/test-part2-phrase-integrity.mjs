import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = new URL("./", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, base), "utf8"));
const script = read("data.json").transcript["2"];
const mapped = read("script-part2-staged-sense-mapping.json");
const review = read("script-part2-contextual-definition-review.json");
const pending = read("script-part2-new-sense-links.pending.json");
const reserved = [
  { surface: "as much as", start: 1431, end: 1441 },
  { surface: "fresh air", start: 1226, end: 1235 },
  { surface: "computer room", start: 3054, end: 3067 },
  { surface: "on their own", start: 3134, end: 3146 },
  { surface: "music room", start: 3236, end: 3246 },
  { surface: "assembly hall", start: 3503, end: 3516 },
  { surface: "feel free", start: 3632, end: 3641 }
];
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
for (const [label, data] of [["mapped", mapped.mappings], ["review", review.entries]]) {
  assert.equal(new Set(data.map(x => x.start)).size, data.length, label + " duplicate start");
  for (const x of data) assert.equal(script.slice(x.start, x.end), x.surface, label + " offset " + x.start);
  for (let i = 1; i < data.length; i++) assert.ok(!overlaps(data[i-1], data[i]), label + " overlap " + i);
}
assert.equal(mapped.count, mapped.mappings.length);
assert.equal(review.count, review.entries.length);
for (const phrase of reserved) {
  assert.equal(script.slice(phrase.start, phrase.end), phrase.surface);
  const matches = mapped.mappings.filter(x => overlaps(x, phrase));
  assert.ok(matches.every(x => x.start === phrase.start && x.end === phrase.end),
    "A multiword phrase cannot be mapped through one of its words: " + phrase.surface);
  const definitions = review.entries.filter(x => overlaps(x, phrase));
  assert.ok(definitions.every(x => x.start === phrase.start && x.end === phrase.end),
    "A multiword phrase must have one indivisible definition: " + phrase.surface);
}
for (const entry of pending.entries) {
  assert.equal(script.slice(entry.start, entry.end), entry.surface);
  assert.ok(mapped.mappings.every(x => !overlaps(x, entry)),
    "Pending phrase may not have a conflicting staged token sense: " + entry.surface);
}
console.log("Part 2 offset, overlap, and phrase-integrity QA PASS");
