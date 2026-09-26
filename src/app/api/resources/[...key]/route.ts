import { NextRequest, NextResponse } from "next/server";
import { actorOf, requireActiveUser } from "@/lib/auth/current-user";
import { authorizeResourceRead, READ_URL_TTL_SECONDS, storedContentType } from "@/lib/data/uploads";
import { getStorageService } from "@/lib/services/storage";
import { isSafeObjectKey } from "@/lib/services/storage/types";
import { inferContentType } from "@/lib/services/storage/local-provider";

/**
 * GET /api/resources/<objectKey> — the single delivery path for stored files.
 *
 * The bucket is PRIVATE. There is no public URL anywhere in this app, and
 * nothing here trusts a URL that a client supplies: the object key is looked
 * up against the database to find out which material owns it, and that
 * material decides who may read it (see authorizeResourceRead).
 *
 *   r2/s3  → 302 to a short-lived signed GET URL (5 minutes, one object)
 *   local  → streams the bytes from disk, with Range support so <audio>/<video>
 *            seeking works
 *
 * Unknown keys answer 404, not 403 — otherwise this route would confirm which
 * objects exist in the bucket.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const objectKey = key.join("/");
  if (!isSafeObjectKey(objectKey)) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }

  const access = await authorizeResourceRead(actorOf(user), objectKey);
  if (!access.allowed) {
    return access.reason === "forbidden"
      ? NextResponse.json({ error: "forbidden" }, { status: 403 })
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const storage = getStorageService();

  const signed = await storage.signedReadUrl(objectKey, READ_URL_TTL_SECONDS);
  if (signed) {
    // The signature is a transport detail with a 5-minute life; the database
    // keeps `objectKey` as the authoritative reference, never this URL.
    return NextResponse.redirect(signed, { status: 302 });
  }

  // Local provider: stream, honouring Range so media controls work.
  const range = req.headers.get("range");
  const object = await storage.read(objectKey);
  if (!object) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const contentType = (await storedContentType(objectKey)) ?? object.contentType ?? inferContentType(objectKey);
  const body = object.body;

  if (range) {
    const parsed = parseRange(range, body.byteLength);
    if (!parsed) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${body.byteLength}` } });
    }
    const slice = body.subarray(parsed.start, parsed.end + 1);
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(slice.byteLength),
        "Content-Range": `bytes ${parsed.start}-${parsed.end}/${body.byteLength}`,
        "Accept-Ranges": "bytes",
        // Private content: never let a shared cache hold onto it.
        "Cache-Control": "private, no-store",
      },
    });
  }

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      // Anything renderable inline is shown inline; documents get an explicit
      // attachment disposition so they download rather than navigate away.
      "Content-Disposition": `${inlineDisposition(contentType)}; filename="${access.objectKey.split("/").pop() ?? "file"}"`,
    },
  });
}

export async function HEAD(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  // GET awaits the promise itself — hand the same promise straight through.
  return GET(req, { params });
}

function inlineDisposition(contentType: string): string {
  const inline = ["image/", "audio/", "video/", "text/plain"];
  return inline.some((p) => contentType.startsWith(p)) ? "inline" : "attachment";
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return null;
    const start = Math.max(0, size - length);
    return { start, end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return null;
  const end = rawEnd === "" ? size - 1 : Math.min(size - 1, Number(rawEnd));
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}
