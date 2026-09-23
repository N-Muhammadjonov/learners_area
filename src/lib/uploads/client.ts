import {
  acceptAttribute,
  maxBytesLabel,
  validateUploadFile,
  type UploadCategory,
} from "@/lib/validation/uploads";

/**
 * Browser-side upload engine.
 *
 * The flow mirrors the server lifecycle exactly:
 *
 *   1. POST /api/uploads/intent      → server authorizes and hands back a
 *                                      short-lived presigned PUT for ONE
 *                                      server-generated object key
 *   2. PUT the bytes straight to R2  → direct, never through our server.
 *                                      (local disk: POST /api/uploads instead,
 *                                      same intent, same finalize)
 *   3. POST /api/uploads/finalize    → server HEADs the object, checks type and
 *                                      size, and only then marks it usable
 *
 * Real progress comes from XMLHttpRequest's `upload.onprogress`. `fetch()` has
 * no upload-progress event, so XHR is used deliberately and only here. There is
 * no animated or simulated percentage anywhere — the number is bytes sent over
 * the wire divided by bytes total.
 *
 * Every file gets an explicit state (queued / uploading / finalizing /
 * complete / failed / cancelled), and a failure in one file never discards the
 * files that succeeded: each upload is independent.
 */

export type UploadState = "queued" | "uploading" | "finalizing" | "complete" | "failed" | "cancelled";

export type UploadOutcome = { ok: true; uploadId: string; objectKey: string } | { ok: false; error: string };

export type StartUploadOptions = {
  purpose: "material_primary" | "material_block";
  blockKind?: "image" | "audio" | "file";
  materialId?: string;
  onState?: (state: UploadState) => void;
  onProgress?: (percent: number) => void;
};

export type UploadHandle = {
  promise: Promise<UploadOutcome>;
  /** Aborts the in-flight request and asks the server to drop the object. */
  cancel: () => void;
};

/** Client-side pre-flight, so the user sees a problem before any bytes move. */
export function preflight(file: File, category: UploadCategory): { ok: true } | { ok: false; error: string } {
  const result = validateUploadFile({
    filename: file.name,
    contentType: file.type,
    size: file.size,
    category,
  });
  if (result.ok) return { ok: true };
  if (result.error === "file_too_large") {
    return { ok: false, error: `file_too_large:${maxBytesLabel(category)}` };
  }
  return { ok: false, error: "unsupported_type" };
}

export function startUpload(file: File, options: StartUploadOptions): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let cancelled = false;
  let uploadId: string | null = null;

  const setState = (state: UploadState) => {
    if (!cancelled) options.onState?.(state);
  };

  const promise = (async (): Promise<UploadOutcome> => {
    setState("queued");

    // --- 1. Intent ---------------------------------------------------------
    let intent: {
      uploadId: string;
      objectKey: string;
      mode: "direct" | "proxy";
      uploadUrl: string | null;
      contentType: string;
    };
    try {
      const res = await fetch("/api/uploads/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: options.purpose,
          blockKind: options.blockKind,
          materialId: options.materialId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: String(data.error ?? "intent_failed") };
      intent = data as typeof intent;
      uploadId = intent.uploadId;
    } catch {
      return { ok: false, error: "network_error" };
    }
    if (cancelled) return { ok: false, error: "cancelled" };

    // --- 2. Bytes ----------------------------------------------------------
    setState("uploading");
    const put = await sendBytes(file, intent, options.onProgress);
    if (cancelled) {
      void discardUpload(uploadId);
      return { ok: false, error: "cancelled" };
    }
    if (!put.ok) {
      // The bytes never landed. Leave the intent for abandoned-upload cleanup
      // rather than firing a delete that could race the PUT itself.
      return { ok: false, error: put.error };
    }

    // --- 3. Finalize -------------------------------------------------------
    setState("finalizing");
    try {
      const res = await fetch("/api/uploads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: intent.uploadId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: String(data.error ?? "finalize_failed") };
    } catch {
      return { ok: false, error: "network_error" };
    }
    if (cancelled) return { ok: false, error: "cancelled" };

    setState("complete");
    return { ok: true, uploadId: intent.uploadId, objectKey: intent.objectKey };
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      xhr?.abort();
      if (uploadId) void discardUpload(uploadId);
    },
  };

  async function sendBytes(
    file: File,
    intent: { mode: "direct" | "proxy"; uploadUrl: string | null; uploadId: string; contentType: string },
    onProgress?: (percent: number) => void
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const request = new XMLHttpRequest();
      xhr = request;

      request.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      });
      request.addEventListener("load", () => {
        if (request.status >= 200 && request.status < 300) {
          onProgress?.(100);
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: readError(request) });
        }
      });
      request.addEventListener("error", () => resolve({ ok: false, error: "network_error" }));
      request.addEventListener("abort", () => resolve({ ok: false, error: "cancelled" }));
      request.addEventListener("timeout", () => resolve({ ok: false, error: "upload_timeout" }));

      if (intent.mode === "direct" && intent.uploadUrl) {
        // Straight to the bucket. Only the content type the server signed for
        // is sent — anything else invalidates the signature.
        request.open("PUT", intent.uploadUrl);
        request.setRequestHeader("Content-Type", intent.contentType);
        request.send(file);
      } else {
        // Local disk provider: the bytes have to reach our server, but the
        // intent is still the authority for the key, size and type.
        const form = new FormData();
        form.append("uploadId", intent.uploadId);
        form.append("file", file);
        request.open("POST", "/api/uploads");
        request.send(form);
      }
    });
  }
}

async function discardUpload(uploadId: string): Promise<void> {
  try {
    await fetch(`/api/uploads/${uploadId}`, { method: "DELETE" });
  } catch {
    /* best effort — the intent expires and cleanup reclaims the object */
  }
}

function readError(request: XMLHttpRequest): string {
  try {
    const parsed = JSON.parse(request.responseText);
    return String(parsed.error ?? `upload_failed_${request.status}`);
  } catch {
    return `upload_failed_${request.status}`;
  }
}

export { acceptAttribute };
