import { strFromU8 } from "fflate";
import { listeningPackageSchema, publicationBlockers, type ListeningPackage } from "./package";
import { convertLegacyPackage, slugTestId, type HtmlDocumentReader } from "./source-parser";
import {
  audioCandidates,
  chooseAudio,
  discoverTranscripts,
  ListeningImportProblem,
  textFile,
  visibleFileList,
  type AudioCandidate,
} from "./discover";

export type InspectInput = {
  entries: Record<string, Uint8Array>;
  textFiles: Record<string, string>;
  zipName: string;
  /** Staff choice after an ambiguity prompt. */
  chosenAudioPath?: string;
  /** Measures the real duration of the chosen recording (browser: <audio> metadata). */
  probeDuration: (audio: AudioCandidate, bytes: Uint8Array) => Promise<number>;
  read: HtmlDocumentReader;
};

export type InspectResult = {
  payload: ListeningPackage;
  audio: AudioCandidate;
  family: "canonical" | "legacy";
  /** Per-section transcript presence for the staff summary. */
  transcriptStatus: { section: number; present: boolean }[];
  /** Human blockers (section-specific), never a raw code. */
  blockers: { kind: "transcript_missing" | "transcript_review"; section: number }[];
  unassignedTranscriptFiles: string[];
  /** Set when data/package.json was invalid and the exam page was used instead. */
  canonicalFallback?: string;
};

