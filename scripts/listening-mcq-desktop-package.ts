/** Inert conversion of the owner's thirty source-controlled MCQ documents. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { validateCanonicalListeningPackage } from "../src/lib/import/listening/canonical";
import { MCQ_PROGRAM_REF } from "../src/lib/listening/mcq-program";
import { jsonLiteral } from "../src/lib/listening/source-parser";

export type McqMedia = {
  question: number; path: string; objectKey: string; mimeType: "audio/mpeg";
  bytes: number; sha256: string; present: boolean; durationSeconds: number;
};
export type McqManifest = {
  day: number; sourceRef: string; originalFilename: string; originalSha256: string;
  sourceSha256: string; questionsSha256: string; questionCount: number; media: McqMedia[];
};
type SourceQuestion = {
  q: number | string; prompt: string; options: { code: string; text: string }[];
  answer: string | string[]; evidence: string; why: string; trap: string; explanation: string;
  audio: string;
};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export function listeningMcqDesktopPackage(day: number) {
  if (!Number.isInteger(day) || day < 1 || day > 30) throw Error("Invalid owner MCQ day");
  const dir = new URL(`../content/listening/mcq/day-${String(day).padStart(2, "0")}/`, import.meta.url);
  const source = readFileSync(new URL("source.html", dir));
  const questionsBytes = readFileSync(new URL("questions.json", dir));
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8")) as McqManifest;
  const questions = JSON.parse(questionsBytes.toString("utf8")) as SourceQuestion[];
  if (JSON.stringify(jsonLiteral(source.toString("utf8"), "const QUESTIONS =")) !== JSON.stringify(questions))
    throw Error(`MCQ day ${day}: HTML and question data disagree`);
  if (manifest.day !== day || manifest.sourceRef !== `listening-mcq-day-${String(day).padStart(2, "0")}` ||
    hash(source) !== manifest.sourceSha256 || hash(questionsBytes) !== manifest.questionsSha256 ||
    manifest.questionCount !== 5 || questions.length !== 5 || manifest.media.length !== 5 ||
    /data:audio\//i.test(source.toString("utf8"))) throw Error(`MCQ day ${day}: source integrity mismatch`);
  for (const [index, question] of questions.entries()) {
    const media = manifest.media[index];
    if (!media?.present || media.question !== index + 1 || media.path !== question.audio ||
      media.objectKey !== `listening/mcq/day-${String(day).padStart(2, "0")}/question-${String(index + 1).padStart(2, "0")}.mp3` ||
      media.mimeType !== "audio/mpeg" || media.bytes < 1000 || !/^[a-f0-9]{64}$/.test(media.sha256) ||
      !(media.durationSeconds > 0) || question.options.some((option, at) => option.code !== String.fromCharCode(65 + at)))
      throw Error(`MCQ day ${day}, question ${index + 1}: invalid recording/options`);
    const answers = Array.isArray(question.answer) ? question.answer : [question.answer];
    if (!answers.length || new Set(answers).size !== answers.length || answers.some(code => !question.options.some(o => o.code === code)))
      throw Error(`MCQ day ${day}, question ${index + 1}: invalid source key`);
  }
  const primary = manifest.media[0]!;
  const result = validateCanonicalListeningPackage({
    schemaVersion: 2, module: "listening", contentType: "full_test", sourceRef: manifest.sourceRef,
    title: `DAY ${day} MCQ`, language: "en", publication: { state: "draft" },
    provenance: { source: "owner_authored", originalFilename: manifest.originalFilename,
      note: `Owner Desktop MCQ document; original SHA256 ${manifest.originalSha256}. Source question labels retained in questions.json; programme order 1–5.` },
    assets: manifest.media.map(media => ({
      key: media.question === 1 ? "audio.full" : `audio.question${media.question}`,
      role: "audio", required: true, mimeTypes: [media.mimeType], path: media.path,
      sha256: media.sha256, maxBytes: 2 * 1024 * 1024,
    })),
    content: {
      collection: "mcq", programme: { ref: MCQ_PROGRAM_REF, day },
      audio: { path: primary.path, assetKey: "audio.full", durationSec: primary.durationSeconds },
      sections: [{ number: 1, title: `DAY ${day}`, transcript: "" }],
      questions: questions.map((question, index) => ({
        number: index + 1, section: 1, kind: "mcq",
        typeCode: Array.isArray(question.answer) ? "mcq_multi" : "mcq_single",
        text: question.prompt, instruction: Array.isArray(question.answer) ? "Choose TWO letters." : "Choose ONE letter.",
        options: question.options.map(option => `${option.code}) ${option.text}`),
        key: Array.isArray(question.answer) ? question.answer.join(",") : question.answer,
        alternatives: [], pair: [],
        evidence: { at: 0, why: [question.evidence, question.why, question.trap, question.explanation].join("\n\n") },
      })),
      keyword1: [], keyword2: [], vocabulary: [],
    },
  });
  if (!result.ok) throw Error(`MCQ day ${day}: ${result.issues.map(issue => issue.message).join("; ")}`);
  return { manifest, canonical: result.pkg, stored: result.stored };
}
