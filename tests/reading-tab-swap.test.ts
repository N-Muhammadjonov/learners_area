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
