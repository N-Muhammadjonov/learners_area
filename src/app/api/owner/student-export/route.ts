import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users, readingAttempts, listeningAttempts, speakingAttempts, writingSubmissions, mockAttempts, evaluations } from "@/db/schema";
import { requireOwner } from "@/lib/auth/current-user";
import { recordAudit } from "@/lib/data/audit";
import { enforce } from "@/lib/http/rate-limit";
import { CONTENT_TYPES } from "@/lib/reporter/exports";
import { renderStudentArchive } from "@/lib/student-export/format";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const limited = enforce({ name: "student_archive", limit: 4, windowMs: 60_000 }, owner.id);
  if (limited) return limited;
  const format = z.enum(["pdf", "docx", "zip"]).safeParse(req.nextUrl.searchParams.get("format"));
  if (!format.success) return NextResponse.json({ error: "invalid_format" }, { status: 400 });
  try {
    const archive = await db.transaction(async tx => {
      const students = await tx.select({ id: users.id, name: users.name, email: users.email, accountStatus: users.accountStatus, createdAt: users.createdAt }).from(users).where(eq(users.role, "student")).limit(2001);
      if (students.length > 2000) throw new Error("archive_too_large");
      const ids = students.map(student => student.id);
      const results: Record<string, Record<string, unknown>[]> = {};
      if (ids.length) {
        const [reading, listening, speaking, writing, mocks, checked] = await Promise.all([
          tx.select().from(readingAttempts).where(inArray(readingAttempts.userId, ids)).limit(10001),
          tx.select().from(listeningAttempts).where(inArray(listeningAttempts.userId, ids)).limit(10001),
          tx.select({ id: speakingAttempts.id, userId: speakingAttempts.userId, part: speakingAttempts.part, status: speakingAttempts.status, transcript: speakingAttempts.transcript }).from(speakingAttempts).where(inArray(speakingAttempts.userId, ids)).limit(10001),
          tx.select().from(writingSubmissions).where(inArray(writingSubmissions.userId, ids)).limit(10001),
          tx.select().from(mockAttempts).where(inArray(mockAttempts.userId, ids)).limit(10001),
          tx.select({ id: evaluations.id, userId: evaluations.userId, sourceType: evaluations.sourceType, sourceId: evaluations.sourceId, overallEstimate: evaluations.overallEstimate, criteria: evaluations.criteria, checkedByName: evaluations.checkedByName, createdAt: evaluations.createdAt }).from(evaluations).where(inArray(evaluations.userId, ids)).limit(10001),
        ]);
        Object.assign(results, { reading, listening, speaking, writing, mocks, evaluations: checked });
        if (Object.values(results).some(rows => rows.length > 10000)) throw new Error("archive_too_large");
      }
      return { version: 1 as const, id: randomUUID(), generatedAt: new Date().toISOString(), students, results };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    const bytes = await renderStudentArchive(archive, format.data);
    await recordAudit({ actorUserId: owner.id, action: "report.downloaded", targetType: "student_archive", targetId: archive.id, metadata: { format: format.data, students: archive.students.length, records: Object.fromEntries(Object.entries(archive.results).map(([key, rows]) => [key, rows.length])), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": CONTENT_TYPES[format.data], "Content-Disposition": `attachment; filename="learners-area-students-${archive.generatedAt.slice(0,10)}.${format.data}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "archive_too_large" ? "archive_too_large" : "export_unavailable" }, { status: error instanceof Error && error.message === "archive_too_large" ? 413 : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
