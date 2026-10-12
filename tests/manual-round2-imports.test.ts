import test from "node:test";
import assert from "node:assert/strict";
import {zipSync, strToU8} from "fflate";
import {JSDOM} from "jsdom";
import {readSafeArchive, readSafeArchiveAsync} from "../src/lib/import/archive";
import {readReadingSource, readingTextSource} from "../src/lib/import/reading-source";
import {extractMapDiagram, mapDiagramSchema} from "../src/lib/listening/map-diagram";
const read = (html: string) => new JSDOM(html).window.document;
const bundle = {passages: [{title: "Authored passage", bodyText: "Original text."}]};
test("Reading TXT/MD preserves only explicitly authored canonical data", async () => {
  const result = await readReadingSource(new File([JSON.stringify(bundle)], "bundle.txt", {type:"text/plain"}), undefined, read);
  assert.equal(result.kind, "structured");
  if (result.kind === "structured") assert.deepEqual(result.bundle, bundle);
  assert.deepEqual(readingTextSource("Plain original paragraph, with no answer key.", ".txt", read), {bundle:null,textPreview:"Plain original paragraph, with no answer key."});
});
test("Reading inert HTML extracts JSON but removes remote attributes and execution", () => {
  let source = "";
  const result = readingTextSource(`<img src="https://private.example/image" onerror="steal()"><script>steal()</script><script type="application/json" data-reading-bundle>${JSON.stringify(bundle)}</script>`, ".html", html => {source=html;return read(html);});
  assert.deepEqual(result.bundle,bundle);
  assert.doesNotMatch(source, /src=|onerror=/);
  assert.doesNotMatch(result.textPreview,/steal/);
  assert.throws(()=>readingTextSource(`<reading-bundle>${JSON.stringify(bundle)}</reading-bundle><reading-bundle>${JSON.stringify(bundle)}</reading-bundle>`,".html",read),/ambiguous_source/);
});
test("Shared ZIP core rejects traversal, case-fold collisions and cancellation in both adapters", async () => {
  const bad = zipSync({"../outside.json":strToU8("{}")} );
  assert.throws(()=>readSafeArchive(bad),/Unsafe ZIP/);
  await assert.rejects(readSafeArchiveAsync(bad),/Unsafe ZIP/);
  const collision=zipSync({"A.json":strToU8("{}"),"a.json":strToU8("{}")});
  assert.throws(()=>readSafeArchive(collision),/Duplicate ZIP/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readSafeArchiveAsync(zipSync({"a.json":strToU8("{}")} ),controller.signal),{name:"AbortError"});
  const good=await readSafeArchiveAsync(zipSync({"nested/a.txt":strToU8("Original")} ));
  assert.equal(new TextDecoder().decode(good["nested/a.txt"]),"Original");
});
test("Invalid PDF cannot masquerade as successfully parsed reading data", async () => {
  await assert.rejects(readReadingSource(new File(["%PDF-1.4"],"invalid.pdf",{type:"application/pdf"}),undefined,read));
});

test("Source map retains coordinates and labels while scripts and external URLs are excluded", () => {
  const svg=read('<svg viewBox="0 0 760 430" aria-label="Original plan"><script>steal()</script><image href="https://private.example"><rect x="10" y="20" width="100" height="40" fill="#fff" onclick="steal()"/><text x="20" y="40">Head office</text></svg>').querySelector('svg')!;
  const map=extractMapDiagram(svg);
  assert.equal(map.shapes.length,2);assert.equal(map.shapes[1]?.text,"Head office");
  assert.doesNotMatch(JSON.stringify(map),/steal|https|onclick/);
  assert.equal(mapDiagramSchema.safeParse({...map,shapes:[{tag:"path",d:"https://private.example"}]}).success,false);
});

test("DOCX XML loses remote resources before the document parser sees it", async () => {
 const canonical={passages:[{body:"Original source"}]};
 const xml='<w:document><w:body><w:t>'+JSON.stringify(canonical)+'</w:t><img src="https://private.example/beacon" onerror="steal()"/></w:body></w:document>';
 const bytes=zipSync({"word/document.xml":strToU8(xml)});
 let parsed="";
 const result=await readReadingSource(new File([bytes],"source.docx",{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}),undefined,text=>{parsed=text;return read(text);});
 assert.doesNotMatch(parsed,/private\.example|steal\(\)|onerror/);
 assert.equal(result.kind,"structured");
 if(result.kind==="structured")assert.deepEqual(result.bundle,canonical);
});