function hasExamPage(textFiles: Record<string, string>): boolean {
  return Object.entries(textFiles).some(([p, v]) => /\.html?$/i.test(p) && (/(id|name)\s*=\s*["']l1["']/.test(v) || /\b(?:const|let|var)\s+(?:D|DATA)\s*=\s*\{/.test(v)));
}

/** An author's unversioned manifest is not a broken native schemaVersion package.
 * It supplies an identity only; its questions/results are never inferred or graded here. */
function isForeignAuthoredManifest(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !("schemaVersion" in value)
      && typeof value.test_id === "string" && value.test_id.length > 0
      && Array.isArray(value.sections) && value.sections.every((s: unknown) => typeof s === "string")
      && Array.isArray(value.questions) && value.questions.length > 0
      && value.answers && typeof value.answers === "object" && !Array.isArray(value.answers);
  } catch { return false; }
}

/** data/package.json → validated package; empty section transcripts are filled from real transcript files. */
function canonicalPayload(raw: string, textFiles: Record<string, string>, audio: AudioCandidate, duration: number): ListeningPackage {
  const parsed = JSON.parse(raw);
  const found = discoverTranscripts(textFiles).bySection;
  if (Array.isArray(parsed?.sections))
    for (const s of parsed.sections)
      if (s && typeof s === "object" && !String(s.transcript ?? "").trim() && found[s.number]) s.transcript = found[s.number];
  parsed.audio = { ...(parsed.audio ?? {}), path: audio.path, durationSec: duration };
  return listeningPackageSchema.parse(parsed);
}

function referencedAudio(textFiles: Record<string, string>): string | null {
  for (const name of ["data/package.json", "metadata.json", "manifest.json"]) {
    const raw = textFile(textFiles, name);
    if (!raw) continue;
    try {
      const j = JSON.parse(raw);
      const ref = j?.audio?.path ?? j?.audio_file ?? j?.audioFile ?? j?.audio;
      if (typeof ref === "string" && ref) return ref;
    } catch {
      /* an unreadable manifest is reported by the parser that needs it */
    }
  }
  return null;
}

/**
 * Canonical (data/package.json) and legacy (HTML exam page) families, in that
 * order. Every failure is a typed ListeningImportProblem carrying the file list
 * so staff see WHY, not "metadata.json missing or invalid".
 */
export async function inspectListeningPackage(input: InspectInput): Promise<InspectResult> {
  const { entries, textFiles } = input;
  const names = Object.keys(entries);
  const { candidates, rejected } = audioCandidates(entries);
  const ref = referencedAudio(textFiles);
  // A manifest that names a recording which is not in the ZIP is reported as
  // such (with the recordings that ARE present) rather than silently replaced
  // by a filename guess. Staff can then pick one explicitly.
  if (ref && !input.chosenAudioPath && candidates.length > 0) {
    const hit = chooseAudio(candidates, ref);
    if (hit.kind !== "chosen" || hit.reason !== "referenced") {
      throw new ListeningImportProblem("audio_reference_missing", { files: candidates.map((c) => c.path), info: ref });
    }
  }
  const choice = input.chosenAudioPath
    ? chooseAudio(candidates, input.chosenAudioPath)
    : chooseAudio(candidates, ref);
  if (choice.kind === "none") {
    throw new ListeningImportProblem(rejected.length ? "audio_signature_mismatch" : "no_audio", {
      files: visibleFileList(rejected.length ? rejected.map((r) => r.path) : names),
    });
  }
  if (choice.kind === "ambiguous") {
    throw new ListeningImportProblem("audio_ambiguous", { files: choice.candidates.map((c) => c.path) });
  }
  const audio = choice.audio;
  let duration: number;
  try {
    duration = await input.probeDuration(audio, entries[audio.path]!);
  } catch {
    throw new ListeningImportProblem("audio_unreadable", { files: [audio.path] });
  }

  const canonicalRaw = textFile(textFiles, "data/package.json");
  let payload: ListeningPackage;
  let family: InspectResult["family"];
  let canonicalError: string | undefined;
  const htmlPaths = Object.keys(textFiles).filter(path => /\.html?$/i.test(path));
  const entryPath = htmlPaths.find(path => /(^|\/)(index|home|hub)\.html?$/i.test(path)) ?? htmlPaths[0];
  const runnableEntry = entryPath && /<!doctype\s+html|<html\b|<body\b|<title\b/i.test(textFiles[entryPath]!);
  const runtimeFiles = Object.fromEntries(Object.entries(entries).filter(([path]) => /\.(html?|css|js)$/i.test(path)).map(([path,bytes]) => [path,textFiles[path] ?? strFromU8(bytes)]));
  try {
    if (canonicalRaw) {
      try {
        payload = canonicalPayload(canonicalRaw, textFiles, audio, duration);
        family = "canonical";
      } catch (e) {
        // An invalid data/package.json falls back to the legacy family ONLY
        // when the ZIP really contains the exam page; otherwise it is reported.
        canonicalError = e instanceof Error ? e.message.slice(0, 300) : "invalid";
        if (!hasExamPage(textFiles)) throw e;
        family = "legacy";
        payload = convertLegacyPackage(textFiles, duration, input.read, {
          audioPath: audio.path,
          fallbackTestId: slugTestId(input.zipName),
        });
      }
    } else {
      family = "legacy";
      payload = convertLegacyPackage(textFiles, duration, input.read, {
        audioPath: audio.path,
        fallbackTestId: slugTestId(input.zipName),
      });
    }
  } catch (e) {
    if (e instanceof ListeningImportProblem && !(e.code === "no_question_source" && runnableEntry && (!canonicalRaw || isForeignAuthoredManifest(canonicalRaw)))) {
      if (!e.detail.files) e.detail.files = visibleFileList(names);
      throw e;
    }
    if (entryPath && runnableEntry && (!canonicalRaw || isForeignAuthoredManifest(canonicalRaw))) {
      const doc = input.read(textFiles[entryPath]!);
      const title = (doc.querySelector("title")?.textContent || input.zipName.replace(/\.(zip|html?)$/i, "")).trim().slice(0,200);
      const authored = canonicalRaw ? JSON.parse(canonicalRaw) : null;
      canonicalError = undefined; // Valid owner runtime is a separate format, not a repaired native package.
      const vocabulary = authored?.vocabulary === undefined ? [] : listeningPackageSchema._def.schema.shape.vocabulary.parse(authored.vocabulary);
      const images = names.filter(path => /\.(png|jpe?g)$/i.test(path));
      if (images.length > 1) throw new ListeningImportProblem("package_invalid", { files: images, info: "Multiple images need an explicit supported manifest mapping" });
      payload = listeningPackageSchema.parse({schemaVersion:1,authoredRuntime:{entryPath,files:runtimeFiles},testId:slugTestId(authored?.test_id ?? input.zipName),title,category:"full",provenance:"owner_authored_html",audio:{path:audio.path,durationSec:duration},imagePath:images[0]??null,sections:[{number:1,title,transcript:""}],questions:[],keyword1:[],keyword2:[],vocabulary});
      family = "legacy";
    } else throw new ListeningImportProblem("package_invalid", {
      files: visibleFileList(names),
      info: e instanceof Error ? e.message.slice(0, 300) : undefined,
    });
  }
  if (entryPath) payload.authoredRuntime = {entryPath,files:runtimeFiles};
  // The probed recording is the truth, not a claimed manifest duration.
  payload.audio.durationSec = duration;
  payload.audio.path = audio.path;
  listeningPackageSchema.parse(payload);
  if (payload.imagePath && !entries[payload.imagePath]) {
    throw new ListeningImportProblem("map_missing", { files: [payload.imagePath] });
  }

  const blockers = publicationBlockers(payload);
  return {
    payload,
    audio,
    family,
    transcriptStatus: payload.sections.map((s) => ({ section: s.number, present: Boolean(s.transcript.trim()) })),
    blockers,
    unassignedTranscriptFiles: discoverTranscripts(textFiles).unassigned,
    ...(canonicalError ? { canonicalFallback: canonicalError } : {}),
  };
}
