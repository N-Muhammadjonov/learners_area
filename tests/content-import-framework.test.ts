import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";
import { registerImportDescriptors } from "../src/lib/import/capabilities";
import { parseContentPackage } from "../src/lib/import/core/parse";
import { canonicalHash, packageContentHash, normalizeForHash } from "../src/lib/import/core/identity";
import { listContentTypes } from "../src/lib/import/core/registry";
import {
  listeningCanonicalContentSchema,
  listeningExample,
  listeningTemplate,
  type ListeningCanonicalContent,
} from "../src/lib/import/listening/canonical";
import { readingTemplate } from "../src/lib/import/reading/canonical";
import { generalReadingBundle } from "../src/lib/reading/import-schema";

registerImportDescriptors();

const listening = () => structuredClone(listeningExample());

/** The generic parser returns module-erased content; tests narrow it the same way the handler does. */
function listeningContent(pkg: { content: unknown }): ListeningCanonicalContent {
  return listeningCanonicalContentSchema.parse(pkg.content);
}

test("CI1 a supported package version validates and reports its canonical identity", () => {
  const result = parseContentPackage(listening());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pkg.module, "listening");
  assert.equal(result.pkg.contentType, "full_test");
  assert.equal(result.pkg.schemaVersion, 2);
  const content = listeningContent(result.pkg);
  assert.equal(content.questions.length, 40);
  assert.equal(content.sections.length, 4);
  assert.equal(result.migratedFrom, undefined);
  // The published QA example is exemplary: it must not even raise authoring advice.
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    [...new Set(content.questions.map((question) => question.kind))].sort(),
    ["completion", "matching", "mcq"],
  );
});

test("CI2 an unknown future version is refused, never reinterpreted", () => {
  const result = parseContentPackage({ ...listening(), schemaVersion: 99 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "unsupported_schema_version");
  assert.match(result.report.issues[0]!.message, /99/);
});

test("CI3 malformed packages are refused with a level-1 issue", () => {
  for (const bad of [null, 42, "listening", [], { schemaVersion: 2 }, { ...listening(), content: null }]) {
    const result = parseContentPackage(bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
  }
  const missing = parseContentPackage({ ...listening(), content: { ...listening().content, sections: [] } });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "schema_invalid");
});

test("CI4 version 1 Listening payloads still import (upgraded, labelled)", () => {
  const legacyV1 = {
    schemaVersion: 1,
    testId: "listening-upgrade-check",
    title: "Upgrade check",
    category: "full",
    provenance: "teacher_authored",
    audio: { path: "audio/full.mp3", durationSec: 600 },
    imagePath: null,
    sections: [{ number: 1, title: "Part 1", transcript: "One." }],
    questions: [
      {
        number: 1,
        section: 1,
        text: "Question?",
        instruction: "Write ONE WORD.",
        options: [],
        key: "answer",
        alternatives: [],
        pair: [],
        evidence: { at: 10, why: "the speaker says answer" },
      },
    ],
    keyword1: [],
    keyword2: [],
    vocabulary: [],
  };
  const result = parseContentPackage(legacyV1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.migratedFrom, 1);
  assert.equal(result.pkg.title, "Upgrade check");
  assert.equal(result.pkg.sourceRef, "listening-upgrade-check");
  assert.equal(listeningContent(result.pkg).audio.assetKey, "audio.full");
});

test("CI5 executable markup inside educational data is refused", () => {
  const xss = listening();
  xss.content.sections[0]!.transcript = 'Hello <script>window.__pwned = 1</script>';
  const scripted = parseContentPackage(xss);
  assert.equal(scripted.ok, false);
  if (!scripted.ok) assert.equal(scripted.code, "executable_markup");

  const handler = listening();
  handler.content.questions[0]!.text = '<img src=x onerror="alert(1)">';
  assert.equal(parseContentPackage(handler).ok, false);

  const iframe = listening();
  iframe.content.sections[1]!.title = "<iframe src=https://evil.example></iframe>";
  assert.equal(parseContentPackage(iframe).ok, false);
});

test("CI6 a package cannot claim integrity it does not have — and the refusal tells the author the canonical hash", () => {
  const forged = { ...listening(), contentHash: "a".repeat(64) };
  const result = parseContentPackage(forged);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "content_hash_mismatch");
  const reported = /canonical hash: ([0-9a-f]{64})/.exec(result.report.issues[0]!.message)?.[1];
  assert.ok(reported, "the message must carry the canonical hash");

  // Pasting the hash the server reported is honoured on the next attempt.
  const pinned = { ...listening(), contentHash: reported };
  const accepted = parseContentPackage(pinned);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.ok ? [] : accepted.report.issues));
  if (accepted.ok) assert.equal(packageContentHash(accepted.pkg), reported);
});

