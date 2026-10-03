// RIWI Reporter — who may generate which report. Every role has its OWN explicit
// branch; no role inherits another role's reach by falling through.
//
//   OWNER    owner (centre) | teacher (all-students cohort) | student (any student)
//   ADMIN    exactly what ADMIN_REPORT_POLICY declares (below) — never the owner scope
//   TEACHER  teacher (own roster only) | student (only if on own roster)
//            Roster = teacher_student_links (migration 0035), assigned explicitly by
//            owner/admin. Nothing is inferred from assignments or class history.
//            No roster / unreadable roster => zero learners (fail closed).
//   STUDENT  student (self only)
//
// A subject that is not visible to the actor yields the same 404 as a missing one, so
// the endpoint cannot be used to probe which account ids exist (IDOR).
import type { Role } from "@/lib/auth/roles";
import type { ReportScope } from "./snapshot";

export const SCOPE_KINDS = ["owner", "teacher", "student"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export type Actor = { id: string; role: Role; name: string };
export type SubjectLookup = (id: string) => Promise<{ id: string; role: Role; name: string } | null>;
/** true only when an explicit teacher_student_links row exists for (teacher, student). */
export type RosterCheck = (teacherId: string, studentId: string) => Promise<boolean>;

export type AccessResult = { ok: true; scope: ReportScope } | { ok: false; status: 403 | 404 };

/**
 * The admin Reporter policy, stated explicitly so it is reviewable and testable
 * rather than inherited. Admins run centre operations (account approval, content
 * management), so they may see the all-students cohort and any single student, but
 * never the owner-only centre report (staff counts, provider provenance, support).
 * Changing admin reach means changing THIS object, and the tests pin it.
 */
export const ADMIN_REPORT_POLICY = Object.freeze({
  ownerScope: false,
  cohort: "all_students" as const,
  student: "any_student" as const,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function allowedScopes(role: Role): ScopeKind[] {
  switch (role) {
    case "owner": return ["owner", "teacher", "student"];
    case "admin": return ADMIN_REPORT_POLICY.ownerScope ? ["owner", "teacher", "student"] : ["teacher", "student"];
    case "teacher": return ["teacher", "student"];
    default: return ["student"];
  }
}

async function visibleStudent(id: string | null | undefined, lookup: SubjectLookup) {
  const value = id ?? "";
  if (!UUID.test(value)) return null;
  const subject = await lookup(value);
  return subject && subject.role === "student" ? subject : null;
}

export async function authorizeReport(
  actor: Actor,
  requested: { scope: ScopeKind; subjectId?: string | null },
  lookup: SubjectLookup,
  rosterCheck?: RosterCheck,
): Promise<AccessResult> {
  if (!allowedScopes(actor.role).includes(requested.scope)) return { ok: false, status: 403 };

  switch (actor.role) {
    case "owner": {
      if (requested.scope === "owner") return { ok: true, scope: { kind: "owner" } };
      if (requested.scope === "teacher") return { ok: true, scope: { kind: "teacher", teacherId: null } };
      const subject = await visibleStudent(requested.subjectId, lookup);
      return subject ? { ok: true, scope: { kind: "student", subjectId: subject.id, subjectName: subject.name } } : { ok: false, status: 404 };
    }
    case "admin": {
      if (requested.scope === "owner") return { ok: true, scope: { kind: "owner" } }; // reachable only if policy grants it
      if (requested.scope === "teacher") return { ok: true, scope: { kind: "teacher", teacherId: null } };
      const subject = await visibleStudent(requested.subjectId, lookup);
      return subject ? { ok: true, scope: { kind: "student", subjectId: subject.id, subjectName: subject.name } } : { ok: false, status: 404 };
    }
    case "teacher": {
      if (requested.scope === "teacher") return { ok: true, scope: { kind: "teacher", teacherId: actor.id } };
      const subject = await visibleStudent(requested.subjectId, lookup);
      if (!subject || !rosterCheck) return { ok: false, status: 404 };
      let assigned = false;
      try { assigned = await rosterCheck(actor.id, subject.id); } catch { assigned = false; }
      // Not on the roster is indistinguishable from "does not exist".
      return assigned ? { ok: true, scope: { kind: "student", subjectId: subject.id, subjectName: subject.name } } : { ok: false, status: 404 };
    }
    default: {
      // A student's report is always their own; any other id is invisible.
      if (requested.subjectId && requested.subjectId !== actor.id) return { ok: false, status: 404 };
      return { ok: true, scope: { kind: "student", subjectId: actor.id, subjectName: actor.name } };
    }
  }
}
