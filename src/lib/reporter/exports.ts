// RIWI Reporter — renderers. Each format is a pure function of the canonical snapshot.
// No dependency beyond `fflate` (already used by the app) — DOCX/XLSX are OOXML zips
// and the PDF is written directly with a standard font.
import { createHash } from "node:crypto";
import { strToU8, zipSync, type Zippable } from "fflate";
import { formatMetricValue, snapshotSha256, type ReportMetric, type ReportSnapshot } from "./snapshot";

export const REPORT_FORMATS = ["json", "csv", "xlsx", "docx", "pdf", "zip"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type ReportLang = "en" | "uz";

export const CONTENT_TYPES: Record<ReportFormat, string> = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  zip: "application/zip",
};

const T = {
  en: {
    title: "RIWI report", scope: "Scope", period: "Period", timezone: "Timezone", generated: "Generated", reportId: "Report ID",
    owner: "Whole centre (owner)", teacher: "All students (teacher)", student: "Student", summary: "Summary", metrics: "Metrics", sources: "Sources",
    cols: ["Section", "Metric", "Value", "Unit", "Basis", "Window from", "Window to (exclusive)", "Scope", "Query ID", "Generated at"],
    sourceCols: ["Query ID", "SQL", "Parameters"], noData: "— = no data in this window", integrity: "Snapshot SHA-256",
    sections: { learning: "Learning", results: "Results", people: "People", operations: "Operations" },
    basis: { window: "in window", as_of_end: "as of window end" },
  },
  uz: {
    title: "RIWI hisoboti", scope: "Qamrov", period: "Davr", timezone: "Vaqt mintaqasi", generated: "Yaratilgan", reportId: "Hisobot ID",
    owner: "Butun markaz (ega)", teacher: "Barcha talabalar (o'qituvchi)", student: "Talaba", summary: "Xulosa", metrics: "Ko'rsatkichlar", sources: "Manbalar",
    cols: ["Bo'lim", "Ko'rsatkich", "Qiymat", "Birlik", "Asos", "Oyna boshi", "Oyna oxiri (kirmaydi)", "Qamrov", "So'rov ID", "Yaratilgan vaqt"],
    sourceCols: ["So'rov ID", "SQL", "Parametrlar"], noData: "— = bu oynada ma'lumot yo'q", integrity: "Snapshot SHA-256",
    sections: { learning: "O'qish faolligi", results: "Natijalar", people: "Odamlar", operations: "Operatsiyalar" },
    basis: { window: "oyna ichida", as_of_end: "oyna oxiriga ko'ra" },
  },
} as const;

function scopeText(s: ReportSnapshot, lang: ReportLang): string {
  const t = T[lang];
  return s.scope.kind === "student" ? `${t.student}: ${s.scope.subjectName}` : s.scope.kind === "teacher" ? t.teacher : t.owner;
}

function headerLines(s: ReportSnapshot, lang: ReportLang): Array<[string, string]> {
  const t = T[lang];
  return [
    [t.scope, scopeText(s, lang)],
    [t.period, `${s.period.kind}: ${s.period.fromDate} … ${s.period.toDate}`],
    [t.timezone, s.timezone],
    [t.generated, s.generatedAt],
    [t.reportId, s.reportId],
    [t.integrity, snapshotSha256(s)],
  ];
}

export function metricRow(m: ReportMetric, lang: ReportLang): string[] {
  const t = T[lang];
  return [t.sections[m.section], m.label[lang], formatMetricValue(m), m.unit, t.basis[m.window.basis], m.window.from, m.window.to, m.scope, m.source.queryId, m.generatedAt];
}

// ---------------------------------------------------------------- JSON / CSV
export function renderJson(s: ReportSnapshot): Uint8Array {
  return strToU8(JSON.stringify(s, null, 2));
}

/** Spreadsheet formula injection guard: text cells may not start with = + - @ or control chars. */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?%?$/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const v = safeCell(value);
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

export function renderCsv(s: ReportSnapshot, lang: ReportLang): Uint8Array {
  const lines = [
    ...headerLines(s, lang).map(([k, v]) => [k, v].map(csvCell).join(",")),
    "",
    T[lang].cols.map(csvCell).join(","),
    ...s.metrics.map((m) => metricRow(m, lang).map(csvCell).join(",")),
  ];
  return strToU8(`\uFEFF${lines.join("\r\n")}\r\n`);
}

