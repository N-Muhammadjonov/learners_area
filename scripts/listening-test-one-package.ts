/**
 * Build the native Listening Test 1 package from the exact private GitHub source.
 * This module reads text only, never executes authored HTML or accesses a DB/R2.
 * The resulting canonical vocabulary is ingested by the existing Listening
 * importer into lexical units/senses/occurrences, not a parallel word bank.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { convertLegacyPackage, jsonLiteral } from "../src/lib/listening/source-parser";
import { validateCanonicalListeningPackage } from "../src/lib/import/listening/canonical";

const dir = new URL("../content/listening/academic/test-01/", import.meta.url);
export type TestOneManifest = {
  id: string;
  title: string;
  collection: "academic";
  questionCount: number;
  sectionCount: number;
  audio: {
    objectKey: string;
    contentType: "audio/mpeg";
    bytes: number;
    durationSeconds: number;
    sha256: string;
  };
};

export function listeningTestOnePackage() {
  const source = readFileSync(new URL("source.html", dir), "utf8");
  const authoredData = JSON.parse(readFileSync(new URL("data.json", dir), "utf8"));
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8")) as TestOneManifest;
  if (JSON.stringify(jsonLiteral(source, "const DATA =")) !== JSON.stringify(authoredData))
    throw Error("Listening Test 1 GitHub DATA/source mismatch; refusing import");
  if (manifest.id !== "listening-test-1" || manifest.collection !== "academic" ||
    manifest.audio.objectKey !== "listening/academic/test-01/full.mp3" ||
    !/^[a-f0-9]{64}$/.test(manifest.audio.sha256))
    throw Error("Listening Test 1 manifest identity is invalid");

  const payload = convertLegacyPackage(
    { "source.html": source },
    manifest.audio.durationSeconds,
    (html) => new JSDOM(html).window.document,
    { audioPath: manifest.audio.objectKey },
  );
  if (payload.testId !== manifest.id || payload.questions.length !== manifest.questionCount ||
    payload.sections.length !== manifest.sectionCount || payload.vocabulary.length !== 20 ||
    payload.sections.some(section => !section.transcript.trim()))
    throw Error("Listening Test 1 source counts/transcripts changed; author review required");

  const result = validateCanonicalListeningPackage({
    schemaVersion: 2, module: "listening", contentType: "full_test",
    sourceRef: payload.testId, title: payload.title, language: "en",
    provenance: {
      source: "owner_authored",
      note: "Source-controlled original Test 1; vocabulary uses canonical lexical integration",
    },
    publication: { state: "draft" },
    assets: [{
      key: "audio.full", role: "audio", required: true, mimeTypes: ["audio/mpeg"],
      maxBytes: 60 * 1024 * 1024, path: "audio/full.mp3",
      sha256: manifest.audio.sha256,
    }],
    content: {
      collection: "academic",
      audio: { durationSec: payload.audio.durationSec, assetKey: "audio.full", path: "audio/full.mp3" },
      image: null, imagePath: null, mapDiagram: payload.mapDiagram ?? null,
      sections: payload.sections, questions: payload.questions,
      keyword1: payload.keyword1, keyword2: payload.keyword2,
      vocabulary: payload.vocabulary, studyPack: payload.studyPack,
    },
  });
  if (!result.ok)
    throw Error("Listening Test 1 native validation failed: " + result.issues.map(issue => issue.message).join("; "));
  return { manifest, canonical: result.pkg, stored: result.stored };
}
