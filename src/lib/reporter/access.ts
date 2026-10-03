// RIWI Reporter — who may generate which report.
//   OWNER          owner | teacher | student(any student)
//   ADMIN/TEACHER  teacher | student(any student)        (staff already see all students)
//   STUDENT        student(self only)
// A subject that is not visible to the actor yields the same 404 as a missing one, so
// the endpoint cannot be used to probe which account ids exist (IDOR).
import type { Role } from "@/lib/auth/roles";
import type { ReportScope } from "./snapshot";

export const SCOPE_KINDS = ["owner", "teacher", "student"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export type Actor = { id: string; role: Role; name: string };
export type SubjectLookup = (id: string) => Promise<{ id: string; role: Role; name: string } | null>;

export type AccessResult = { ok: true; scope: ReportScope } | { ok: false; status: 403 | 404 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function allowedScopes(role: Role): ScopeKind[] {
  if (role === "owner") return ["owner", "teacher", "student"];
  if (role === "admin" || role === "teacher") return ["teacher", "student"];
  return ["student"];
}

export async function authorizeReport(
  actor: Actor,
  requested: { scope: ScopeKind; subjectId?: string | null },
  lookup: SubjectLookup,
): Promise<AccessResult> {
  if (!allowedScopes(actor.role).includes(requested.scope)) return { ok: false, status: 403 };
  if (requested.scope === "owner") return { ok: true, scope: { kind: "owner" } };
  if (requested.scope === "teacher") return { ok: true, scope: { kind: "teacher" } };

  if (actor.role === "student") {
    // A student's report is always their own; any other id is invisible.
    if (requested.subjectId && requested.subjectId !== actor.id) return { ok: false, status: 404 };
    return { ok: true, scope: { kind: "student", subjectId: actor.id, subjectName: actor.name } };
  }
  const id = requested.subjectId ?? "";
  if (!UUID.test(id)) return { ok: false, status: 404 };
  const subject = await lookup(id);
  if (!subject || subject.role !== "student") return { ok: false, status: 404 };
  return { ok: true, scope: { kind: "student", subjectId: subject.id, subjectName: subject.name } };
}
