/**
 * Listening package discovery — PURE (no DOM, no Node built-ins).
 *
 * The importer used to assume ONE layout: `metadata.json` (or `manifest.json`)
 * at the ZIP root naming an MP3. Owner packages that were nested in a folder,
 * named the audio `.m4a`, or kept transcripts as `.txt`/`.vtt` failed with
 * "metadata.json missing or invalid" even though every piece was present.
 *
 * This module inspects the ZIP contents deterministically:
 *   - canonical files are found case-insensitively at any depth;
 *   - audio candidates are recognised by extension AND magic bytes;
 *   - one obvious full-test audio is chosen automatically, a reference from the
 *     manifest wins, otherwise the ambiguity is returned for staff to resolve;
 *   - real transcript text is collected from txt/md/html/json/xml/vtt/srt and
 *     attached to a section only when the section can be determined.
 * Nothing is invented: no answers, no transcripts, no metadata values.
 */

export type AudioFormat = "mp3" | "m4a" | "wav" | "aac" | "ogg" | "opus" | "webm" | "flac";

export const AUDIO_MIME: Record<AudioFormat, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
  flac: "audio/flac",
};

const AUDIO_EXT = /\.(mp3|m4a|mp4a|wav|aac|ogg|oga|opus|webm|weba|flac)$/i;
const TEXT_EXT = /\.(json|html?|txt|md|csv|xml|vtt|srt)$/i;
const IGNORED = /(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$)/i;

export function isIgnoredEntry(path: string): boolean {
  return IGNORED.test(path);
}

export function isTextEntry(path: string): boolean {
  return TEXT_EXT.test(path) && !isIgnoredEntry(path);
}

/** Magic-byte sniff. Returns null when the bytes are not a recognised audio container. */
export function sniffAudio(bytes: Uint8Array): AudioFormat | null {
  const b = bytes;
  const at = (i: number) => b[i] ?? -1;
  const ascii = (start: number, text: string) => [...text].every((c, i) => at(start + i) === c.charCodeAt(0));
  if (ascii(0, "ID3")) return "mp3";
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "wav";
  if (ascii(0, "fLaC")) return "flac";
  if (ascii(0, "OggS")) {
    // Opus streams carry "OpusHead" in the first page.
    const head = String.fromCharCode(...b.slice(0, Math.min(b.length, 128)));
    return head.includes("OpusHead") ? "opus" : "ogg";
  }
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return "webm";
  if (ascii(4, "ftyp")) return "m4a";
  if (at(0) === 0xff && (at(1) & 0xf6) === 0xf0) return "aac"; // ADTS sync, layer 00
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return "mp3"; // MPEG frame sync
  return null;
}

function extFormat(path: string): AudioFormat | null {
  const m = AUDIO_EXT.exec(path);
  if (!m) return null;
  const e = m[1]!.toLowerCase();
  if (e === "mp4a") return "m4a";
  if (e === "oga") return "ogg";
  if (e === "weba") return "webm";
  return e as AudioFormat;
}

/** Formats that may legitimately share a container (m4a/aac, ogg/opus). */
function compatible(ext: AudioFormat, sniffed: AudioFormat): boolean {
  if (ext === sniffed) return true;
  const groups: AudioFormat[][] = [["m4a", "aac"], ["ogg", "opus"], ["mp3", "aac"]];
  return groups.some((g) => g.includes(ext) && g.includes(sniffed));
}

export type AudioCandidate = { path: string; format: AudioFormat; mimeType: string; size: number };
export type RejectedAudio = { path: string; reason: "signature_mismatch" };

export function audioCandidates(entries: Record<string, Uint8Array>): { candidates: AudioCandidate[]; rejected: RejectedAudio[] } {
  const candidates: AudioCandidate[] = [];
  const rejected: RejectedAudio[] = [];
  for (const path of Object.keys(entries).sort()) {
    if (isIgnoredEntry(path)) continue;
    const ext = extFormat(path);
    if (!ext) continue;
    const sniffed = sniffAudio(entries[path]!);
    if (!sniffed || !compatible(ext, sniffed)) {
      rejected.push({ path, reason: "signature_mismatch" });
      continue;
    }
    // The container decides the MIME, not the filename.
    const format = sniffed === "aac" && ext === "m4a" ? "m4a" : ext;
    candidates.push({ path, format, mimeType: AUDIO_MIME[format], size: entries[path]!.byteLength });
  }
  return { candidates, rejected };
}

