import "server-only";
import { readSafeArchiveAsync } from "@/lib/import/archive";
import { readPdfTextLayer } from "@/lib/import/pdf-text";
import { verifySignature } from "@/lib/uploads/signature";

export const RIWI_SOURCE_LIMIT_BYTES = 20 * 1024 * 1024;
export const RIWI_SOURCE_LIMIT_CHARS = 200_000;
export const RIWI_UNIT_MAX_CHARS = 1600;
export const RIWI_MAX_UNITS = 200;

export type ParsedKnowledgeUnit = { ordinal: number; heading: string | null; text: string; characterCount: number };

export class KnowledgeParseError extends Error {
  constructor(public readonly code: "unsupported_format" | "signature_mismatch" | "source_too_large" | "source_empty" | "source_invalid_text" | "too_many_units" | "source_timeout") {
    super(code);
  }
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key === "amp") return "&";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return '"';
    if (key === "apos") return "'";
    if (key === "nbsp") return " ";
    const code = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** HTML/SVG/XML are inert data. Remove executable/hidden blocks before text extraction. */
export function htmlToInertText(input: string): string {
  return decodeEntities(input
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|iframe|object|embed|svg|math|template|noscript)\b[^>]*\/?\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/(p|div|li|h[1-6]|tr|section|article)\s*>/gi, "\n")
    .replace(/<[^>]{0,1000}>/g, " "))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
}

function xmlToText(xml: string): string {
  // Never resolve DTD/entities. The document body is decoded as text only.
  return decodeEntities(xml
    .replace(/<!DOCTYPE[\s\S]*?>/gi, " ")
    .replace(/<w:(tab|br)\b[^>]*\/?\s*>/gi, "\t")
    .replace(/<\/w:p\s*>/gi, "\n")
    .replace(/<[^>]{0,1000}>/g, " "))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
}

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new KnowledgeParseError("source_invalid_text"); }
}

export async function extractKnowledgeText(filename: string, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  if (bytes.byteLength === 0 || bytes.byteLength > RIWI_SOURCE_LIMIT_BYTES) throw new KnowledgeParseError("source_too_large");
  const extension = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const accepted = [".txt", ".md", ".html", ".htm", ".pdf", ".docx"];
  if (!accepted.includes(extension)) throw new KnowledgeParseError("unsupported_format");
  const signature = verifySignature(filename, bytes.slice(0, 4096));
  if (!signature.ok) throw new KnowledgeParseError("signature_mismatch");

  let text: string;
  if (extension === ".pdf") {
    try { text = await readPdfTextLayer(bytes, signal); }
    catch { throw new KnowledgeParseError(signal?.aborted ? "source_timeout" : "source_invalid_text"); }
  } else if (extension === ".docx") {
    try {
      const archive = await readSafeArchiveAsync(bytes, signal);
      const expanded = Object.values(archive).reduce((total, value) => total + value.byteLength, 0);
      if (expanded > RIWI_SOURCE_LIMIT_BYTES || Object.keys(archive).some((name) => /vbaProject\.bin/i.test(name))) throw new KnowledgeParseError("source_too_large");
      const document = archive["word/document.xml"];
      if (!document) throw new KnowledgeParseError("source_invalid_text");
      text = xmlToText(decodeUtf8(document));
    } catch (error) {
      if (error instanceof KnowledgeParseError) throw error;
      throw new KnowledgeParseError(signal?.aborted ? "source_timeout" : "source_invalid_text");
    }
  } else {
    const decoded = decodeUtf8(bytes);
    text = extension === ".html" || extension === ".htm" ? htmlToInertText(decoded) : decoded;
  }

  text = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim();
  if (text.length > RIWI_SOURCE_LIMIT_CHARS) throw new KnowledgeParseError("source_too_large");
  if (!text) throw new KnowledgeParseError("source_empty");
  return text;
}

function splitLongParagraph(paragraph: string): string[] {
  const pieces: string[] = [];
  let remainder = paragraph.trim();
  while (remainder.length > RIWI_UNIT_MAX_CHARS) {
    let cut = remainder.lastIndexOf(" ", RIWI_UNIT_MAX_CHARS);
    if (cut < Math.floor(RIWI_UNIT_MAX_CHARS * 0.55)) cut = RIWI_UNIT_MAX_CHARS;
    pieces.push(remainder.slice(0, cut).trim());
    remainder = remainder.slice(cut).trim();
  }
  if (remainder) pieces.push(remainder);
  return pieces;
}

/** Deterministic bounded chunking; headings are metadata, never trusted instructions. */
export function chunkKnowledgeText(input: string): ParsedKnowledgeUnit[] {
  const normalized = input.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (!normalized || normalized.length > RIWI_SOURCE_LIMIT_CHARS) throw new KnowledgeParseError(normalized ? "source_too_large" : "source_empty");
  const paragraphs = normalized.split(/\n\s*\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const chunks: Array<{ heading: string | null; text: string }> = [];
  let heading: string | null = null;
  for (const paragraph of paragraphs) {
    const isHeading = /^#{1,6}\s+/.test(paragraph) || (/^[^.!?]{1,100}:$/.test(paragraph));
    if (isHeading) { heading = paragraph.replace(/^#{1,6}\s+/, "").replace(/:$/, "").slice(0, 240); continue; }
    for (const text of splitLongParagraph(paragraph)) {
      chunks.push({ heading, text });
      heading = null;
    }
  }
  if (!chunks.length) throw new KnowledgeParseError("source_empty");
  if (chunks.length > RIWI_MAX_UNITS) throw new KnowledgeParseError("too_many_units");
  return chunks.map((chunk, ordinal) => ({ ordinal, heading: chunk.heading, text: chunk.text, characterCount: chunk.text.length }));
}
