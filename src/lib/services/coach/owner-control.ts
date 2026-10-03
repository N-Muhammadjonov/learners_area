import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import { readCoachConfig, RIWI_PROVIDER_ID, type CoachConfig } from "./config";
import { providerRegistry } from "./registry";

/**
 * Owner master switch for external AI, enforced on the SERVER.
 *
 * Storage: the append-only `audit_log` (action `ai.control.set`). Every change
 * is therefore an audit record by construction (who, when, what), and the
 * current state is simply the latest event — no new table or migration.
 *
 * Effective configuration = deployment ceiling AND owner switch:
 *   externalEnabled = AI_EXTERNAL_ENABLED (env) && owner.externalEnabled
 *   aiPrimaryProvider = owner.providerId when it is a registered provider, else env
 * The owner can turn external AI OFF at any time, and choose among REGISTERED
 * providers only (no endpoint, key or URL is ever accepted from a request).
 *
 * Fail-closed: if the switch cannot be read, external AI is OFF. Everything
 * that does not need external AI (RIWI checks, exams, progress, uploads…)
 * keeps working because it never consults this switch.
 */

export const AI_CONTROL_ACTION = "ai.control.set" as const;

export type OwnerAiControl = {
  externalEnabled: boolean;
  providerId: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  source: "owner" | "default" | "unavailable";
};

const controlSchema = z.object({ externalEnabled: z.boolean(), providerId: z.string().max(64).nullable() }).strict();

type Reader = Pick<typeof db, "select">;

export async function readOwnerAiControl(database: Reader = db): Promise<OwnerAiControl> {
  try {
    const [row] = await database
      .select({ metadata: auditLog.metadata, createdAt: auditLog.createdAt, actorUserId: auditLog.actorUserId })
      .from(auditLog)
      .where(eq(auditLog.action, AI_CONTROL_ACTION))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    if (!row) return { externalEnabled: true, providerId: null, updatedAt: null, updatedBy: null, source: "default" };
    const parsed = controlSchema.safeParse(row.metadata);
    if (!parsed.success) return { externalEnabled: false, providerId: null, updatedAt: row.createdAt, updatedBy: row.actorUserId, source: "unavailable" };
    return { ...parsed.data, updatedAt: row.createdAt, updatedBy: row.actorUserId, source: "owner" };
  } catch {
    return { externalEnabled: false, providerId: null, updatedAt: null, updatedBy: null, source: "unavailable" };
  }
}

/** Pure: combine the deployment ceiling with the owner switch. */
export function combineControl(env: CoachConfig, owner: OwnerAiControl, isRegistered: (id: string) => boolean = (id) => providerRegistry.has(id)): CoachConfig {
  const chosen = owner.providerId?.toLowerCase() ?? null;
  return {
    ...env,
    externalEnabled: env.externalEnabled && owner.externalEnabled,
    aiPrimaryProvider: chosen && isRegistered(chosen) ? chosen : env.aiPrimaryProvider,
  };
}

/** The configuration every production AI entry point must use. */
export async function effectiveCoachConfig(database: Reader = db): Promise<CoachConfig> {
  return combineControl(readCoachConfig(), await readOwnerAiControl(database));
}

export class AiControlError extends Error {
  constructor(public readonly code: "unknown_provider") { super(code); }
}

/** Owner-only (the route authorizes). Provider must be registered; RIWI = internal only. */
export async function setOwnerAiControl(
  actorUserId: string,
  input: { externalEnabled: boolean; providerId: string | null },
  connection: Pick<typeof db, "insert"> = db,
): Promise<void> {
  const providerId = input.providerId?.trim().toLowerCase() || null;
  if (providerId && providerId !== RIWI_PROVIDER_ID && !providerRegistry.has(providerId)) throw new AiControlError("unknown_provider");
  await recordAudit({
    actorUserId,
    action: AI_CONTROL_ACTION,
    targetType: "ai_control",
    targetId: "global",
    metadata: { externalEnabled: input.externalEnabled, providerId },
  }, connection);
}

export type OwnerProviderStatus = {
  id: string;
  displayName: string;
  type: "internal" | "external";
  model: string | null;
  capabilities: string[];
  /** Whether every required secret is present — the values are never read out. */
  secretsPresent: boolean;
  /** Env var NAMES that are missing (names only, safe for the owner). */
  missingSecretNames: string[];
};

export type OwnerAiStatus = {
  deploymentCeiling: boolean;
  owner: OwnerAiControl;
  effective: { externalEnabled: boolean; providerId: string; providerIsExternal: boolean; ready: boolean };
  providers: OwnerProviderStatus[];
  configIssues: Array<{ index: number; reason: string }>;
};

/** Owner diagnostics. Contains no secret values, no keys and no endpoint URLs. */
export async function ownerAiStatus(env: NodeJS.ProcessEnv = process.env, database: Reader = db): Promise<OwnerAiStatus> {
  const { parseCompatibleProviders } = await import("./providers/compatible");
  const base = readCoachConfig();
  const owner = await readOwnerAiControl(database);
  const effective = combineControl(base, owner);
  const providers: OwnerProviderStatus[] = providerRegistry.ids().map((id) => {
    const p = providerRegistry.get(id)!.provider;
    const missing = p.requiredSecrets.filter((name) => !env[name]?.trim());
    return { id: p.id, displayName: p.displayName, type: p.type, model: p.model, capabilities: [...p.capabilities], secretsPresent: missing.length === 0, missingSecretNames: [...missing] };
  });
  const chosen = providers.find((p) => p.id === effective.aiPrimaryProvider);
  const providerIsExternal = chosen?.type === "external";
  return {
    deploymentCeiling: base.externalEnabled,
    owner,
    effective: {
      externalEnabled: effective.externalEnabled,
      providerId: effective.aiPrimaryProvider,
      providerIsExternal,
      ready: Boolean(effective.externalEnabled && providerIsExternal && chosen?.secretsPresent),
    },
    providers,
    configIssues: parseCompatibleProviders(env.AI_COMPATIBLE_PROVIDERS, env.AI_COMPATIBLE_ALLOWED_HOSTS).issues,
  };
}