export type AudioChoice =
  | { kind: "chosen"; audio: AudioCandidate; reason: "referenced" | "only" | "named_full" }
  | { kind: "ambiguous"; candidates: AudioCandidate[] }
  | { kind: "none" };

const FULL_NAME = /(^|[\/_\-. ])(full|complete|whole|test|exam)([\/_\-. ]|$)/i;

export function chooseAudio(candidates: AudioCandidate[], referencedPath?: string | null): AudioChoice {
  if (candidates.length === 0) return { kind: "none" };
  if (referencedPath) {
    const want = referencedPath.toLowerCase();
    const hit = candidates.find((c) => c.path.toLowerCase() === want || c.path.toLowerCase().endsWith("/" + want));
    if (hit) return { kind: "chosen", audio: hit, reason: "referenced" };
  }
  if (candidates.length === 1) return { kind: "chosen", audio: candidates[0]!, reason: "only" };
  const named = candidates.filter((c) => FULL_NAME.test(c.path.split("/").pop() ?? ""));
  if (named.length === 1) return { kind: "chosen", audio: named[0]!, reason: "named_full" };
  return { kind: "ambiguous", candidates };
}

/** Case-insensitive, any-depth lookup of a canonical file; the shallowest wins. */
export function findEntry(names: string[], wanted: string): string | null {
  const w = wanted.toLowerCase();
  const hits = names
    .filter((n) => !isIgnoredEntry(n))
    .filter((n) => n.toLowerCase() === w || n.toLowerCase().endsWith("/" + w));
  hits.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  return hits[0] ?? null;
}

/** The folder that holds the canonical files, so relative references resolve. */
export function packageRoot(names: string[]): string {
  const anchor =
    findEntry(names, "data/package.json")?.replace(/data\/package\.json$/i, "") ??
    findEntry(names, "metadata.json")?.replace(/metadata\.json$/i, "") ??
    findEntry(names, "manifest.json")?.replace(/manifest\.json$/i, "");
  if (anchor !== undefined) return anchor;
  // No canonical file: a single top-level folder that contains everything is the root.
  const tops = new Set(names.filter((n) => !isIgnoredEntry(n)).map((n) => (n.includes("/") ? n.split("/")[0] + "/" : "")));
  return tops.size === 1 && !tops.has("") ? [...tops][0]! : "";
}

/** Re-key entries relative to the package root (entries outside it are dropped from lookup, not deleted). */
export function relativeTo<T>(entries: Record<string, T>, root: string): Record<string, T> {
  if (!root) return Object.fromEntries(Object.entries(entries).filter(([k]) => !isIgnoredEntry(k)));
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (isIgnoredEntry(k)) continue;
    if (k.toLowerCase().startsWith(root.toLowerCase())) out[k.slice(root.length)] = v;
  }
  return out;
}

/** Text lookup that ignores case — `DATA/PACKAGE.JSON` and `data/package.json` are the same file. */
export function textFile(textFiles: Record<string, string>, wanted: string): string | undefined {
  const key = findEntry(Object.keys(textFiles), wanted);
  return key ? textFiles[key] : undefined;
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export type HtmlToText = (html: string) => string;

const TRANSCRIPT_NAME = /(transcript|tapescript|audioscript|audio[_\- ]?script|script|subtitles?|captions?)/i;

/** Strip VTT/SRT cue numbers, timings and headers; keep the spoken text. */
export function cuesToText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^WEBVTT/i.test(t) || /^(NOTE|STYLE|REGION)\b/.test(t)) return false;
      if (/^\d+$/.test(t)) return false;
      if (/-->/.test(t)) return false;
      return true;
    })
    .map((l) => l.replace(/<[^>]+>/g, "").trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain-text extraction for markup without a DOM (used for XML and as an HTML fallback). */
export function stripMarkup(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function sectionFromName(path: string): number | null {
  const name = path.split("/").pop() ?? path;
  const m = /(?:section|part|sec|s)[\s_\-.]*0?([1-4])(?!\d)/i.exec(name) ?? /(?:^|[^\d])0?([1-4])(?:[^\d]|$)/.exec(name.replace(/\.[a-z0-9]+$/i, ""));
  return m ? Number(m[1]) : null;
}

/** Split one full transcript at explicit "Section N" / "Part N" headings, if every heading is present. */
export function splitBySectionHeadings(text: string): Record<number, string> | null {
  const re = /(^|\n)\s*(?:SECTION|Section|PART|Part)\s*([1-4])\b[^\n]*\n/g;
  const marks: { n: number; start: number; bodyStart: number }[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) marks.push({ n: Number(m[2]), start: m.index, bodyStart: m.index + m[0].length });
  const ns = marks.map((m) => m.n);
  if (marks.length < 2 || new Set(ns).size !== ns.length) return null;
  const out: Record<number, string> = {};
  marks.forEach((m, i) => {
    const body = text.slice(m.bodyStart, marks[i + 1]?.start ?? text.length).trim();
    if (body) out[m.n] = body;
  });
  return Object.keys(out).length ? out : null;
}

export type TranscriptDiscovery = {
  /** Section number → transcript text (only real, non-empty text). */
  bySection: Record<number, string>;
  /** Files that look like transcripts but could not be tied to a section. */
  unassigned: string[];
  /** Which file each section's text came from, for the staff summary. */
  sources: Record<number, string>;
};

function jsonTranscripts(raw: string): Record<number, string> | null {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  const out: Record<number, string> = {};
  const take = (n: unknown, t: unknown) => {
    const num = Number(n);
    if (Number.isInteger(num) && num >= 1 && num <= 4 && typeof t === "string" && t.trim()) out[num] = t.trim();
  };
  const list = Array.isArray(data) ? data : (data as { sections?: unknown })?.sections;
  if (Array.isArray(list)) {
    list.forEach((item, i) => {
      const o = item as Record<string, unknown>;
      take(o?.number ?? o?.section ?? i + 1, o?.text ?? o?.transcript);
    });
  } else if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const m = /([1-4])$/.exec(k);
      if (m) take(m[1], typeof v === "string" ? v : (v as Record<string, unknown>)?.text ?? (v as Record<string, unknown>)?.transcript);
    }
  }
  return Object.keys(out).length ? out : null;
}

