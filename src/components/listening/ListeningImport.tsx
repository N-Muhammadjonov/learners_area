"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { startUpload, type UploadHandle } from "@/lib/uploads/client";
import { convertLegacyPackage } from "@/lib/listening/source-parser";
import {
  listeningPackageSchema,
  publicationIssues,
  type ListeningPackage,
} from "@/lib/listening/package";

export function ListeningImport() {
  const [bundle, setBundle] = useState<{
    payload: ListeningPackage;
    audio: File;
    image: File | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [id, setId] = useState("");
  const handles = useRef<UploadHandle[]>([]);
  const request = useRef<AbortController | null>(null);
  const flight = useRef(false);
  useEffect(
    () => () => {
      handles.current.forEach((h) => h.cancel());
      request.current?.abort();
    },
    [],
  );
  async function inspect(file: File) {
    setBundle(null);
    setId("");
    setError("");
    setBusy(true);
    try {
      const { readListeningZipAsync } = await import("@/lib/listening/zip");
      const { entries, textFiles } = await readListeningZipAsync(
        new Uint8Array(await file.arrayBuffer()),
      );
      const metadata = JSON.parse(
        textFiles["metadata.json"] ?? textFiles["manifest.json"] ?? "null",
      );
      const audioPath = metadata?.audio_file ?? metadata?.audio?.path;
      const bytes = entries[audioPath];
      if (!bytes) throw new Error("Canonical MP3 missing");
      if (
        !/\.mp3$/i.test(audioPath) ||
        !(
          (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) ||
          (bytes[0] === 255 && (bytes[1]! & 224) === 224)
        )
      )
        throw new Error("Unreadable MP3 signature");
      const audio = new File([new Uint8Array(bytes)], "full.mp3", {
        type: "audio/mpeg",
      });
      const duration = await probeAudio(audio);
      const payload = textFiles["data/package.json"]
        ? listeningPackageSchema.parse(
            JSON.parse(textFiles["data/package.json"]),
          )
        : convertLegacyPackage(textFiles, duration, (html) =>
            new DOMParser().parseFromString(html, "text/html"),
          );
      // Trust the probed recording, not a source QA report or claimed manifest duration.
      payload.audio.durationSec = duration;
      listeningPackageSchema.parse(payload);
      const imageBytes = payload.imagePath ? entries[payload.imagePath] : null;
      if (payload.audio.path !== audioPath)
        throw new Error("Manifest audio path mismatch");
      if (payload.imagePath && !imageBytes)
        throw new Error("Required map missing");
      const mime =
        imageBytes && imageBytes[0] === 137 && imageBytes[1] === 80
          ? "image/png"
          : "image/jpeg";
      if (
        imageBytes &&
        mime === "image/jpeg" &&
        !(imageBytes[0] === 255 && imageBytes[1] === 216)
      )
        throw new Error("Unsupported map format");
      const image = imageBytes
        ? new File(
            [new Uint8Array(imageBytes)],
            mime === "image/png" ? "map.png" : "map.jpg",
            { type: mime },
          )
        : null;
      setBundle({ payload, audio, image });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid package");
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!bundle || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const audio = startUpload(bundle.audio, {
        purpose: "material_primary",
        onProgress: setProgress,
      });
      handles.current.push(audio);
      const a = await audio.promise;
      if (!a.ok) throw new Error(a.error);
      let imageUploadId: string | null = null;
      if (bundle.image) {
        const h = startUpload(bundle.image, { purpose: "material_primary" });
        handles.current.push(h);
        const result = await h.promise;
        if (!result.ok) throw new Error(result.error);
        imageUploadId = result.uploadId;
      }
      const controller = new AbortController();
      request.current = controller;
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch("/api/admin/listening/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            payload: bundle.payload,
            audioUploadId: a.uploadId,
            imageUploadId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Import failed");
        setId(data.id);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="card space-y-4">
      <h2 className="font-display text-xl">Add Listening · ZIP</h2>
      <p>
        To&#39;rtta bo&#39;lim, 40 savol, beshta mashq. HTML skriptlari ishga
        tushirilmaydi. Import avval draft sifatida saqlanadi.
      </p>
      <label className="block">
        Listening ZIP
        <input
          className="mt-2 block"
          type="file"
          accept=".zip"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void inspect(file);
          }}
        />
      </label>
      {busy && (
        <p role="status">
          Tekshirish / yuklash… {progress > 0 ? `${progress}%` : ""}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {bundle && (
        <>
          <label>
            Test nomi
            <input
              className="input mt-1"
              value={bundle.payload.title}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  payload: { ...bundle.payload, title: e.target.value },
                })
              }
            />
          </label>
          <p>
            {bundle.payload.questions.length} savol ·{" "}
            {bundle.payload.sections.length} bo&#39;lim ·{" "}
            {Math.round(bundle.payload.audio.durationSec / 60)} daqiqa · 5 mashq
            · {bundle.payload.vocabulary.length} so&#39;z
          </p>
          {publicationIssues(bundle.payload).length > 0 && (
            <div role="status">
              <strong>Nashr qilish bloklangan:</strong>
              <ul>
                {publicationIssues(bundle.payload).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <p>To&#39;liq transcript qo&#39;shilmaguncha faqat QA draft.</p>
            </div>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !!id}
            onClick={() => void upload()}
          >
            Upload QA draft
          </button>
        </>
      )}
      {id && (
        <p role="status">
          Draft saqlandi.{" "}
          <Link className="btn-secondary" href={`/listening/tests/${id}`}>
            QA testni ochish
          </Link>
        </p>
      )}
    </div>
  );
}
async function probeAudio(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  audio.preload = "metadata";
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    };
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
    audio.src = url;
  });
}
