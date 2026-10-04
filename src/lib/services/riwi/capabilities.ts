import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";

/** Every permission RIWI can ask the application to perform. Unknown values deny. */
export const RIWI_CAPABILITIES = [
  "riwi.chat.self",
  "riwi.dictionary.lookup",
  "riwi.dictionary.context_explain",
  "riwi.progress.read_self",
  "riwi.progress.read_assigned",
  "riwi.report.read_self",
  "riwi.report.read_assigned",
  "riwi.report.read_admin_scope",
  "riwi.report.read_global",
  "riwi.feedback.student",
  "riwi.feedback.teacher",
  "riwi.knowledge.submit_candidate",
  "riwi.knowledge.review",
  "riwi.knowledge.approve",
  "riwi.knowledge.promote",
  "riwi.knowledge.supersede",
  "riwi.provider.read_status",
  "riwi.provider.configure",
  "riwi.provider.live_test",
  "riwi.audit.read_owner",
  "riwi.users.read_scoped",
  "riwi.users.mutate_scoped",
  "riwi.content.read",
  "riwi.content.mutate",
  "riwi.content.publish",
  "riwi.analytics.read_global",
  "riwi.system.health",
  "riwi.external.research_sanitized",
] as const;

export type RiwiCapability = (typeof RIWI_CAPABILITIES)[number];
export type RiwiActor = { id: string; role: Role; accountStatus: AccountStatus };

const STUDENT = [
  "riwi.chat.self", "riwi.dictionary.lookup", "riwi.dictionary.context_explain",
  "riwi.progress.read_self", "riwi.report.read_self", "riwi.feedback.student",
  "riwi.knowledge.submit_candidate", "riwi.content.read",
] as const satisfies readonly RiwiCapability[];
const TEACHER = [
  "riwi.chat.self", "riwi.dictionary.lookup", "riwi.dictionary.context_explain",
  "riwi.progress.read_self", "riwi.progress.read_assigned", "riwi.report.read_self", "riwi.report.read_assigned",
  "riwi.feedback.student", "riwi.feedback.teacher", "riwi.knowledge.submit_candidate", "riwi.content.read",
] as const satisfies readonly RiwiCapability[];
const ADMIN = [
  "riwi.chat.self", "riwi.dictionary.lookup", "riwi.dictionary.context_explain",
  "riwi.report.read_admin_scope", "riwi.users.read_scoped", "riwi.users.mutate_scoped",
  "riwi.content.read", "riwi.content.mutate", "riwi.content.publish",
] as const satisfies readonly RiwiCapability[];
const OWNER = [
  "riwi.chat.self", "riwi.dictionary.lookup", "riwi.dictionary.context_explain",
  "riwi.progress.read_self", "riwi.progress.read_assigned", "riwi.report.read_self",
  "riwi.report.read_assigned", "riwi.report.read_admin_scope", "riwi.report.read_global",
  "riwi.feedback.student", "riwi.feedback.teacher", "riwi.knowledge.submit_candidate",
  "riwi.knowledge.review", "riwi.knowledge.approve", "riwi.knowledge.promote", "riwi.knowledge.supersede",
  "riwi.provider.read_status", "riwi.provider.configure", "riwi.provider.live_test", "riwi.audit.read_owner",
  "riwi.users.read_scoped", "riwi.users.mutate_scoped", "riwi.content.read", "riwi.content.mutate",
  "riwi.content.publish", "riwi.analytics.read_global", "riwi.system.health", "riwi.external.research_sanitized",
] as const satisfies readonly RiwiCapability[];

/** Explicit role map: higher roles do not inherit powers by rank. */
export const ROLE_CAPABILITIES: Readonly<Record<Role, readonly RiwiCapability[]>> = Object.freeze({
  student: STUDENT,
  teacher: TEACHER,
  admin: ADMIN,
  owner: OWNER,
});

export type PolicyDecision = { allowed: true } | { allowed: false; reason: "inactive" | "capability_denied" };

export function isRiwiCapability(value: unknown): value is RiwiCapability {
  return typeof value === "string" && (RIWI_CAPABILITIES as readonly string[]).includes(value);
}

/** Account state and role are server-derived. Missing/malformed values fail closed. */
export function authorizeCapability(actor: RiwiActor, capability: unknown): PolicyDecision {
  if (actor.accountStatus !== "active") return { allowed: false, reason: "inactive" };
  if (!isRiwiCapability(capability)) return { allowed: false, reason: "capability_denied" };
  return ROLE_CAPABILITIES[actor.role]?.includes(capability)
    ? { allowed: true }
    : { allowed: false, reason: "capability_denied" };
}