export function discoverTranscripts(textFiles: Record<string, string>, htmlToText: HtmlToText = stripMarkup): TranscriptDiscovery {
  const bySection: Record<number, string> = {};
  const sources: Record<number, string> = {};
  const unassigned: string[] = [];
  const put = (n: number, text: string, from: string) => {
    const clean = text.replace(/\r\n/g, "\n").trim();
    if (!clean || bySection[n]) return;
    bySection[n] = clean;
    sources[n] = from;
  };

  const paths = Object.keys(textFiles).filter((p) => !isIgnoredEntry(p)).sort();
  for (const path of paths) {
    const lower = path.toLowerCase();
    const isCue = /\.(vtt|srt)$/i.test(lower);
    // A transcript is named as one, or sits in a folder named as one
    // (e.g. transcripts/section1.txt).
    if (!isCue && !TRANSCRIPT_NAME.test(path)) continue;
    if (/(^|\/)(metadata|manifest|package)\.json$/i.test(lower)) continue;
    const raw = textFiles[path]!;
    let text: string;
    if (isCue) text = cuesToText(raw);
    else if (/\.json$/i.test(lower)) {
      const parsed = jsonTranscripts(raw);
      if (parsed) { for (const [n, t] of Object.entries(parsed)) put(Number(n), t, path); continue; }
      unassigned.push(path);
      continue;
    } else if (/\.html?$/i.test(lower)) text = htmlToText(raw);
    else if (/\.xml$/i.test(lower)) text = stripMarkup(raw);
    else text = raw;
    if (!text.trim()) continue;
    const n = sectionFromName(path);
    if (n) { put(n, text, path); continue; }
    const split = splitBySectionHeadings(text);
    if (split) { for (const [k, t] of Object.entries(split)) put(Number(k), t, path); continue; }
    unassigned.push(path);
  }
  return { bySection, unassigned, sources };
}

// ---------------------------------------------------------------------------
// Errors — technical code for logs, structured detail for the staff message.
// ---------------------------------------------------------------------------

export type ImportProblemCode =
  | "zip_unreadable"
  | "zip_too_large"
  | "zip_unsafe"
  | "no_audio"
  | "audio_ambiguous"
  | "audio_reference_missing"
  | "audio_signature_mismatch"
  | "audio_unreadable"
  | "no_question_source"
  | "package_invalid"
  | "map_missing";

export class ListeningImportProblem extends Error {
  constructor(public code: ImportProblemCode, public detail: { files?: string[]; info?: string } = {}) {
    super(code);
    this.name = "ListeningImportProblem";
  }
}

/** A human-readable file list for the error panel — capped, sorted, no hidden/system files. */
export function visibleFileList(names: string[], limit = 25): string[] {
  return names.filter((n) => !isIgnoredEntry(n)).sort().slice(0, limit);
}
