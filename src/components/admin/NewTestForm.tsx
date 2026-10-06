"use client";

import { describeUploadError, uploadErrorMessage } from "@/lib/uploads/errors";
import { startUpload } from "@/lib/uploads/client";
import { requestJson } from "@/lib/http/client-request";
import { useEffect, useRef, useState } from "react";
import { useInstantInteraction } from "@/components/interaction/InstantInteractionProvider";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Label } from "@/components/ui/Input";
import type { Dictionary } from "@/lib/i18n/en";
import { apiErrorMessage } from "@/lib/api-error-message";

type SourceMode = "link" | "upload";

export function NewTestForm({ dict }: { dict: Dictionary }) {
  const { navigate } = useInstantInteraction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [difficultyLevel, setDifficultyLevel] = useState("B2");
  const [transcript, setTranscript] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("upload");
  const [audioType, setAudioType] = useState<"video" | "audio" | "file" | "link">("audio");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioUploadId, setAudioUploadId] = useState<string | null>(null);
  const uploadRef = useRef<ReturnType<typeof startUpload> | null>(null);
  const submitRef = useRef(false);
  useEffect(() => () => uploadRef.current?.cancel(), []);
  const [uploadedName, setUploadedName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>+ New test</Button>;

  async function onFileSelected(file: File) {
    setUploading(true);
    setError("");
    const upload = startUpload(file, { purpose: "material_primary" });
    uploadRef.current = upload;
    const result = await upload.promise;
    setUploading(false);
    if (!result.ok) { setError(uploadErrorMessage(result.failure, dict.uploadErrors) || describeUploadError(result.error, dict.uploadErrors)); return; }
    setAudioUploadId(result.uploadId);
    setAudioType("audio");
    setUploadedName(file.name);
  }

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitRef.current) return;
        submitRef.current = true;
        setPending(true); setError("");
        const result = await requestJson<{id:string}>("/api/admin/listening/tests", {
          body: { title, audioType, ...(sourceMode === "upload" ? { audioUploadId } : { audioUrl }), transcript: transcript || undefined, difficultyLevel }, timeoutMs: 12000,
        });
        setPending(false); submitRef.current = false;
        if (result.ok) navigate(`/app/admin/listening/${result.data.id}`);
        else setError(apiErrorMessage(result.error, result.status, dict));
      }}
    >
      <div>
        <Label htmlFor="title">{dict.formCopy.title}</Label>
        <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div>
        <Label htmlFor="difficultyLevel">{dict.formCopy.level}</Label>
        <select id="difficultyLevel" className="input" value={difficultyLevel} onChange={(e) => setDifficultyLevel(e.target.value)}>
          {["A2", "B1", "B2", "C1", "C2"].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div>
        <div className="mb-1.5 flex overflow-hidden rounded-sm border border-ink-100 text-xs font-medium">
          <button
            type="button"
            onClick={() => { setSourceMode("upload"); setAudioUrl(""); setAudioUploadId(null); setUploadedName(""); }}
            className={`flex-1 px-3 py-1.5 ${sourceMode === "upload" ? "bg-signal-600 text-white" : "bg-paper-raised text-ink-500"}`}
          >
            Upload audio
          </button>
          <button
            type="button"
            onClick={() => { setSourceMode("link"); setAudioUrl(""); setAudioUploadId(null); setUploadedName(""); }}
            className={`flex-1 px-3 py-1.5 ${sourceMode === "link" ? "bg-signal-600 text-white" : "bg-paper-raised text-ink-500"}`}
          >
            Link
          </button>
        </div>

        {sourceMode === "upload" ? (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelected(f); }}
            />
            <Button type="button" variant="secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? dict.common.loading : uploadedName ? `✓ ${uploadedName}` : "Choose audio file…"}
            </Button>
          </div>
        ) : (
          <Input type="url" required placeholder="https://..." value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} />
        )}
      </div>

      <div>
        <Label htmlFor="transcript">{dict.formCopy.transcriptOptional}</Label>
        <Textarea id="transcript" value={transcript} onChange={(e) => setTranscript(e.target.value)} className="min-h-[100px]" />
      </div>

      {error && <p className="text-sm text-band-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || uploading || (sourceMode === "upload" ? !audioUploadId : !audioUrl)}>{pending ? dict.common.saving : dict.common.save}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
      </div>
    </form>
  );
}
