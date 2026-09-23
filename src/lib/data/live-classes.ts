import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClasses, liveClassAttendance } from "@/db/schema";

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

export function listAllForTeacher() {
  return db.query.liveClasses.findMany({ orderBy: desc(liveClasses.scheduledAt) });
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