// ---------------------------------------------------------------- OOXML helpers
const xml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
  // XML 1.0 forbids most control characters.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function zip(files: Record<string, string | Uint8Array>, mtime: Date): Uint8Array {
  const entries: Zippable = {};
  for (const [name, body] of Object.entries(files)) entries[name] = [typeof body === "string" ? strToU8(body) : body, { mtime }];
  return zipSync(entries, { level: 6 });
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// ---------------------------------------------------------------- XLSX
function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function sheetXml(rows: Array<Array<string | number | null>>): string {
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    const ref = `${colName(c)}${r + 1}`;
    if (typeof cell === "number" && Number.isFinite(cell)) return `<c r="${ref}"><v>${cell}</v></c>`;
    if (cell === null) return `<c r="${ref}"/>`;
    // Inline strings are never evaluated as formulas; safeCell adds defence in depth.
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(safeCell(String(cell)))}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function renderXlsx(s: ReportSnapshot, lang: ReportLang): Uint8Array {
  const t = T[lang];
  const metricsSheet: Array<Array<string | number | null>> = [
    ...headerLines(s, lang).map(([k, v]) => [k, v]),
    [],
    // Raw numeric value next to the formatted one so spreadsheets can compute.
    [...t.cols.slice(0, 3), "Raw", ...t.cols.slice(3)],
    ...s.metrics.map((m) => { const r = metricRow(m, lang); return [r[0]!, r[1]!, r[2]!, m.value, ...r.slice(3)]; }),
  ];
  const sourcesSheet = [t.sourceCols as unknown as string[], ...s.metrics.map((m) => [m.source.queryId, m.source.sql, JSON.stringify(m.source.parameters)])];
  const sheetName = (v: string) => xml(v.slice(0, 31));
  return zip({
    "[Content_Types].xml": `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName(t.metrics)}" sheetId="1" r:id="rId1"/><sheet name="${sheetName(t.sources)}" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheetXml(metricsSheet),
    "xl/worksheets/sheet2.xml": sheetXml(sourcesSheet),
  }, new Date(s.generatedAt));
}

// ---------------------------------------------------------------- DOCX
function para(text: string, opts: { bold?: boolean; size?: number; mono?: boolean } = {}): string {
  const rpr = `${opts.bold ? "<w:b/>" : ""}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ""}${opts.mono ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : ""}`;
  return `<w:p><w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function table(rows: string[][], header: string[]): string {
  const cell = (v: string, bold = false) => `<w:tc><w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${xml(v)}</w:t></w:r></w:p></w:tc>`;
  const border = '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="2"/><w:insideV w:val="single" w:sz="2"/><w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tblBorders>';
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${border}</w:tblPr><w:tr>${header.map((h) => cell(h, true)).join("")}</w:tr>${rows.map((r) => `<w:tr>${r.map((v) => cell(v)).join("")}</w:tr>`).join("")}</w:tbl>`;
}

export function renderDocx(s: ReportSnapshot, lang: ReportLang): Uint8Array {
  const t = T[lang];
  const body = [
    para(t.title, { bold: true, size: 36 }),
    ...headerLines(s, lang).map(([k, v]) => para(`${k}: ${v}`)),
    para(t.summary, { bold: true, size: 28 }),
    ...s.narrative[lang].map((l) => para(l)),
    para(t.metrics, { bold: true, size: 28 }),
    table(s.metrics.map((m) => { const r = metricRow(m, lang); return [r[0]!, r[1]!, r[2]!, r[4]!, r[8]!]; }), [t.cols[0], t.cols[1], t.cols[2], t.cols[4], t.cols[8]]),
    para(t.noData),
    para(t.sources, { bold: true, size: 28 }),
    ...s.metrics.flatMap((m) => [para(m.source.queryId, { bold: true }), para(m.source.sql, { mono: true, size: 16 }), para(JSON.stringify(m.source.parameters), { mono: true, size: 16 })]),
  ].join("");
  return renderDocxBody(body, new Date(s.generatedAt));
}

function renderDocxBody(body: string, generatedAt: Date): Uint8Array {
  return zip({
    "[Content_Types].xml": `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="900" w:bottom="1000" w:left="900"/></w:sectPr></w:body></w:document>`,
  }, generatedAt);
}

// ---------------------------------------------------------------- PDF
/** WinAnsi-safe text for the standard Helvetica font (Uzbek Latin uses ASCII apostrophes). */
function pdfText(v: string): string {
  const mapped = v.replace(/[\u2018\u2019\u02BB\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...");
  return mapped.replace(/[^\x20-\x7E]/g, "?").replace(/[\\()]/g, (c) => `\\${c}`);
}

function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut < width / 2) cut = width;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

export function renderPdf(s: ReportSnapshot, lang: ReportLang): Uint8Array {
  const t = T[lang];
  type Line = { text: string; size: number; bold?: boolean; mono?: boolean };
  const lines: Line[] = [{ text: t.title, size: 16, bold: true }, { text: "", size: 6 }];
  for (const [k, v] of headerLines(s, lang)) for (const w of wrap(`${k}: ${v}`, 95)) lines.push({ text: w, size: 9 });
  lines.push({ text: "", size: 6 }, { text: t.summary, size: 12, bold: true });
  for (const l of s.narrative[lang]) for (const w of wrap(l, 95)) lines.push({ text: w, size: 9 });
  lines.push({ text: "", size: 6 }, { text: t.metrics, size: 12, bold: true });
  for (const m of s.metrics) {
    const r = metricRow(m, lang);
    lines.push({ text: `${r[1]}: ${r[2]}  (${r[4]})`, size: 9 });
  }
  lines.push({ text: t.noData, size: 8 }, { text: "", size: 6 }, { text: t.sources, size: 12, bold: true });
  for (const m of s.metrics) {
    lines.push({ text: m.source.queryId, size: 8, bold: true });
    for (const w of wrap(m.source.sql, 110)) lines.push({ text: w, size: 7, mono: true });
    for (const w of wrap(JSON.stringify(m.source.parameters), 110)) lines.push({ text: w, size: 7, mono: true });
  }

  return renderPdfLines(lines, t.title, s.reportId, "RIWI Reporter");
}

type PdfLine = { text: string; size: number; bold?: boolean; mono?: boolean };
function renderPdfLines(lines: PdfLine[], title: string, documentId: string, producer: string): Uint8Array {
  const pageHeight = 842;
  const top = 800;
  const bottom = 50;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = top;
  for (const line of lines) {
    const lead = line.size + 4;
    if (y - lead < bottom) { pages.push(ops.join("\n")); ops = []; y = top; }
    y -= lead;
    if (line.text) ops.push(`BT /${line.mono ? "F3" : line.bold ? "F2" : "F1"} ${line.size} Tf 50 ${y} Td (${pdfText(line.text)}) Tj ET`);
  }
  pages.push(ops.join("\n"));
  const footer = (i: number) => `BT /F1 7 Tf 50 30 Td (${pdfText(`${documentId} - ${i + 1}/${pages.length}`)}) Tj ET`;

  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add("");
  const pagesObj = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const f3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  pages.forEach((content, i) => {
    const stream = `${content}\n${footer(i)}`;
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 ${pageHeight}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> >> /Contents ${contentId} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const info = add(`<< /Title (${pdfText(`${title} ${documentId}`)}) /Producer (${pdfText(producer)}) >>`);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefAt = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

// ---------------------------------------------------------------- ZIP bundle
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export function renderZip(s: ReportSnapshot, lang: ReportLang): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "report.json": renderJson(s),
    "report.csv": renderCsv(s, lang),
    "report.xlsx": renderXlsx(s, lang),
    "report.docx": renderDocx(s, lang),
    "report.pdf": renderPdf(s, lang),
  };
  const manifest = {
    schemaVersion: s.schemaVersion,
    reportId: s.reportId,
    generatedAt: s.generatedAt,
    timezone: s.timezone,
    period: { kind: s.period.kind, from: s.period.from, to: s.period.to },
    scope: s.scope.kind,
    language: lang,
    snapshotSha256: snapshotSha256(s),
    files: Object.entries(files).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha256(bytes) })),
  };
  return zip({ ...files, "manifest.json": JSON.stringify(manifest, null, 2) }, new Date(s.generatedAt));
}

export function renderReport(s: ReportSnapshot, format: ReportFormat, lang: ReportLang): Uint8Array {
  switch (format) {
    case "json": return renderJson(s);
    case "csv": return renderCsv(s, lang);
    case "xlsx": return renderXlsx(s, lang);
    case "docx": return renderDocx(s, lang);
    case "pdf": return renderPdf(s, lang);
    case "zip": return renderZip(s, lang);
  }
}

export function reportFileName(s: ReportSnapshot, format: ReportFormat): string {
  return `riwi-report-${s.scope.kind}-${s.period.fromDate}_${s.period.toDate}.${format}`;
}

export { sha256 as bytesSha256 };

/** Standalone student-data documents use the same validated file encoders. */
export function renderTextPdf(title: string, body: string[], documentId: string): Uint8Array {
  return renderPdfLines([{ text: title, size: 16, bold: true }, ...body.flatMap(line => wrap(line, 95).map(text => ({ text, size: 9 })))], title, documentId, "Learners Area");
}
export function renderTextDocx(title: string, body: string[], generatedAt: Date): Uint8Array {
  return renderDocxBody(para(title, { bold: true, size: 36 }) + body.map(line => para(line)).join(""), generatedAt);
}
