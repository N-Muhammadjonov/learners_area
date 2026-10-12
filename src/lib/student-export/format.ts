import { renderStudentPdf } from "./pdf";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { renderTextDocx } from "@/lib/reporter/exports";
export type StudentArchive = { version: 1; id: string; generatedAt: string; students: { id: string; name: string; email: string | null; accountStatus: string; createdAt: Date }[]; results: Record<string, Record<string, unknown>[]> };
export async function renderStudentArchive(archive: StudentArchive, format: "pdf" | "docx" | "zip") {
  if (Buffer.byteLength(JSON.stringify(archive), "utf8") > 20 * 1024 * 1024) throw new Error("archive_too_large");
  const title = "Learners Area - Student records";
  const text: string[] = [`Generated: ${archive.generatedAt}`, `Students: ${archive.students.length}`, ""];
  for (const student of archive.students) {
    text.push(`${student.name} | ${student.email ?? "Telegram"} | ${student.accountStatus}`, `Student ID: ${student.id}`, `Registered: ${student.createdAt.toISOString()}`);
    for (const [skill, rows] of Object.entries(archive.results)) {
      const own = rows.filter(row => row.userId === student.id);
      text.push(`${skill}: ${own.length} records`);
      for (const row of own) text.push(...Object.entries(row).filter(([key]) => key !== "userId").map(([key,value]) => `${key}: ${value === null ? "—" : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value)}`), "");
    }
    text.push("");
  }
  if (format === "pdf") return await renderStudentPdf(title, text, archive.id);
  if (format === "docx") return renderTextDocx(title, text, new Date(archive.generatedAt));
  const files = { "students.json": strToU8(JSON.stringify(archive, null, 2)), "students.pdf": await renderStudentPdf(title, text, archive.id), "students.docx": renderTextDocx(title, text, new Date(archive.generatedAt)) };
  const manifest = { archiveId: archive.id, generatedAt: archive.generatedAt, students: archive.students.length, files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }])) };
  return zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(manifest, null, 2)) });
}
