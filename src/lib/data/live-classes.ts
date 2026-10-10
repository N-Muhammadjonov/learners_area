import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClasses, liveClassAttendance } from "@/db/schema";
import { isAdministrator, type Role } from "@/lib/auth/roles";

export function listUpcoming(courseId: string) {
  return db.query.liveClasses.findMany({
    where: and(eq(liveClasses.courseId, courseId), inArray(liveClasses.status, ["upcoming", "live"])),
    orderBy: asc(liveClasses.scheduledAt),
  });
}

export function listPast(courseId: string) {
  return db.query.liveClasses.findMany({
    where: and(eq(liveClasses.courseId, courseId), inArray(liveClasses.status, ["completed", "recorded", "cancelled"])),
    orderBy: desc(liveClasses.scheduledAt),
    limit: 10,
  });
}

/**
 * The staff list of live classes.
 *
 * A class has an owner: POST /api/teacher/live-classes stamps `teacher_user_id` with the acting
 * teacher. This used to be `findMany({ orderBy })` with no `where` at all, so despite its name every
 * teacher in the centre saw every other teacher's classes — titles, schedule, and the meeting URL
 * learners are handed to join. `roles.ts` already draws the line: `isStaff` may author and review
 * centre content, while `isAdministrator` "may run centre-wide administration". So a teacher now
 * gets their own classes, and an administrator or the owner still gets the centre-wide timetable.
 *
 * A class with no `teacher_user_id` (imported or legacy) is deliberately not claimed by any teacher;
 * it stays visible to centre-wide administration until it is assigned.
 */
export function listAllForTeacher(actor: { id: string; role: Role }) {
  return db.query.liveClasses.findMany({
    where: isAdministrator(actor.role) ? undefined : eq(liveClasses.teacherUserId, actor.id),
    orderBy: desc(liveClasses.scheduledAt),
  });
}

export async function getAttendeeIds(liveClassId: string, userId: string): Promise<boolean> {
  const row = await db.query.liveClassAttendance.findFirst({
    where: and(eq(liveClassAttendance.liveClassId, liveClassId), eq(liveClassAttendance.userId, userId)),
  });
  return !!row;
}

export async function getLiveClassDetail(id: string) {
  const liveClass = await db.query.liveClasses.findFirst({ where: eq(liveClasses.id, id) });
  if (!liveClass) return null;
  const attendance = await db.query.liveClassAttendance.findMany({
    where: eq(liveClassAttendance.liveClassId, id),
  });
  return { liveClass, attendeeCount: attendance.length };
}
