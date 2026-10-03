// Explicit teacher -> student roster (teacher_student_links, migration 0035).
// The single source of a teacher's Reporter reach. Only owner/admin may change it;
// every change is audited with ids only. A link is accepted only when the teacher
// account really has role=teacher and the student account role=student — staff
// accounts can never be "rostered" into a teacher's report.
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { teacherStudentLinks, users } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import type { Role } from "@/lib/auth/roles";

type Database = typeof db;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roster size cap for the selection list (a teacher's own class, never the whole centre). */
export const ROSTER_LIST_CAP = 500;

export async function isOnRoster(teacherId: string, studentId: string, database: Pick<Database, "execute"> = db): Promise<boolean> {
  if (!UUID.test(teacherId) || !UUID.test(studentId)) return false;
  const result = (await database.execute(sql`select 1 as v from teacher_student_links l join users u on u.id = l.student_user_id where l.teacher_user_id = ${teacherId}::uuid and l.student_user_id = ${studentId}::uuid and u.role = 'student' limit 1`)) as unknown as { rows: unknown[] };
  return result.rows.length === 1;
}

export async function listRoster(teacherId: string, database: Pick<Database, "select"> = db): Promise<Array<{ id: string; name: string }>> {
  if (!UUID.test(teacherId)) return [];
  return database
    .select({ id: users.id, name: users.name })
    .from(teacherStudentLinks)
    .innerJoin(users, eq(users.id, teacherStudentLinks.studentUserId))
    .where(and(eq(teacherStudentLinks.teacherUserId, teacherId), eq(users.role, "student")))
    .orderBy(asc(users.name), asc(users.id))
    .limit(ROSTER_LIST_CAP);
}

export type RosterChange = { ok: true; changed: boolean } | { ok: false; status: 400 | 403 | 404; code: "invalid_input" | "forbidden" | "not_found" };

function canManage(role: Role) { return role === "owner" || role === "admin"; }

async function roleOf(id: string, database: Pick<Database, "select">): Promise<Role | null> {
  const [row] = await database.select({ role: users.role }).from(users).where(eq(users.id, id)).limit(1);
  return row ? (row.role as Role) : null;
}

export async function setRosterLink(
  actor: { id: string; role: Role },
  input: { teacherId: string; studentId: string; assigned: boolean },
  database: Pick<Database, "select" | "insert" | "delete"> = db,
): Promise<RosterChange> {
  if (!canManage(actor.role)) return { ok: false, status: 403, code: "forbidden" };
  if (!UUID.test(input.teacherId) || !UUID.test(input.studentId) || input.teacherId === input.studentId) return { ok: false, status: 400, code: "invalid_input" };
  const [teacherRole, studentRole] = await Promise.all([roleOf(input.teacherId, database), roleOf(input.studentId, database)]);
  if (teacherRole !== "teacher" || studentRole !== "student") return { ok: false, status: 404, code: "not_found" };

  let changed: boolean;
  if (input.assigned) {
    const inserted = await database.insert(teacherStudentLinks)
      .values({ teacherUserId: input.teacherId, studentUserId: input.studentId, assignedByUserId: actor.id })
      .onConflictDoNothing({ target: [teacherStudentLinks.teacherUserId, teacherStudentLinks.studentUserId] })
      .returning({ id: teacherStudentLinks.id });
    changed = inserted.length > 0;
  } else {
    const removed = await database.delete(teacherStudentLinks)
      .where(and(eq(teacherStudentLinks.teacherUserId, input.teacherId), eq(teacherStudentLinks.studentUserId, input.studentId)))
      .returning({ id: teacherStudentLinks.id });
    changed = removed.length > 0;
  }
  if (changed) {
    await recordAudit({
      actorUserId: actor.id,
      action: input.assigned ? "roster.assigned" : "roster.unassigned",
      targetType: "user",
      targetId: input.studentId,
      metadata: { teacherId: input.teacherId, studentId: input.studentId },
    }, database as never);
  }
  return { ok: true, changed };
}
