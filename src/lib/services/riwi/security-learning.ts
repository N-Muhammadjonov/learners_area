import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { riwiSecuritySignals, users } from "@/db/schema";
import type { RiwiActor } from "./capabilities";

export const RIWI_SECURITY_SIGNAL_TYPES = [
  "prompt_injection", "role_spoof", "idor", "tool_injection", "provider_injection", "ssrf",
  "exfiltration", "secret_extraction", "exam_bypass", "replay", "toctou", "knowledge_poisoning",
  "assessment_policy_injection", "prompt_version_downgrade",
] as const;
export type RiwiSecuritySignalType = (typeof RIWI_SECURITY_SIGNAL_TYPES)[number];
const typeSchema = z.enum(RIWI_SECURITY_SIGNAL_TYPES);
const routeClassSchema = z.string().regex(/^[a-z0-9_.:/-]{1,120}$/);
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
  const tags = [...tagSchema.parse(input.tags ?? [])].sort();
  const fingerprint = digest(JSON.stringify([type, input.actorRole ?? null, routeClass, tags]));
  return {
    type, actorRole: input.actorRole ?? null, routeClass, tags, fingerprint,
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

export async function reviewSecuritySignal(input: {
  actor: RiwiActor; signalId: string;
  decision: "reject" | "developer_action_required" | "approve_regression";
  regressionFixtureId?: string; regressionEvidenceHash?: string;
}, database: typeof db = db) {
  if (input.actor.role !== "owner" || input.actor.accountStatus !== "active") throw new Error("not_found");
  const id = z.string().uuid().parse(input.signalId);
  const [stored] = await database.select({ role: users.role, accountStatus: users.accountStatus }).from(users).where(eq(users.id, input.actor.id)).limit(1).for("update");
  if (stored?.role !== "owner" || stored.accountStatus !== "active") throw new Error("not_found");
  const approved = input.decision === "approve_regression";
  const fixture = approved ? z.string().min(1).max(120).parse(input.regressionFixtureId) : null;
  const evidenceHash = approved ? z.string().regex(/^[a-f0-9]{64}$/).parse(input.regressionEvidenceHash) : null;
  const state = input.decision === "reject" ? "rejected" : input.decision === "developer_action_required" ? "developer_action_required" : "approved_regression";
  const [row] = await database.update(riwiSecuritySignals).set({
    state, regressionFixtureId: fixture, regressionEvidenceHash: evidenceHash,
    reviewedByUserId: input.actor.id, reviewedAt: new Date(),
  }).where(and(eq(riwiSecuritySignals.id, id), eq(riwiSecuritySignals.state, "candidate")))
    .returning({ id: riwiSecuritySignals.id, state: riwiSecuritySignals.state });
  if (!row) throw new Error("stale_or_not_found");
  return row;
}
