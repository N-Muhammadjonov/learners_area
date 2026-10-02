// R1–R6: Academic / General Reading swap (owner decision 2026-10-02).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { READING_TABS, resolveReadingTab } from "../src/lib/reading/tabs";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

const page = readFileSync("src/app/(app)/reading/page.tsx", "utf8");
const panel = (key: string) => {
  const start = page.indexOf(`{tab === "${key}"`);
  assert.ok(start > 0, `panel for ${key}`);
  return page.slice(start, page.indexOf("\n      )}", start));
};

test("R1 tab order: Academic, General Reading, General Training, Question Types, Retention", () => {
  assert.deepEqual([...READING_TABS], ["academic", "general-reading", "general", "types", "retention"]);
  assert.match(page, /\{ key: "academic", label: dict\.readingHub\.tabAcademic \}[\s\S]*\{ key: "general-reading", label: dict\.readingHub\.tabPractice \}/);
  assert.equal(en.readingHub.tabPractice, "General Reading");
});

test("R2 the passage library (search, filters, pages) is rendered and queried under General Reading", () => {
  const general = panel("general-reading");
  assert.match(general, /data-reading-library/);
  assert.match(general, /ReadingFiltersRegion/);
  assert.match(page, /tab === "general-reading"\s*\?\s*captureRegion\(listLibrary\(userId, filter\)\)/);
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
