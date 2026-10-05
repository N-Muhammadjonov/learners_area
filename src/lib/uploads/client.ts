import {
  failureFromResponse,
  isRetryable,
  type UploadErrorCodeAll,
  type UploadFailure,
} from "@/lib/uploads/errors";
import { readHead, verifySignature } from "@/lib/uploads/signature";
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

/**
 * `error` is always a normalized code from UPLOAD_ERROR_CODES (never the old
 * catch-all "intent_failed"); `failure` carries retryability and the server's
 * correlation id. UI must render `uploadErrorMessage(failure, dict.uploadErrors)`.
 */
export type UploadOutcome =
  | { ok: true; uploadId: string; objectKey: string }
  | { ok: false; error: UploadErrorCodeAll; failure: UploadFailure };

export type StartUploadOptions = {
  purpose: "material_primary" | "material_block" | "speaking_recording";
  blockKind?: "image" | "audio" | "file";
  materialId?: string;
  /** Set for purpose="speaking_recording" — the attempt the recording belongs to. */
  speakingAttemptId?: string;
  onState?: (state: UploadState) => void;
  onProgress?: (percent: number) => void;
};

export type UploadHandle = {
  promise: Promise<UploadOutcome>;
  /** Aborts the in-flight request and asks the server to drop the object. */
  cancel: () => void;
};

/** Client-side pre-flight, so the user sees a problem before any bytes move. */
export function preflight(
  file: { name: string; type: string; size: number },
  category: UploadCategory
): { ok: true } | { ok: false; error: string } {
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
  if (result.error === "dangerous_type") return { ok: false, error: "dangerous_type" };
  return { ok: false, error: "unsupported_type" };
}

function fail(code: UploadErrorCodeAll, extra: Partial<UploadFailure> = {}): { ok: false; error: UploadErrorCodeAll; failure: UploadFailure } {
  return { ok: false, error: code, failure: { code, retryable: isRetryable(code), ...extra } };
}

/**
 * In-flight dedupe: a double click (or a re-render that calls startUpload
 * again) for the SAME file and target joins the running upload instead of
 * creating a second intent and a second object.
 */
const inflight = new Map<string, UploadHandle>();
function fileIdentity(file: Blob & { name: string }, options: StartUploadOptions): string {
  const modified = (file as File).lastModified ?? 0;
  return [options.purpose, options.blockKind ?? "", options.materialId ?? "", options.speakingAttemptId ?? "", file.name, file.size, modified].join("|");
}

export function startUpload(file: Blob & { name: string }, options: StartUploadOptions): UploadHandle {
  const key = fileIdentity(file, options);
  const running = inflight.get(key);
  if (running) return running;
  const handle = startUploadOnce(file, options);
  inflight.set(key, handle);
  void handle.promise.finally(() => inflight.delete(key));
  return handle;
}

