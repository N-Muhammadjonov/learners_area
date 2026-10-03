"use client";
import { useEffect, useRef, useState } from "react";
import { scrubDocument } from "@/lib/import/reading-source";
import Link from "next/link";
import { startUpload, type UploadHandle } from "@/lib/uploads/client";
import { uploadErrorMessage } from "@/lib/uploads/errors";
import type { ListeningPackage } from "@/lib/listening/package";
import type { AudioCandidate, ImportProblemCode } from "@/lib/listening/discover";
import type { InspectResult } from "@/lib/listening/inspect";
import type { Dictionary } from "@/lib/i18n/en";

type Problem = { code: ImportProblemCode | "unknown"; files: string[]; candidates?: AudioCandidate[]; info?: string };
type Loaded = { file: File; entries: Record<string, Uint8Array>; textFiles: Record<string, string> };

const fill = (t: string, v: Record<string, string | number>) =>
  Object.entries(v).reduce((acc, [k, x]) => acc.replaceAll(`{${k}}`, String(x)), t);

/** ZIP reader errors are plain Errors; map them to staff-facing problem codes. */
function zipProblem(message: string): ImportProblemCode {
  if (/exceeds|too large/i.test(message)) return "zip_too_large";
  if (/unsafe|duplicate/i.test(message)) return "zip_unsafe";
  return "zip_unreadable";
}