test("CI7 hashing is order- and whitespace-insensitive, and answers change the hash", () => {
  const pkg = listening();
  const reordered = { content: JSON.parse(JSON.stringify(pkg.content)), ...omit(pkg, "content") };
  assert.equal(packageContentHash(pkg as never), packageContentHash(reordered as never));
  const padded = structuredClone(pkg.content) as { sections: { transcript: string }[] };
  padded.sections[0]!.transcript = `  ${padded.sections[0]!.transcript}\n`;
  assert.notEqual(JSON.stringify(padded), JSON.stringify(pkg.content), "the raw payloads differ");
  assert.deepEqual(normalizeForHash(padded), normalizeForHash(pkg.content), "normalized payloads agree");
  assert.equal(canonicalHash(padded), canonicalHash(pkg.content), "so their hashes agree too");
  const changed = structuredClone(pkg);
  changed.content.questions[0]!.answer = "a different answer";
  assert.notEqual(packageContentHash(pkg as never), packageContentHash(changed as never));
  assert.equal(canonicalHash({ b: 1, a: 2 }), canonicalHash({ a: 2, b: 1 }));
});

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}

test("CI8 duplicate asset keys and missing declarations are refused", () => {
  const duplicated = listening();
  duplicated.assets = [...duplicated.assets, { ...duplicated.assets[0]! }];
  const result = parseContentPackage(duplicated);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "duplicate_asset");

  const undeclared = listening();
  undeclared.assets = undeclared.assets.filter((asset) => asset.key !== "audio.full");
  const missing = parseContentPackage(undeclared);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "asset_missing");
});

test("CI9 the registry describes exactly the modules that are really wired", () => {
  const keys = listContentTypes().map((descriptor) => `${descriptor.module}:${descriptor.contentType}:v${descriptor.schemaVersion}:${descriptor.status}`);
  assert.deepEqual(keys, ["listening:full_test:v2:active", "reading:general_set:v1:active"]);
  const route = readFileSync("src/app/api/admin/content/import/route.ts", "utf8");
  assert.match(route, /registerImportFramework\(\)/);
  assert.match(route, /runContentImport\(/);
  // Structured JSON enters through an authenticated API, never through object storage.
  assert.doesNotMatch(route, /uploads\/intent|presign/);
});

test("CI10 every canonical package template validates through the real parser", () => {
  for (const template of [listeningTemplate(), readingTemplate()]) {
    const result = parseContentPackage(template);
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.report.issues));
  }
});

test("CI11 the existing authored Reading bundle still validates and keeps its identity", () => {
  const bundle = {
    sourceRef: "general-reading-ci",
    title: "CI set",
    publish: false,
    passages: [
      {
        passageNo: 1,
        title: "Passage",
        body: "Body text with the evidence sentence.",
        questions: [
          {
            questionNo: 1,
            type: "short_answer",
            text: "Question?",
            answer: "answer",
            accepted: [],
            evidence: "evidence sentence",
            explanation: "",
          },
        ],
        vocabulary: [{ word: "body", pos: "noun", def: "text", uz: "", ex: "Body text with the evidence sentence." }],
      },
    ],
  };
  assert.equal(generalReadingBundle.safeParse(bundle).success, true);
  const result = parseContentPackage({ schemaVersion: 1, ...bundle });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pkg.module, "reading");
  assert.equal(result.pkg.sourceRef, "general-reading-ci");
  assert.equal(result.migratedFrom, 1);
});

test("CI12 every canonical failure code has readable en/uz copy", () => {
  const codes = [
    "unauthenticated",
    "forbidden",
    "invalid_json",
    "invalid_input",
    "payload_too_large",
    "unsupported_schema_version",
    "unknown_content_type",
    "schema_invalid",
    "semantic_invalid",
    "executable_markup",
    "asset_missing",
    "asset_not_finalized",
    "asset_not_owned",
    "asset_mime_invalid",
    "asset_hash_mismatch",
    "content_hash_mismatch",
    "source_conflict",
    "source_already_imported",
    "duplicate_asset",
    "legacy_requires_review",
    "conversion_ambiguous",
    "schema_not_ready",
    "unknown",
  ];
  for (const code of codes) {
    for (const dict of [en, uz]) {
      const message = (dict.contentImport.problems as Record<string, string>)[code];
      assert.ok(message && message.length > 8 && !message.includes("_"), `${code} lacks readable text`);
    }
  }
  assert.ok(!JSON.stringify(uz.contentImport).match(/[\u0400-\u04FF]/), "Uzbek copy must not contain Cyrillic");
});

test("CI13 no content is executed while parsing: prototype pollution stays inert", () => {
  const hostile = JSON.parse(
    '{"schemaVersion":2,"module":"listening","contentType":"full_test","sourceRef":"polluted","title":"Polluted",' +
      '"provenance":{"source":"unknown"},"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}},' +
      '"content":{"collection":"academic","audio":{"durationSec":600,"assetKey":"audio.full"},"sections":[{"number":1,"title":"Part 1","transcript":"x"}],' +
      '"questions":[{"number":1,"section":1,"text":"Q","instruction":"i","options":[],"key":"k","alternatives":[],"pair":[],"evidence":{"at":1,"why":"w"}}],' +
      '"keyword1":[],"keyword2":[],"vocabulary":[]},"assets":[{"key":"audio.full","role":"audio","required":true,"mimeTypes":["audio/mpeg"]}]}',
  );
  // Either the strict envelope refuses the unknown keys, or they stay inert data.
  const result = parseContentPackage(hostile);
  assert.equal(({} as Record<string, unknown>).admin, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "admin"), false);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  if (result.ok) assert.equal((result.pkg as unknown as { admin?: unknown }).admin, undefined);
});
