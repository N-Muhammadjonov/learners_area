import { jsonLiteral } from "../listening/source-parser";
import { strFromU8 } from "fflate";
import { readSafeArchiveAsync } from "./archive";
import { isIgnoredEntry } from "../listening/discover";
import { validateUploadFile, extensionOf, acceptAttribute } from "../validation/uploads";

export const READING_SOURCE_ACCEPT = acceptAttribute("file");
export type ReadingSource = { kind: "structured"; bundle: unknown; files: string[] }
  | { kind: "supplemental"; textPreview: string; files: string[] };
const MAX_TEXT = 5 * 1024 * 1024;
async function stampStaticBundle(bundle: unknown, raw: string): Promise<unknown> {
  if (!bundle || typeof bundle !== "object" || !("sourceRef" in bundle) || bundle.sourceRef !== "html-reading-pending") return bundle;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  return { ...bundle, sourceRef: `html-reading-${Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("")}` };
}
function bundleFromText(text: string): unknown | null {
  const clean = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  try {
    const value = JSON.parse(clean);
    return value && typeof value === "object" && Array.isArray(value.passages) ? value : null;
  } catch { return null; }
}
export function scrubDocument(text: string): string {
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
  const bundle = candidates.length ? bundleFromText(candidates[0]!.textContent ?? "") : readingBundleFromControls(doc, text);
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
    return found.length ? { kind: "structured", bundle: await stampStaticBundle(found[0]!.bundle, strFromU8(entries[found[0]!.name]!)), files: names } : { kind: "supplemental", textPreview: "", files: names };
  }
  if ([".json", ".txt", ".md", ".html", ".htm", ".xml"].includes(ext)) {
    if (file.size > MAX_TEXT) throw new Error("source_too_large");
    const raw = await file.text();
    const parsed = readingTextSource(raw, ext, read);
    return parsed.bundle ? { kind: "structured", bundle: await stampStaticBundle(parsed.bundle, raw), files } : { kind: "supplemental", textPreview: parsed.textPreview, files };
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

/** Static answer literals + real passage/answer controls; never execute the uploaded script. */
export function readingBundleFromControls(doc: Document, raw: string): unknown | null {
  const marker = /\b(?:const|let|var)\s+(KEY|ANSWER_KEY)\s*=/.exec(raw)?.[1];
  if (!marker) return null;
  let keys: Record<string, unknown>;
  try { keys = jsonLiteral(raw, `const ${marker} =`) as Record<string, unknown>; } catch { return null; }
  const candidates = Array.from(doc.querySelectorAll('[data-reading-passage],.reading-passage,.passage-text,article[id^="passage"]')).filter(node => !node.parentElement?.closest('[data-reading-passage],.reading-passage,.passage-text,article[id^="passage"]'));
  if (!candidates.length || candidates.length > 3) return null;
  const controls = Array.from(doc.querySelectorAll("input,select,textarea"));
  const numbers = [...new Set(controls.map(node => Number(/^(?:q|r|l)(\d+)$/.exec(node.id || node.getAttribute("name") || "")?.[1])).filter(n => n > 0 && n <= 60))];
  if (!numbers.length) return null;
  const title = doc.querySelector("h1")?.textContent?.trim() || doc.title || "Reading";
  const passages = candidates.map((node, index) => {
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll("script,style,input,select,textarea,button").forEach(n => n.remove());
    const body = (copy.textContent ?? "").trim();
    return { passageNo: index + 1, title: node.querySelector("h2,h3")?.textContent?.trim() || `${title} ${index + 1}`, body, questions: [] as Record<string,unknown>[], vocabulary: [] };
  });
  for (const number of numbers.sort((a,b) => a - b)) {
    const input = controls.find(node => Number(/^(?:q|r|l)(\d+)$/.exec(node.id || node.getAttribute("name") || "")?.[1]) === number)!;
    const host = input.closest(".question,.q,.exam-question,.question-item,li,p,tr,label");
    if (!host || typeof keys[number] !== "string" || !(keys[number] as string).trim()) return null;
    const no = Number(input.getAttribute("data-passage-no") || host.closest("[data-passage-no]")?.getAttribute("data-passage-no") || (candidates.length === 1 ? 1 : 0));
    const passage = passages[no - 1]; if (!passage) return null;
    const clone = host.cloneNode(true) as Element;
    clone.querySelectorAll("input,select,textarea,button").forEach(node => node.remove());
    const text = host.querySelector(".qtext,.question-text")?.textContent?.trim() || clone.textContent?.trim(); if (!text) return null;
    const options = input.tagName === "SELECT" ? Array.from(input.querySelectorAll("option")).filter(o => o.getAttribute("value")).map(o => o.textContent?.trim() || o.getAttribute("value")!) : Array.from(host.querySelectorAll(".q-opt,.q-choice,label")).map(o => o.textContent?.trim() ?? "").filter(Boolean);
    const answer = keys[number] as string;
    const type = ["TRUE","FALSE","NOT GIVEN"].includes(answer.toUpperCase()) ? "true_false_not_given" : ["YES","NO"].includes(answer.toUpperCase()) ? "yes_no_not_given" : options.length ? "multiple_choice" : "short_answer";
    passage.questions.push({ questionNo:number, type, text, options, answer, accepted:[], explanation:"" });
  }
  return { sourceRef:"html-reading-pending", title, publish:false, passages };
}
