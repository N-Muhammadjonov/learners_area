import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog, riwiSecuritySignals, users } from "@/db/schema";
import type { RiwiActor } from "./capabilities";
import { recordRiwiAudit } from "./audit";
import { isRiwiRegressionFixture, runRiwiRegressionSuite } from "./golden/fixtures";

export const RIWI_SECURITY_SIGNAL_TYPES = [
  "prompt_injection", "role_spoof", "idor", "tool_injection", "provider_injection", "ssrf",
  "exfiltration", "secret_extraction", "exam_bypass", "replay", "toctou", "knowledge_poisoning",
  "assessment_policy_injection", "prompt_version_downgrade",
] as const;
export type RiwiSecuritySignalType = (typeof RIWI_SECURITY_SIGNAL_TYPES)[number];
const typeSchema = z.enum(RIWI_SECURITY_SIGNAL_TYPES);
export const RIWI_SECURITY_ROUTE_CLASSES = ["riwi.chat", "speaking.submit"] as const;
const routeClassSchema = z.enum(RIWI_SECURITY_ROUTE_CLASSES);
const actorRoleSchema = z.enum(["student", "teacher", "admin", "owner"]);
const tagSchema = z.array(z.enum(["direct", "encoded", "unicode", "document", "provider", "speaking", "repeated"])).max(5);

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function classifySecuritySignal(message: string): RiwiSecuritySignalType {
  const value = message.normalize("NFKC").toLowerCase();
  if (/(?:database_url|api.?key|r2.?secret|password|token|credential)/i.test(value)) return "secret_extraction";
  if (/(?:i am|i'm|pretend|role).{0,24}(?:owner|admin)/i.test(value)) return "role_spoof";
  if (/(?:other|another|boshqa|чуж).{0,40}(?:student|learner|o.quvchi|user)/i.test(value)) return "idor";
  if (/(?:raw sql|drop table|shell|exec\(|source code|call tool)/i.test(value)) return "tool_injection";
  return "prompt_injection";
}

/** No raw prompt, transcript, audio, identifier, URL, or secret enters this record. */
export function buildSecuritySignal(input: {
  type: RiwiSecuritySignalType;
  actorRole?: RiwiActor["role"];
  routeClass: string;
  tags?: readonly ("direct" | "encoded" | "unicode" | "document" | "provider" | "speaking" | "repeated")[];
}) {
  const type = typeSchema.parse(input.type);
  const routeClass = routeClassSchema.parse(input.routeClass);
  const tags = [...new Set(tagSchema.parse(input.tags ?? []))].sort();
  const actorRole = input.actorRole === undefined ? null : actorRoleSchema.parse(input.actorRole);
  const fingerprint = digest(JSON.stringify([type, actorRole, routeClass, tags]));
  return {
    type, actorRole: actorRole, routeClass, tags, fingerprint,
    sanitizedEvidence: `${type}; route=${routeClass}; traits=${tags.join(",") || "none"}`,
  } as const;
}

export async function recordSecuritySignal(input: Parameters<typeof buildSecuritySignal>[0], database: typeof db = db) {
  const signal = buildSecuritySignal(input);
  const [row] = await database.insert(riwiSecuritySignals).values({
    signalType: signal.type, fingerprint: signal.fingerprint, actorRole: signal.actorRole,
    routeClass: signal.routeClass, sanitizedEvidence: signal.sanitizedEvidence,
  }).onConflictDoUpdate({
    target: riwiSecuritySignals.fingerprint,
    set: { occurrenceCount: sql`${riwiSecuritySignals.occurrenceCount} + 1`, lastSeenAt: new Date() },
  }).returning({ id: riwiSecuritySignals.id, state: riwiSecuritySignals.state, occurrenceCount: riwiSecuritySignals.occurrenceCount });
  if (!row) throw new Error("security_signal_write_failed");
  return row;
}

export async function listSecuritySignals(actor: RiwiActor, database: typeof db = db) {
  if (actor.role !== "owner" || actor.accountStatus !== "active") throw new Error("not_found");
  const [stored] = await database.select({ role: users.role, accountStatus: users.accountStatus }).from(users).where(eq(users.id, actor.id)).limit(1);
  if (stored?.role !== "owner" || stored.accountStatus !== "active") throw new Error("not_found");
  return database.select({
    id: riwiSecuritySignals.id, type: riwiSecuritySignals.signalType, state: riwiSecuritySignals.state,
    count: riwiSecuritySignals.occurrenceCount, firstSeenAt: riwiSecuritySignals.firstSeenAt,
    lastSeenAt: riwiSecuritySignals.lastSeenAt, evidence: riwiSecuritySignals.sanitizedEvidence,
    regressionFixtureId: riwiSecuritySignals.regressionFixtureId,
  }).from(riwiSecuritySignals).orderBy(desc(riwiSecuritySignals.lastSeenAt), desc(riwiSecuritySignals.id)).limit(200);
}

function regressionFor(signal: typeof riwiSecuritySignals.$inferSelect) {
  // Bind proof to this exact signal revision; repeated observations invalidate an old preview.
  const target = digest(JSON.stringify([signal.id, signal.fingerprint, signal.occurrenceCount, signal.lastSeenAt.toISOString()]));
  return runRiwiRegressionSuite(target);
}

export async function previewSecuritySignal(actor: RiwiActor, signalId: string, database: typeof db = db) {
  if (actor.role !== "owner" || actor.accountStatus !== "active") throw new Error("not_found");
  const id = z.string().uuid().parse(signalId);
  return database.transaction(async tx => {
    const [stored] = await tx.select({ role: users.role, accountStatus: users.accountStatus }).from(users)
      .where(eq(users.id, actor.id)).limit(1).for("share");
    if (stored?.role !== "owner" || stored.accountStatus !== "active") throw new Error("not_found");
    const [signal] = await tx.select().from(riwiSecuritySignals).where(and(eq(riwiSecuritySignals.id, id), eq(riwiSecuritySignals.state, "candidate"))).for("share");
    if (!signal) throw new Error("stale_or_not_found");
    const regression = regressionFor(signal);
    await recordRiwiAudit({ actorUserId: actor.id, action: "riwi.security.regression.previewed", targetType: "riwi_security_signal", targetId: id,
      metadata: { role: actor.role, signalId: id, inputHash: regression.evidenceHash, status: regression.passed ? "passed" : "failed", resultCount: regression.checks.length } }, tx);
    return { signalId: id, ...regression };
  });
}

export async function reviewSecuritySignal(input: {
  actor: RiwiActor; signalId: string;
  decision: "reject" | "developer_action_required" | "approve_regression";
  regressionFixtureId?: string; regressionEvidenceHash?: string;
}, database: typeof db = db) {
  if (input.actor.role !== "owner" || input.actor.accountStatus !== "active") throw new Error("not_found");
  const id = z.string().uuid().parse(input.signalId);
  const decision = z.enum(["reject", "developer_action_required", "approve_regression"]).parse(input.decision);
  const approved = decision === "approve_regression";
  const fixture = approved ? z.string().min(1).max(120).parse(input.regressionFixtureId) : null;
  const evidenceHash = approved ? z.string().regex(/^[a-f0-9]{64}$/).parse(input.regressionEvidenceHash) : null;
  if (approved && !isRiwiRegressionFixture(fixture!)) throw new Error("regression_required");
  const state = decision === "reject" ? "rejected" : decision === "developer_action_required" ? "developer_action_required" : "approved_regression";
  return database.transaction(async tx => {
    const [stored] = await tx.select({ role: users.role, accountStatus: users.accountStatus }).from(users)
      .where(eq(users.id, input.actor.id)).limit(1).for("share");
    if (stored?.role !== "owner" || stored.accountStatus !== "active") throw new Error("not_found");
    const [signal] = await tx.select().from(riwiSecuritySignals).where(and(eq(riwiSecuritySignals.id, id), eq(riwiSecuritySignals.state, "candidate"))).for("update");
    if (!signal) throw new Error("stale_or_not_found");
    if (approved) {
      const regression = regressionFor(signal);
      if (!regression.passed || regression.evidenceHash !== evidenceHash || !regression.checks.some(check => check.fixtureId === fixture && check.passed)) throw new Error("regression_required");
      // A genuine server preview must have been recorded for this revision by this owner.
      const previews = await tx.select({ metadata: auditLog.metadata }).from(auditLog).where(and(eq(auditLog.actorUserId, input.actor.id), eq(auditLog.action, "riwi.security.regression.previewed"), eq(auditLog.targetId, id))).orderBy(desc(auditLog.createdAt)).limit(20);
      if (!previews.some(p => p.metadata && typeof p.metadata === "object" && (p.metadata as Record<string, unknown>).inputHash === evidenceHash && (p.metadata as Record<string, unknown>).status === "passed")) throw new Error("regression_required");
    }
    const [row] = await tx.update(riwiSecuritySignals).set({ state, regressionFixtureId: fixture, regressionEvidenceHash: evidenceHash, reviewedByUserId: input.actor.id, reviewedAt: new Date() })
      .where(eq(riwiSecuritySignals.id, id)).returning({ id: riwiSecuritySignals.id, state: riwiSecuritySignals.state });
    if (!row) throw new Error("stale_or_not_found");
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.security.reviewed", targetType: "riwi_security_signal", targetId: id,
      metadata: { role: input.actor.role, signalId: id, decision, status: state, ...(approved ? { inputHash: evidenceHash!, regressionFixtureId: fixture! } : {}) } }, tx);
    return row;
  });
}
