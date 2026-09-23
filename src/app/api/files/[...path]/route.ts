import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Serves locally-uploaded files directly from disk.
 *
 * Why this exists instead of just using Next's built-in /public static
 * serving: `next start` (production mode) only recognises files that
 * existed under public/ at server startup — files written there WHILE the
 * server is already running 404 until the process restarts. That's exactly
 * the case a live file-upload feature hits. This route reads from disk on
 * every request instead, so newly-uploaded files are servable immediately.
 * (`next dev` doesn't have this problem — it watches the filesystem — so
 * this only actually matters for production/self-hosted use.)
 */

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(_req: NextRequest, { params }: { params: { path: string[] } }) {
  // Reject any segment that could escape the uploads directory.
  if (params.path.some((seg) => seg.includes("..") || seg.includes("/") || seg.includes("\\"))) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "public", "uploads", ...params.path);

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) throw new Error("not a file");
    const buffer = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stats.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
