export const RIWI_CHAT_MAX_BODY_BYTES = 20 * 1024;

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid_json" };

/** Consume a request body once, with byte-accurate size, UTF-8, and JSON limits. */
export async function readRiwiBoundedJson(request: Request, maxBytes = RIWI_CHAT_MAX_BODY_BYTES): Promise<BoundedJsonResult> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { ok: false, reason: "too_large" };
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return { ok: false, reason: "invalid_json" };
  }
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "invalid_json" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  } finally {
    reader.releaseLock();
  }
}
