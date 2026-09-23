/** Maps a stored MIME type onto the material `primaryType` enum. */
export function inferMaterialType(mimeType: string): "video" | "audio" | "file" {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}
