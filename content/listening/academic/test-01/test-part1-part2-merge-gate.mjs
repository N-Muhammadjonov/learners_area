import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const source = read("data.json");
for (const part of [1, 2]) {
  const staged = read(`script-part${part}-staged-sense-mapping.json`);
  assert.equal(staged.count, staged.mappings.length, `Part ${part}: count`);
  const text = source.transcript[String(part)];
  for (const x of staged.mappings)
    assert.equal(text.slice(x.start, x.end), x.surface, `Part ${part}: offset ${x.start}`);
  for (let i = 1; i < staged.mappings.length; i++)
    assert.ok(staged.mappings[i-1].end <= staged.mappings[i].start, `Part ${part}: overlap`);
  assert.notEqual(staged.deploymentStatus, "NOT_PUBLISHED", `Part ${part}: no unpublished release to main`);
}
const pending = read("script-part2-new-sense-links.pending.json");
assert.equal(pending.entries.length, 0, "Part 2: unresolved release sense IDs");
const review = read("script-part2-contextual-definition-review.json");
const staged = read("script-part2-staged-sense-mapping.json");
for (const x of review.entries) {
  if (staged.mappings.some(y => x.start === y.start && x.end === y.end)) continue;
  assert.fail(`Part 2 unmapped: ${x.surface} at ${x.start}-${x.end}`);
}
console.log("PART 1/2 MERGE GATE PASS");
