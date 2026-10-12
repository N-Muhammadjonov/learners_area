import { sniffAudio } from "@/lib/listening/discover";
import { extensionOf } from "@/lib/validation/uploads";

/**
 * Content sniffing (magic bytes) — PURE.
 *
 * A filename and a browser MIME are claims. The first bytes are evidence. The
 * browser checks them before any bytes leave the machine, so a renamed file
 * ("notes.pdf" that is really a ZIP or an executable) is refused with a clear
 * message instead of being stored under a misleading type.
 */

const ascii = (b: Uint8Array, start: number, text: string) =>
  [...text].every((c, i) => b[start + i] === c.charCodeAt(0));

function isZip(b: Uint8Array) {
  return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);
}
function isOle(b: Uint8Array) {
  return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) => b[i] === v);
}
function isIsoBmff(b: Uint8Array) {
  return ascii(b, 4, "ftyp") || ascii(b, 4, "moov") || ascii(b, 4, "mdat") || ascii(b, 4, "wide") || ascii(b, 4, "free");
}
function isEbml(b: Uint8Array) {
  return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
}
function looksExecutable(b: Uint8Array) {
  return (b[0] === 0x4d && b[1] === 0x5a) || // MZ (Windows PE)
    ascii(b, 0, "\u007fELF") ||
    [0xcf, 0xfa, 0xed, 0xfe].every((v, i) => b[i] === v) || // Mach-O 64
    [0xfe, 0xed, 0xfa, 0xcf].every((v, i) => b[i] === v) ||
    ascii(b, 0, "#!");
}
function isText(b: Uint8Array) {
  const n = Math.min(b.length, 4096);
  for (let i = 0; i < n; i++) if (b[i] === 0) return false;
  return true;
}

export type SignatureVerdict = { ok: true } | { ok: false; reason: "executable" | "mismatch" };

/** `head` should be the first ~4 KB of the file. */
export function verifySignature(filename: string, head: Uint8Array): SignatureVerdict {
  if (head.length === 0) return { ok: false, reason: "mismatch" };
  if (looksExecutable(head)) return { ok: false, reason: "executable" };
  const ext = extensionOf(filename);
  const pass = (cond: boolean): SignatureVerdict => (cond ? { ok: true } : { ok: false, reason: "mismatch" });
  switch (ext) {
    case ".pdf": return pass(ascii(head, 0, "%PDF"));
    case ".docx": case ".pptx": case ".xlsx": case ".zip": return pass(isZip(head));
    case ".doc": case ".ppt": case ".xls": return pass(isOle(head));
    case ".rtf": return pass(ascii(head, 0, "{\\rtf"));
    case ".png": return pass([0x89, 0x50, 0x4e, 0x47].every((v, i) => head[i] === v));
    case ".jpg": case ".jpeg": return pass(head[0] === 0xff && head[1] === 0xd8);
    case ".gif": return pass(ascii(head, 0, "GIF8"));
    case ".webp": return pass(ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP"));
    case ".mp4": case ".mov": case ".m4v": return pass(isIsoBmff(head));
    case ".webm": return pass(isEbml(head));
    case ".mp3": case ".wav": case ".m4a": case ".aac": case ".ogg": case ".oga": case ".opus": case ".flac": {
      const s = sniffAudio(head);
      return pass(s !== null);
    }
    case ".txt": case ".csv": case ".md": case ".html": case ".htm": case ".xml": case ".json":
      return pass(isText(head));
    default:
      return { ok: false, reason: "mismatch" };
  }
}

export async function readHead(file: Blob, bytes = 4096): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
}