export type ScopeDecision =
  | { allowed: true; kind: "self"; userIds: readonly [string] }
  | { allowed: true; kind: "assigned"; userIds: readonly [string] }
  | { allowed: true; kind: "roster"; userIds: readonly [string] }
  | { allowed: true; kind: "admin-subject"; userIds: readonly [string] }
  | { allowed: true; kind: "staff"; userIds: readonly [string] }
  | { allowed: true; kind: "admin" | "global"; userIds: null }
  | { allowed: false; reason: "scope_denied" | "not_found" };

export type ScopeDependencies = {
  subjectRole: (userId: string) => Promise<Role | null>;
  isAssigned: (teacherId: string, studentId: string) => Promise<boolean>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELF_SCOPED_CAPABILITIES = new Set<RiwiCapability>([
  "riwi.chat.self", "riwi.dictionary.lookup", "riwi.dictionary.context_explain",
  "riwi.feedback.student", "riwi.knowledge.submit_candidate", "riwi.content.read",
]);

/**
 * Resolves the requested user row on the server. A caller-supplied user id is
 * never authority: student=self; teacher=explicit roster; staff scopes are
 * explicit and role-limited. Missing and unassigned users are indistinguishable.
 */
export async function resolveUserScope(
  actor: RiwiActor,
  capability: RiwiCapability,
  targetUserId: string | null | undefined,
  deps: ScopeDependencies,
): Promise<ScopeDecision> {
  const permission = authorizeCapability(actor, capability);
  if (!permission.allowed) return { allowed: false, reason: "scope_denied" };
  if (capability.endsWith("_self")) {
    if (targetUserId && targetUserId !== actor.id) return { allowed: false, reason: "not_found" };
    return { allowed: true, kind: "self", userIds: [actor.id] };
  }
  if (capability.endsWith("_assigned")) {
    if (!targetUserId || !UUID.test(targetUserId)) return { allowed: false, reason: "not_found" };
    let role: Role | null = null;
    try { role = await deps.subjectRole(targetUserId); } catch { return { allowed: false, reason: "not_found" }; }
    if (role !== "student") return { allowed: false, reason: "not_found" };
    if (actor.role === "owner") return { allowed: true, kind: "assigned", userIds: [targetUserId] };
    if (actor.role !== "teacher") return { allowed: false, reason: "scope_denied" };
    try {
      return await deps.isAssigned(actor.id, targetUserId)
        ? { allowed: true, kind: "assigned", userIds: [targetUserId] }
        : { allowed: false, reason: "not_found" };
    } catch {
      return { allowed: false, reason: "not_found" };
    }
  }
  if (capability === "riwi.report.read_admin_scope") {
    if (actor.role !== "admin" && actor.role !== "owner") return { allowed: false, reason: "scope_denied" };
    if (!targetUserId) return { allowed: true, kind: "admin", userIds: null };
    if (!UUID.test(targetUserId)) return { allowed: false, reason: "not_found" };
    let role: Role | null = null;
    try { role = await deps.subjectRole(targetUserId); } catch { return { allowed: false, reason: "not_found" }; }
    return role === "student"
      ? { allowed: true, kind: "admin-subject", userIds: [targetUserId] }
      : { allowed: false, reason: "not_found" };
  }
  if (capability === "riwi.report.read_global" || capability === "riwi.analytics.read_global") {
    return actor.role === "owner" && !targetUserId
      ? { allowed: true, kind: "global", userIds: null }
      : { allowed: false, reason: targetUserId ? "not_found" : "scope_denied" };
  }
  if (capability === "riwi.users.read_scoped" || capability === "riwi.users.mutate_scoped") {
    if (!targetUserId || !UUID.test(targetUserId)) return { allowed: false, reason: "not_found" };
    let role: Role | null = null;
    try { role = await deps.subjectRole(targetUserId); } catch { return { allowed: false, reason: "not_found" }; }
    if (!role) return { allowed: false, reason: "not_found" };
    if (actor.role === "owner") return { allowed: true, kind: "staff", userIds: [targetUserId] };
    return actor.role === "admin" && (role === "student" || role === "teacher")
      ? { allowed: true, kind: "staff", userIds: [targetUserId] }
      : { allowed: false, reason: "not_found" };
  }
  if (SELF_SCOPED_CAPABILITIES.has(capability)) {
    if (targetUserId && targetUserId !== actor.id) return { allowed: false, reason: "not_found" };
    return { allowed: true, kind: "self", userIds: [actor.id] };
  }
  return { allowed: false, reason: "scope_denied" };
}
