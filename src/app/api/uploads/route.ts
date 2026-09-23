import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getStorageService } from "@/lib/services/storage";

const MAX_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 50) * 1024 * 1024;
const ALLOWED_PREFIXES = ["video/", "audio/", "image/"];
const ALLOWED_EXACT = ["application/pdf"];

function inferMaterialType(contentType: string): "video" | "audio" | "file" {
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "file";
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "teacher" && session.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const folder = (form?.get("folder") as string) || "speaking";

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }

  const isAllowed = ALLOWED_PREFIXES.some((p) => file.type.startsWith(p)) || ALLOWED_EXACT.includes(file.type);
  if (!isAllowed) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }
  if (!/^[a-z0-9_-]+$/i.test(folder)) {
    return NextResponse.json({ error: "invalid_folder" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const storage = getStorageService();
    const { url, key } = await storage.upload({
      buffer,
      filename: file.name,
      contentType: file.type,
      folder,
    });
    return NextResponse.json({ ok: true, url, key, type: inferMaterialType(file.type) });
  } catch (err) {
    console.error("Upload failed:", err);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
