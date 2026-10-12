import "server-only";
import { getStorageService } from "../../storage";
import { isSafeObjectKey } from "@/lib/validation/uploads";
import { providerFail } from "../types";
import type { SpeechToTextProvider } from "./types";

export const openAiSttProvider: SpeechToTextProvider = {
  id: "openai", displayName: "OpenAI Transcription", version: "1", type: "external",
  capabilities: ["speech-to-text", "audio-input"], requiredSecrets: ["OPENAI_API_KEY", "OPENAI_STT_MODEL"],
  async transcribe(request) {
    const key = process.env.OPENAI_API_KEY?.trim();
    const model = process.env.OPENAI_STT_MODEL?.trim();
    if (!key || !model) return providerFail("not_configured", "OpenAI key and transcription model are required");
    if (!isSafeObjectKey(request.objectKey)) return providerFail("provider_error", "Invalid recording key");
    try {
      // Authorization belongs to the speaking service before this adapter is called.
      // Read private bytes, never send an object key or signed storage URL to the vendor.
      const stored = await getStorageService().read(request.objectKey);
      if (!stored || !stored.body.length || stored.body.length > 24 * 1024 * 1024) return providerFail("provider_error", "Recording is missing or exceeds the transcription limit");
      const type = (stored.contentType.split(";")[0] ?? "").trim();
      const extensions: Record<string, string> = { "audio/webm": "webm", "video/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac" };
      if (!extensions[type]) return providerFail("capability_missing", "Recording format is unsupported");
      const form = new FormData();
      form.set("model", model); form.set("response_format", "json"); form.set("language", request.language);
      form.set("file", new Blob([new Uint8Array(stored.body)], { type }), `recording.${extensions[type]}`);
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
        signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      });
      if (!response.ok) return providerFail(response.status === 401 || response.status === 403 ? "auth_failed" : response.status === 429 ? "rate_limited" : "provider_error", "OpenAI transcription request failed", response.status >= 500);
      const raw = await response.text();
      if (raw.length > 100_000) return providerFail("invalid_response", "Transcription response is too large");
      const result = JSON.parse(raw) as { text?: unknown };
      if (typeof result.text !== "string" || !result.text.trim() || result.text.length > 40_000) return providerFail("invalid_response", "No valid transcript was returned");
      return { ok: true, providerId: "openai", providerDisplayName: "OpenAI Transcription", transcript: result.text.trim(), confidence: null };
    } catch {
      return providerFail(request.signal?.aborted ? "cancelled" : "network", "OpenAI transcription could not complete", !request.signal?.aborted);
    }
  },
};
