import test from "node:test";
import assert from "node:assert/strict";
import {readReadingSource} from "../src/lib/import/reading-source";
import {readPdfTextLayer} from "../src/lib/import/pdf-text";
/** Original minimal PDF fixture: a real text layer, no image/OCR or external resources. */
function pdfWithText(text: string): Uint8Array {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 12 Tf 40 750 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {offsets.push(Buffer.byteLength(source)); source += `${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref = Buffer.byteLength(source);
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(source));
}
test("Real PDF text layer becomes an inert source preview, never invented questions",async()=>{
 const bytes=pdfWithText("Original centre-authored reading source.");
 const source=await readReadingSource(new File([bytes],"source.pdf",{type:"application/pdf"}));
 assert.deepEqual(source,{kind:"supplemental",textPreview:"Original centre-authored reading source.",files:["source.pdf"]});
});
test("Image-only/empty PDF stays supplemental without invented text or OCR",async()=>{
 assert.equal(await readPdfTextLayer(pdfWithText("")),"");
});
test("PDF source enforces cancellation and size bounds before parsing",async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(readPdfTextLayer(pdfWithText("source"),controller.signal),{name:"AbortError"});
 await assert.rejects(readPdfTextLayer(new Uint8Array(20*1024*1024+1)),/source_too_large/);
});