function startUploadOnce(file: Blob & { name: string }, options: StartUploadOptions): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let cancelled = false;
  let uploadId: string | null = null;

  const setState = (state: UploadState) => {
    if (!cancelled) options.onState?.(state);
  };

  const promise = (async (): Promise<UploadOutcome> => {
    setState("queued");

    // --- 0. Content check: the first bytes must match the extension. -------
    try {
      const verdict = verifySignature(file.name, await readHead(file));
      if (!verdict.ok) return fail(verdict.reason === "executable" ? "dangerous_type" : "type_mismatch");
    } catch {
      return fail("missing_file");
    }

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
          speakingAttemptId: options.speakingAttemptId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // A non-JSON body (HTML 500, proxy 413/504) is classified by status —
        // this is the path that used to surface the raw string "intent_failed".
        const failure = failureFromResponse(res.status, data);
        return { ok: false, error: failure.code, failure };
      }
      if (!data || typeof data.uploadId !== "string") return fail("server_error", { technical: "intent_malformed" });
      intent = data as typeof intent;
      uploadId = intent.uploadId;
    } catch {
      return fail("network_error");
    }
    if (cancelled) return fail("cancelled");

    // --- 2. Bytes ----------------------------------------------------------
    setState("uploading");
    const put = await sendBytes(file, intent, options.onProgress);
    if (cancelled) {
      void discardUpload(uploadId);
      return fail("cancelled");
    }
    if (!put.ok) {
      // The bytes never landed. Leave the intent for abandoned-upload cleanup
      // rather than firing a delete that could race the PUT itself.
      return { ok: false, error: put.failure.code, failure: put.failure };
    }

    // --- 3. Finalize -------------------------------------------------------
    setState("finalizing");
    try {
      const res = await fetch("/api/uploads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: intent.uploadId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const failure = failureFromResponse(res.status, data);
        return { ok: false, error: failure.code, failure };
      }
    } catch {
      return fail("network_error");
    }
    if (cancelled) return fail("cancelled");

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
    file: Blob & { name: string },
    intent: {
      mode: "direct" | "proxy";
      uploadUrl: string | null;
      uploadId: string;
      contentType: string;
    },
    onProgress?: (percent: number) => void
  ): Promise<{ ok: true } | { ok: false; failure: UploadFailure }> {
    if (intent.mode === "direct" && intent.uploadUrl) {
      // Presigned S3/R2 requests are signature-sensitive. Use exactly the
      // provider URL and exactly the canonical Content-Type the server signed.
      // Browser CORS is the boundary; no application rewrite mutates the PUT.
      return sendDirect(intent.uploadUrl);
    }

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
          resolve({ ok: false, failure: readError(request, "proxy") });
        }
      });
      request.addEventListener("error", () => resolve({ ok: false, failure: { code: "network_error", technical: "xhr_error", retryable: true } }));
      request.addEventListener("abort", () => resolve({ ok: false, failure: { code: "cancelled", retryable: false } }));
      request.addEventListener("timeout", () => resolve({ ok: false, failure: { code: "upload_timeout", retryable: true } }));

      // Local disk provider: the bytes have to reach our server, but the
      // intent is still the authority for the key, size and type.
      const form = new FormData();
      form.append("uploadId", intent.uploadId);
      form.append("file", file);
      request.open("POST", "/api/uploads");
      request.send(form);
    });

    function sendDirect(url: string): Promise<{ ok: true } | { ok: false; failure: UploadFailure }> {
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
            resolve({ ok: false, failure: readError(request, "direct") });
          }
        });
        request.addEventListener("error", () => resolve({ ok: false, failure: { code: "storage_rejected", technical: "xhr_error", retryable: true } }));
        request.addEventListener("abort", () => resolve({ ok: false, failure: { code: "cancelled", retryable: false } }));
        request.addEventListener("timeout", () => resolve({ ok: false, failure: { code: "upload_timeout", retryable: true } }));
        request.open("PUT", url);
        request.setRequestHeader("Content-Type", intent.contentType);
        request.send(file);
      });
    }
  }
}

async function discardUpload(uploadId: string): Promise<void> {
  try {
    await fetch(`/api/uploads/${uploadId}`, { method: "DELETE", signal: AbortSignal.timeout(5_000) });
  } catch {
    /* best effort — the intent expires and cleanup reclaims the object */
  }
}

function readError(request: XMLHttpRequest, mode: "direct" | "proxy"): UploadFailure {
  let body: unknown = null;
  try {
    body = JSON.parse(request.responseText);
  } catch {
    body = null;
  }
  // R2 answers XML (SignatureDoesNotMatch, AccessDenied, RequestTimeTooSkewed).
  if (mode === "direct" && !body && request.status >= 400 && request.status < 500) {
    return { code: "storage_rejected", technical: `storage_${request.status}`, retryable: true };
  }
  return failureFromResponse(request.status, body);
}

export { acceptAttribute };