export function ListeningImport({ dict }: { dict: Pick<Dictionary, "listeningImport" | "uploadErrors"> }) {
  const t = dict.listeningImport;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [result, setResult] = useState<(InspectResult & { image: File | null; audioFile: File }) | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [collection, setCollection] = useState<NonNullable<ListeningPackage["collection"]>>("academic");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "check" | "upload">("");
  const [progress, setProgress] = useState(0);
  const [id, setId] = useState("");
  const handles = useRef<UploadHandle[]>([]);
  const lifetime = useRef(new AbortController());
  const request = useRef<AbortController | null>(null);
  const flight = useRef(false);
  useEffect(
    () => {
      if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
      const uploads = handles.current;
      const controller = lifetime.current;
      return () => {
        controller.abort();
        uploads.forEach((h) => h.cancel());
        request.current?.abort();
      };
    },
    [],
  );

  async function readZip(file: File) {
    const signal = lifetime.current.signal;
    setLoaded(null);
    setResult(null);
    setProblem(null);
    setId("");
    setError("");
    setBusy("check");
    try {
      const { readListeningZipAsync } = await import("@/lib/listening/zip");
      const { entries, textFiles } = await readListeningZipAsync(new Uint8Array(await file.arrayBuffer()), signal);
      if (signal.aborted) return;
      const next = { file, entries, textFiles };
      setLoaded(next);
      await inspect(next);
    } catch (e) {
      if (signal.aborted) return;
      setProblem({ code: zipProblem(e instanceof Error ? e.message : ""), files: [] });
    } finally {
      if (!signal.aborted) setBusy("");
    }
  }

  async function inspect(source: Loaded, chosenAudioPath?: string) {
    const signal = lifetime.current.signal;
    setProblem(null);
    setBusy("check");
    try {
      const [{ inspectListeningPackage }, { ListeningImportProblem }] = await Promise.all([
        import("@/lib/listening/inspect"),
        import("@/lib/listening/discover"),
      ]);
      if (signal.aborted) return;
      try {
        const inspected = await inspectListeningPackage({
          entries: source.entries,
          textFiles: source.textFiles,
          zipName: source.file.name,
          chosenAudioPath,
          probeDuration: (audio, bytes) => probeAudio(new File([new Uint8Array(bytes)], audio.path.split("/").pop()!, { type: audio.mimeType }), signal),
          read: (html) => new DOMParser().parseFromString(scrubDocument(html), "text/html"),
        });
        if (signal.aborted) return;
        const audioBytes = source.entries[inspected.audio.path]!;
        const audioFile = new File([new Uint8Array(audioBytes)], `full.${inspected.audio.format}`, { type: inspected.audio.mimeType });
        const imageBytes = inspected.payload.imagePath ? source.entries[inspected.payload.imagePath] : null;
        const image = imageBytes ? imageFile(imageBytes) : null;
        if (imageBytes && !image) {
          setProblem({ code: "map_missing", files: [inspected.payload.imagePath!] });
          return;
        }
        setCollection(inspected.payload.collection ?? "academic");
        setResult({ ...inspected, audioFile, image });
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof ListeningImportProblem) {
          const candidates = e.code === "audio_ambiguous" || e.code === "audio_reference_missing"
            ? (await import("@/lib/listening/discover")).audioCandidates(source.entries).candidates
            : undefined;
          if (signal.aborted) return;
          setProblem({ code: e.code, files: e.detail.files ?? [], candidates, info: e.detail.info });
        } else {
          setProblem({ code: "unknown", files: [] });
        }
      }
    } finally {
      if (!signal.aborted) setBusy("");
    }
  }

  async function upload() {
    const signal = lifetime.current.signal;
    if (!result || flight.current) return;
    flight.current = true;
    setBusy("upload");
    setError("");
    setProgress(0);
    try {
      const audio = startUpload(result.audioFile, { purpose: "material_primary", onProgress: pct => {if (!signal.aborted) setProgress(pct);} });
      handles.current.push(audio);
      const a = await audio.promise;
      if (signal.aborted) return;
      if (!a.ok) {
        setError(uploadErrorMessage(a.failure, dict.uploadErrors));
        return;
      }
      let imageUploadId: string | null = null;
      if (result.image) {
        const h = startUpload(result.image, { purpose: "material_primary" });
        handles.current.push(h);
        const r = await h.promise;
        if (signal.aborted) return;
        if (!r.ok) {
          setError(uploadErrorMessage(r.failure, dict.uploadErrors));
          return;
        }
        imageUploadId = r.uploadId;
      }
      const controller = new AbortController();
      request.current = controller;
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch("/api/admin/listening/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ payload: { ...result.payload, collection }, audioUploadId: a.uploadId, imageUploadId }),
        });
        const data = await res.json().catch(() => ({}));
        if (signal.aborted) return;
        if (controller.signal.aborted) throw new DOMException("Timed out", "TimeoutError");
        if (!res.ok) {
          const code = String(data.error ?? "unknown") as keyof typeof t.importErrors;
          const ref = typeof data.correlationId === "string" ? ` (ref ${data.correlationId.slice(0, 16)})` : "";
          setError((t.importErrors[code] ?? t.importErrors.unknown) + ref);
          return;
        }
        setId(data.id);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      if (!signal.aborted) setError(t.importErrors.unknown);
    } finally {
      flight.current = false;
      if (!signal.aborted) setBusy("");
    }
  }

  return (
    <div className="card space-y-4" data-listening-import>
      <h1 className="font-display text-xl">{t.title}</h1>
      <p>{t.intro}</p>
      <label className="block">
        {t.collection}
        <select
          className="input"
          value={collection}
          disabled={!!busy}
          onChange={(e) => setCollection(e.target.value as NonNullable<ListeningPackage["collection"]>)}
        >
          <option value="essential">Essential Recordings</option>
          <option value="academic">Academic Listening</option>
          <option value="general">General Listening</option>
          <option value="question_types">Question types</option>
          <option value="mcq">MCQ Mastery</option>
        </select>
      </label>
      <label className="block">
        {t.zipLabel}
        <input
          className="mt-2 block"
          type="file"
          accept=".zip,application/zip"
          disabled={!!busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readZip(file);
          }}
        />
      </label>
      {busy && (
        <p role="status">{busy === "check" ? t.checking : fill(t.uploading, { pct: progress > 0 ? `${progress}%` : "" })}</p>
      )}

      {problem && (
        <div role="alert" className="space-y-2 rounded-lg border border-red-300 p-3" data-import-problem={problem.code}>
          <p className="font-medium text-red-700">{fill(t.problems[problem.code] ?? t.problems.unknown, { ref: problem.info ?? "" })}</p>
          {(problem.code === "audio_ambiguous" || problem.code === "audio_reference_missing") && loaded && problem.candidates && (
            <fieldset className="space-y-2" data-audio-selector>
              <legend>{t.chooseAudio}</legend>
              {problem.candidates.map((c) => (
                <button
                  key={c.path}
                  type="button"
                  className="btn-secondary block min-h-11 w-full text-left"
                  disabled={!!busy}
                  onClick={() => void inspect(loaded, c.path)}
                >
                  {c.path} · {c.format} · {(c.size / 1048576).toFixed(1)} MB — {t.useAudio}
                </button>
              ))}
            </fieldset>
          )}
          {problem.files.length > 0 && !problem.candidates && (
            <>
              <p className="text-sm">{t.filesInZip}</p>
              <ul className="list-disc pl-5 text-sm" data-import-files>
                {problem.files.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-red-700">{error}</p>}

      {result && (
        <>
          <label className="block">
            {t.testTitle}
            <input
              className="input mt-1"
              value={result.payload.title}
              onChange={(e) => setResult({ ...result, payload: { ...result.payload, title: e.target.value } })}
            />
          </label>
          <p>
            {fill(t.summary, {
              q: result.payload.questions.length,
              s: result.payload.sections.length,
              m: Math.round(result.payload.audio.durationSec / 60),
              v: result.payload.vocabulary.length,
            })}
          </p>
          <p className="text-sm">{fill(t.family, { family: result.family === "canonical" ? t.familyCanonical : t.familyLegacy })}</p>
          {result.canonicalFallback && <p role="status" className="text-sm" data-canonical-fallback>{t.canonicalFallback}</p>}
          <p className="text-sm">{fill(t.audioUsed, { path: result.audio.path, format: result.audio.format })}</p>
          <div data-transcript-summary>
            <p className="font-medium">{t.transcripts}</p>
            <ul className="text-sm">
              {result.transcriptStatus.map((s) => (
                <li key={s.section} data-transcript-section={s.section} data-present={s.present}>
                  {fill(t.sectionN, { n: s.section })}: {s.present ? t.present : t.missing}
                </li>
              ))}
            </ul>
            {result.unassignedTranscriptFiles.length > 0 && (
              <p className="text-sm">{fill(t.unassigned, { files: result.unassignedTranscriptFiles.join(", ") })}</p>
            )}
          </div>
          {result.blockers.length > 0 && (
            <div role="status" data-publication-blockers>
              <strong>{t.blockedTitle}</strong>
              <ul>
                {result.blockers.map((b) => (
                  <li key={`${b.kind}-${b.section}`}>
                    {fill(b.kind === "transcript_missing" ? t.blockMissing : t.blockReview, { n: b.section })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className="btn-primary" disabled={!!busy || !!id} onClick={() => void upload()}>
            {t.upload}
          </button>
        </>
      )}
      {id && (
        <p role="status">
          {t.saved}{" "}
          <Link className="btn-secondary" href={`/listening/tests/${id}`}>{t.open}</Link>
        </p>
      )}
    </div>
  );
}

function imageFile(bytes: Uint8Array): File | null {
  const png = bytes[0] === 137 && bytes[1] === 80;
  const jpg = bytes[0] === 255 && bytes[1] === 216;
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!png && !jpg && !webp) return null;
  const [name, type] = png ? ["map.png", "image/png"] : jpg ? ["map.jpg", "image/jpeg"] : ["map.webp", "image/webp"];
  return new File([new Uint8Array(bytes)], name, { type });
}

export async function probeAudio(file: File, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.preload = "metadata";
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    };
    const onAbort = () => {cleanup(); reject(new DOMException("Aborted", "AbortError"));};
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Audio metadata timeout"));
    }, 15000);
    audio.onloadedmetadata = () => {
      const seconds = audio.duration;
      cleanup();
      Number.isFinite(seconds) && seconds > 0
        ? resolve(seconds)
        : reject(new Error("Audio duration invalid"));
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("Audio unreadable"));
    };
    signal?.addEventListener("abort", onAbort, {once: true});
    audio.src = url;
  });
}
