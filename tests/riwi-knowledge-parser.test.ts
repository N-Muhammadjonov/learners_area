import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  KnowledgeParseError,
  RIWI_MAX_UNITS,
  RIWI_SOURCE_LIMIT_BYTES,
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
  const unclosedScript = await extractKnowledgeText("unclosed.html", bytes(
    "<p>Visible lesson text</p><script>do not ingest or execute this code",
  ));
  assert.ok(unclosedScript.includes("Visible lesson text"));
  assert.ok(!unclosedScript.includes("do not ingest"));

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

test("DOCX parsing handles real ZIP bytes and rejects malformed, traversing, macro, and expansion-bomb archives", async () => {
  const xml = strToU8("<w:document><w:body><w:p><w:r><w:t>Present perfect uses have or has.</w:t></w:r></w:p></w:body></w:document>");
  const validDocx = new Uint8Array(zipSync({ "word/document.xml": xml }));
  const parsed = await extractKnowledgeText("lesson.docx", validDocx);
  assert.match(parsed, /Present perfect uses have or has/);

  const traversal = new Uint8Array(zipSync({
    "word/document.xml": xml,
    "word/../../payload.js": strToU8("alert(1)"),
  }));
  await rejectsWith(extractKnowledgeText("traversal.docx", traversal), "source_unsafe_archive");

  const macro = new Uint8Array(zipSync({
    "word/document.xml": xml,
    "word/vbaProject.bin": new Uint8Array([0x4d, 0x5a, 0x00]),
  }));
  await rejectsWith(extractKnowledgeText("macro.docx", macro), "source_unsafe_archive");

  const malformed = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
  await rejectsWith(extractKnowledgeText("broken.docx", malformed), "source_unsafe_archive");

  const bomb = new Uint8Array(zipSync({
    "word/document.xml": strToU8("x".repeat(RIWI_SOURCE_LIMIT_BYTES + 1)),
  }, { level: 9 }));
  assert.ok(bomb.byteLength < RIWI_SOURCE_LIMIT_BYTES, "compressed bomb fixture remains under the source-byte cap");
  await rejectsWith(extractKnowledgeText("bomb.docx", bomb), "source_unsafe_archive");
});
