import assert from "node:assert/strict";
import test from "node:test";
import {
  KnowledgeParseError,
  RIWI_MAX_UNITS,
  RIWI_SOURCE_LIMIT_CHARS,
  RIWI_UNIT_MAX_CHARS,
  chunkKnowledgeText,
  extractKnowledgeText,
} from "../src/lib/services/riwi/knowledge-parser";

const bytes = (text: string) => new TextEncoder().encode(text);

async function rejectsWith(action: Promise<unknown>, code: KnowledgeParseError["code"]) {
  await assert.rejects(action, (error: unknown) => error instanceof KnowledgeParseError && error.code === code);
}

test("source ingestion accepts bounded text/HTML as inert UTF-8 and chunks with stable bounds", async () => {
  const plain = await extractKnowledgeText("lesson.md", bytes("# Articles\r\n\r\nUse an article before a singular count noun."));
  assert.equal(plain, "# Articles\n\nUse an article before a singular count noun.");

  const html = await extractKnowledgeText("lesson.HTML", bytes(
    "<h1>Grammar</h1><script>exfiltrate private data</script><p>Use an article before a singular noun.</p>",
  ));
  assert.ok(html.includes("Grammar"));
  assert.ok(html.includes("singular noun"));
  assert.ok(!html.includes("exfiltrate"));

  const units = chunkKnowledgeText(`# Articles\n\n${"Use an article before a singular count noun. ".repeat(100)}`);
  assert.ok(units.length > 1);
  assert.ok(units.length <= RIWI_MAX_UNITS);
  assert.ok(units.every((unit, index) => unit.ordinal === index && unit.characterCount === unit.text.length && unit.text.length <= RIWI_UNIT_MAX_CHARS));
});

test("source ingestion fails closed for empty, oversized, unsupported, mismatched and invalid UTF-8 inputs", async () => {
  await rejectsWith(extractKnowledgeText("empty.txt", new Uint8Array()), "source_empty");
  await rejectsWith(extractKnowledgeText("large.txt", bytes("x".repeat(RIWI_SOURCE_LIMIT_CHARS + 1))), "source_too_large");
  await rejectsWith(extractKnowledgeText("notes.xlsx", bytes("not a supported knowledge source")), "unsupported_format");
  await rejectsWith(extractKnowledgeText("notes.pdf", bytes("not a PDF")), "signature_mismatch");
  await rejectsWith(extractKnowledgeText("broken.txt", new Uint8Array([0xff, 0xfe])), "source_invalid_text");
});
