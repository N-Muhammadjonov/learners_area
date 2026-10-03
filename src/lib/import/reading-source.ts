import { strFromU8 } from "fflate";
import { readSafeArchiveAsync } from "./archive";
import { isIgnoredEntry } from "../listening/discover";
import { validateUploadFile, extensionOf, acceptAttribute } from "../validation/uploads";

export const READING_SOURCE_ACCEPT = acceptAttribute("file");
export type ReadingSource = { kind: "structured"; bundle: unknown; files: string[] }
  | { kind: "supplemental"; textPreview: string; files: string[] };
const MAX_TEXT = 5 * 1024 * 1024;
function bundleFromText(text: string): unknown | null {
  const clean = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  try {
    const value = JSON.parse(clean);
    return value && typeof value === "object" && Array.isArray(value.passages) ? value : null;
  } catch { return null; }
}
function scrubDocument(text: string): string {
  return text.replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/\s(?:on\w+|src|href|srcset|action|data)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<(iframe|object|embed|link)[\s\S]*?>/gi, "");
}

/** Static, inert documents only. Remote resources, handlers and DTDs never reach a parser. */
export function readingTextSource(text: string, extension: string, read: (text: string) => Document): { bundle: unknown | null; textPreview: string } {
  if (text.length > MAX_TEXT) throw new Error("source_too_large");
  const direct = bundleFromText(text);
  if (direct) return { bundle: direct, textPreview: "" };
  if (![".html", ".htm", ".xml"].includes(extension)) return { bundle: null, textPreview: text.slice(0, 2000) };
  const inert = scrubDocument(text);
  const doc = read(inert);
  const candidates = [...doc.querySelectorAll('script[type="application/json"][data-reading-bundle], reading-bundle')];
  if (candidates.length > 1) throw new Error("ambiguous_source");
  const bundle = candidates.length ? bundleFromText(candidates[0]!.textContent ?? "") : null;
  doc.querySelectorAll("script,style,iframe,object,embed").forEach(node => node.remove());
  return { bundle, textPreview: (doc.body?.textContent ?? doc.documentElement.textContent ?? "").trim().slice(0, 2000) };
}

/** A file is structured only when it carries explicit authored canonical data. */
export async function readReadingSource(file: File, signal?: AbortSignal, read = (s: string) => new DOMParser().parseFromString(s, "text/html")): Promise<ReadingSource> {
  const check = validateUploadFile({ filename: file.name, contentType: file.type, size: file.size, category: "file" });
  if (!check.ok) throw new Error(check.error);
  const ext = extensionOf(file.name);
  const files = [file.name];
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (ext === ".zip" || ext === ".docx") {
    const entries = await readSafeArchiveAsync(new Uint8Array(await file.arrayBuffer()), signal);
    const names = Object.keys(entries).filter(n => !isIgnoredEntry(n));
    if (ext === ".docx") {
      const xml = entries["word/document.xml"];
      if (!xml || xml.length > MAX_TEXT) throw new Error("invalid_document");
      const text = read(scrubDocument(strFromU8(xml))).documentElement.textContent ?? "";
      const bundle = bundleFromText(text);
      return bundle ? { kind: "structured", bundle, files } : { kind: "supplemental", textPreview: text.slice(0, 2000), files };
    }
    const found: { bundle: unknown; name: string }[] = [];
    for (const name of names) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const suffix = extensionOf(name);
      if (![".json", ".txt", ".md", ".html", ".htm", ".xml"].includes(suffix)) continue;
      if (entries[name]!.byteLength > MAX_TEXT) throw new Error("source_too_large");
      const parsed = readingTextSource(strFromU8(entries[name]!), suffix, read);
      if (parsed.bundle) found.push({ bundle: parsed.bundle, name });
    }
    if (found.length > 1) throw new Error("ambiguous_source");
    return found.length ? { kind: "structured", bundle: found[0]!.bundle, files: names } : { kind: "supplemental", textPreview: "", files: names };
  }
  if ([".json", ".txt", ".md", ".html", ".htm", ".xml"].includes(ext)) {
    if (file.size > MAX_TEXT) throw new Error("source_too_large");
    const parsed = readingTextSource(await file.text(), ext, read);
    return parsed.bundle ? { kind: "structured", bundle: parsed.bundle, files } : { kind: "supplemental", textPreview: parsed.textPreview, files };
  }
  if (ext === ".pdf") {
    if (file.size > 20 * 1024 * 1024) throw new Error("source_too_large");
    const {readPdfTextLayer} = await import("./pdf-text");
    const text = await readPdfTextLayer(new Uint8Array(await file.arrayBuffer()), signal);
    const bundle = bundleFromText(text);
    return bundle ? {kind: "structured", bundle, files} : {kind: "supplemental", textPreview: text.slice(0, 2000), files};
  }
  // Legacy DOC/RTF and media remain
  // materials. They never become invented questions or active same-origin HTML.
  return { kind: "supplemental", textPreview: "", files };
}
