import "server-only";
import { db } from "@/db/client";
import { listeningTests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isLive } from "@/lib/services/cms/publication";
import { isStaff, type Role } from "@/lib/auth/roles";
import { listeningExamState } from "@/lib/data/full-listening";
export async function mcqAccess(user: { id: string; role: Role }, testId: string): Promise<"ok" | "not_found" | "exam_in_progress"> {
  const [test] = await db.select().from(listeningTests).where(eq(listeningTests.id, testId)).limit(1);
  if (!test || (!isStaff(user.role) && !isLive(test))) return "not_found";
  return (await listeningExamState(user, testId)).examInProgress ? "exam_in_progress" : "ok";
}
