// Legacy swap semantics survive Reading V4's dedicated product routes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { READING_DESTINATIONS, readingLegacyDestination } from "../src/lib/reading/destinations";
import { resolveReadingTab } from "../src/lib/reading/tabs";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";
const read=(file:string)=>readFileSync(file,"utf8");
const root=read("src/app/app/(shell)/reading/page.tsx");
const general=read("src/app/app/(shell)/reading/general/page.tsx");
const library=read("src/components/reading/ReadingLearningLibrary.tsx");
test("R1 V4 replaces mixed tabs with exactly five products; History is secondary",()=>{
 assert.deepEqual(READING_DESTINATIONS,["lessons","academic","general","question-types","retention"]);
 assert.match(root,/READING_DESTINATIONS.map/);assert.match(root,/data-reading-history-entry/);
 assert.doesNotMatch(root,/tabGeneral|General Training|listLibrary|listGeneralSets/);
});
test("R2 General retains URL-backed, independently streamed bounded learning library",()=>{
 assert.match(general,/<ReadingLearningLibrary/);
 assert.match(library,/captureRegion\(listLearningLibrary\(userId,\s*filter\)\)/);
 assert.match(library,/captureRegion\(listLibraryFacets\(true\)\)/);
 assert.match(library,/ReadingFiltersRegion/);assert.match(library,/data-reading-page-next/);
 assert.match(read("src/lib/data/reading-library.ts"),/limit \$\{READING_PAGE_SIZE\} offset/);
});
test("R3 Academic discovers genuine formal sets, not standalone passages or learning library",()=>{
 const academic=read("src/app/app/(shell)/reading/academic/page.tsx");
 assert.match(academic,/academic: true/);assert.match(academic,/data-academic-set/);
 assert.doesNotMatch(academic,/ReadingFiltersRegion|listLibrary|StartPassageButton/);
});
test("R4 both locales name all five products distinctly",()=>{
 for(const d of [en,uz]){
  assert.equal(d.readingV4.products.academic.title,"Academic Reading");
  assert.equal(d.readingV4.products.general.title,"General Reading");
  for(const key of READING_DESTINATIONS)assert.ok(d.readingV4.products[key].hint);
 }
});
test("R5 actual old semantics remain compatible, including raw-type filter bookmarks",()=>{
 assert.equal(resolveReadingTab({tab:"practice"}),"academic");
 assert.equal(readingLegacyDestination({tab:"practice"}),"/app/reading/academic");
 assert.equal(readingLegacyDestination({tab:"general"}),"/app/reading");
 assert.equal(readingLegacyDestination({q:"climate",type:"MH",page:"2"}),"/app/reading/general?q=climate&type=MH&page=2");
 assert.equal(readingLegacyDestination({}),null);
});
test("R6 filters/pagination/reset stay on General without a redundant tab round trip",()=>{
 const filters=read("src/components/reading/ReadingFilters.tsx");
 assert.match(filters,/usePathname\(\)/);assert.match(filters,/\$\{pathname\}\?\$\{queryString\}/);
 assert.match(library,/href="\/app\/reading\/general" className="btn-secondary" data-reading-empty-reset/);
 assert.match(library,/`\/app\/reading\/general\?\$\{search.toString\(\)\}`/);
 assert.doesNotMatch(library,/tab="general-reading"/);
});

test("R2 the passage library (search, filters, pages) is rendered and queried under General Reading", () => {
  const general = panel("general-reading");
  assert.match(general, /data-reading-library/);
  assert.match(general, /ReadingFiltersRegion/);
  assert.match(page, /tab === "general-reading"\s*\?\s*captureRegion\(listLearningLibrary\(userId, filter\)\)/);
  assert.doesNotMatch(panel("academic"), /ReadingFiltersRegion|listLibrary/);
});

test("R3 the guided reading sets moved under Academic; General Training, Types and Retention are kept", () => {
  assert.match(panel("academic"), /GeneralSetsRegion/);
  assert.match(panel("general"), /data-reading-general/);
  assert.match(page, /tab === "types"/);
  assert.match(panel("retention"), /\/reading\/retention/);
});

test("R4 the subtitle follows the selected tab in both languages", () => {
  assert.match(page, /data-reading-subtitle=\{tab\}>\{READING_SUBTITLE\[tab\]\(dict\)\}/);
  assert.doesNotMatch(page, /subtitleWithCount/);
  for (const d of [en, uz]) {
    assert.match(d.readingHub.subtitleAcademic, /^Academic Reading/);
    assert.match(d.readingHub.subtitleGeneralReading, /^General Reading/);
    assert.notEqual(d.readingHub.subtitleAcademic, d.readingHub.subtitleGeneralReading);
  }
});

test("R5 URL resolution: default Academic, legacy ?tab=practice → Academic, filters → General Reading", () => {
  assert.equal(resolveReadingTab({}), "academic");
  assert.equal(resolveReadingTab({ tab: "practice" }), "academic");
  assert.equal(resolveReadingTab({ tab: "general-reading" }), "general-reading");
  assert.equal(resolveReadingTab({ type: "matching" }), "general-reading");
  assert.equal(resolveReadingTab({ q: "climate" }), "general-reading");
  assert.equal(resolveReadingTab({ tab: "general" }), "general");
  assert.equal(resolveReadingTab({ tab: "nonsense" }), "academic");
});

test("R6 every library link keeps the General Reading tab (filters, pages, type cards, reset)", () => {
  const filters = readFileSync("src/components/reading/ReadingFilters.tsx", "utf8");
  assert.match(filters, /new URLSearchParams\(tab \? \{ tab \} : \{\}\)/);
  assert.match(page, /tab="general-reading"/);
  assert.match(page, /new URLSearchParams\(\{ tab: "general-reading" \}\)/);
  assert.match(page, /\/reading\?tab=general-reading&type=/);
  assert.match(page, /href="\/reading\?tab=general-reading" className="btn-secondary" data-reading-empty-reset/);
});
