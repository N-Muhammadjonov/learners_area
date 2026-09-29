import test from "node:test";
import assert from "node:assert/strict";
import { occurrenceSpans } from "../src/lib/services/lexical/occurrence-spans";

test("context offsets distinguish identical spelling in different sentences and paragraphs", () => {
  const a = "The bank lends money.";
  const b = "The bank borders the river.";
  const body = `${a}\n\n${b}`;
  const rows = [{ id: "money", startChar: 4, endChar: 8, surfaceForm: "bank" }, { id: "river", startChar: a.length + 6, endChar: a.length + 10, surfaceForm: "bank" }];
  assert.deepEqual(occurrenceSpans(body, b, rows), [{ id: "river", startChar: 4, endChar: 8, surfaceForm: "bank" }]);
  assert.equal(occurrenceSpans(body, body, rows).length, 2);
  assert.deepEqual(occurrenceSpans(body, "bank", rows), [], "an ambiguous fragment must not inherit either sense");
  assert.deepEqual(occurrenceSpans(body, body, [{ ...rows[0]!, surfaceForm: "wrong" }]), []);
});
