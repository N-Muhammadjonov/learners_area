import "server-only";
import { z, type ZodTypeAny } from "zod";
import type { Role } from "@/lib/auth/roles";
import { authorizeCapability, isRiwiCapability, type RiwiActor, type RiwiCapability, type ScopeDecision } from "./capabilities";
import { assertRiwiSiteAdapterCompatibility, currentAdapterActor, type RiwiSiteAdapter } from "./site-adapter";
export type RiwiRiskClass = "read-only" | "reversible-write" | "high-impact-write" | "outbound";
export type RiwiToolAuditEvent = {
  actorUserId: string | null;
  action: "riwi.request.denied" | "riwi.action.confirmation.required" | "riwi.tool.invoked" | "riwi.tool.succeeded" | "riwi.tool.failed";
  targetType?: string;
  targetId?: string;
  metadata: {
    correlationId: string;
    role: Role;
    capability?: RiwiCapability;
    toolName?: string;
    riskClass?: RiwiRiskClass;
    scopeKind?: Extract<ScopeDecision, { allowed: true }>["kind"];
    status?: string;
    durationMs?: number;
  };
};
export type RiwiToolAuditWriter = (event: RiwiToolAuditEvent) => Promise<void>;
export type RiwiToolContract<I extends ZodTypeAny = ZodTypeAny, O extends ZodTypeAny = ZodTypeAny> = {
  name: string;
  version: string;
  description: string;
  capability: RiwiCapability;
  riskClass: RiwiRiskClass;
  inputSchema: I;
  outputSchema: O;
  timeoutMs: number;
  idempotencyMode: "none" | "request-key" | "business-key";
  auditMode: "none" | "metadata" | "required";
  externalDataClass: "none" | "sanitized";
  allowedRoles: readonly Role[];
  rowScopeResolver: (actor: RiwiActor, input: z.infer<I>) => Promise<ScopeDecision>;
  confirmationRequired: boolean;
};

export type RiwiToolHandler<I extends ZodTypeAny, O extends ZodTypeAny> = (input: z.infer<I>, context: {
  actor: RiwiActor;
  correlationId: string;
  signal: AbortSignal;
  scope: ScopeDecision;
}) => Promise<z.infer<O>>;

type Registration = {
  contract: RiwiToolContract<ZodTypeAny, ZodTypeAny>;
  handler: RiwiToolHandler<ZodTypeAny, ZodTypeAny>;
};
export type ToolCallError = "riwi_tool_not_found" | "riwi_permission_denied" | "riwi_scope_denied" | "riwi_tool_invalid_input" | "riwi_tool_timeout" | "riwi_tool_failed" | "riwi_action_confirmation_required";
export type ToolCallResult = { ok: true; value: unknown } | { ok: false; code: ToolCallError };

const VALID_ROLES: readonly Role[] = ["student", "teacher", "admin", "owner"];
const VALID_RISK_CLASSES: readonly RiwiRiskClass[] = ["read-only", "reversible-write", "high-impact-write", "outbound"];
const VALID_IDEMPOTENCY_MODES: readonly RiwiToolContract["idempotencyMode"][] = ["none", "request-key", "business-key"];

function validateContract<I extends ZodTypeAny, O extends ZodTypeAny>(contract: RiwiToolContract<I, O>): void {
  if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/.test(contract.name) || typeof contract.version !== "string" || !contract.version || contract.version.length > 40) {
    throw new Error("riwi_tool_invalid_identity");
  }
  if (!contract.description || contract.description.length > 500) throw new Error("riwi_tool_invalid_description");
  if (!Number.isInteger(contract.timeoutMs) || contract.timeoutMs < 1 || contract.timeoutMs > 60_000) {
    throw new Error("riwi_tool_invalid_timeout");
  }
  if (!isRiwiCapability(contract.capability) || !VALID_RISK_CLASSES.includes(contract.riskClass) ||
      !VALID_IDEMPOTENCY_MODES.includes(contract.idempotencyMode) ||
      !["none", "sanitized"].includes(contract.externalDataClass) || typeof contract.confirmationRequired !== "boolean") {
    throw new Error("riwi_tool_invalid_policy");
  }
  if (contract.auditMode !== "required") throw new Error("riwi_tool_audit_required");
  if (contract.riskClass === "outbound" ? contract.externalDataClass !== "sanitized" : contract.externalDataClass !== "none") {
    throw new Error("riwi_tool_external_data_policy");
  }
  if (contract.riskClass === "reversible-write" || contract.riskClass === "high-impact-write") {
    if (!contract.confirmationRequired || contract.idempotencyMode === "none") throw new Error("riwi_tool_write_policy");
  }
  if (!Array.isArray(contract.allowedRoles) || contract.allowedRoles.length === 0 ||
      contract.allowedRoles.some((role) => !VALID_ROLES.includes(role)) ||
      new Set(contract.allowedRoles).size !== contract.allowedRoles.length) {
    throw new Error("riwi_tool_invalid_roles");
  }
  if (typeof contract.rowScopeResolver !== "function" || typeof contract.inputSchema?.safeParse !== "function" ||
      typeof contract.outputSchema?.safeParse !== "function") throw new Error("riwi_tool_invalid_contract");
}

export class RiwiToolBroker {
  private readonly registrations = new Map<string, Registration>();

  constructor(private readonly writeAudit: RiwiToolAuditWriter, private readonly siteAdapter?: RiwiSiteAdapter) {
    if (siteAdapter) assertRiwiSiteAdapterCompatibility(siteAdapter);
  }

  register<I extends ZodTypeAny, O extends ZodTypeAny>(contract: RiwiToolContract<I, O>, handler: RiwiToolHandler<I, O>): void {
    validateContract(contract);
    if (typeof handler !== "function") throw new Error("riwi_tool_invalid_handler");
    if (this.registrations.has(contract.name)) throw new Error("riwi_tool_duplicate");
    const immutableContract = Object.freeze({ ...contract, allowedRoles: Object.freeze([...contract.allowedRoles]) });
    this.registrations.set(contract.name, {
      contract: immutableContract as unknown as RiwiToolContract<ZodTypeAny, ZodTypeAny>,
      handler: handler as unknown as RiwiToolHandler<ZodTypeAny, ZodTypeAny>,
    });
  }

  names(): string[] { return [...this.registrations.keys()].sort(); }
  contract(name: string): RiwiToolContract | null { return this.registrations.get(name)?.contract ?? null; }

  async call(name: string, rawInput: unknown, input: { actor: RiwiActor; correlationId: string; signal?: AbortSignal }): Promise<ToolCallResult> {
    const registration = this.registrations.get(name);
    if (!registration) {
      await this.writeAudit({ actorUserId: input.actor.id, action: "riwi.request.denied", targetType: "riwi_tool",
        metadata: { correlationId: input.correlationId, role: input.actor.role, status: "tool_not_found" } }).catch(() => {});
      return { ok: false, code: "riwi_tool_not_found" };
    }
    const { contract, handler } = registration;
    if (this.siteAdapter && !await currentAdapterActor(this.siteAdapter, input.actor, contract.timeoutMs, input.signal)) {
      await this.auditDenied(input.actor, input.correlationId, contract);
      return { ok: false, code: "riwi_permission_denied" };
    }
    const policy = authorizeCapability(input.actor, contract.capability);
    if (!policy.allowed || !contract.allowedRoles.includes(input.actor.role)) {
      await this.auditDenied(input.actor, input.correlationId, contract);
      return { ok: false, code: "riwi_permission_denied" };
    }
    const parsed = contract.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      await this.auditDenied(input.actor, input.correlationId, contract, "invalid_input");
      return { ok: false, code: "riwi_tool_invalid_input" };
    }
    let scope: ScopeDecision;
    try { scope = await contract.rowScopeResolver(input.actor, parsed.data); }
    catch { scope = { allowed: false, reason: "scope_denied" }; }
    if (!scope.allowed) {
      await this.auditDenied(input.actor, input.correlationId, contract, scope.reason);
      return { ok: false, code: "riwi_scope_denied" };
    }
    if (contract.confirmationRequired) {
      try {
        await this.writeAudit({ actorUserId: input.actor.id, action: "riwi.action.confirmation.required", targetType: "riwi_tool", targetId: contract.name,
          metadata: { correlationId: input.correlationId, role: input.actor.role, capability: contract.capability, toolName: contract.name,
            riskClass: contract.riskClass, scopeKind: scope.kind, status: "confirmation_required" } });
      } catch { return { ok: false, code: "riwi_tool_failed" }; }
      return { ok: false, code: "riwi_action_confirmation_required" };
    }

    const started = Date.now();
    if (contract.auditMode === "required") {
      try {
        await this.writeAudit({ actorUserId: input.actor.id, action: "riwi.tool.invoked", targetType: "riwi_tool", targetId: contract.name,
          metadata: { correlationId: input.correlationId, role: input.actor.role, capability: contract.capability, toolName: contract.name, riskClass: contract.riskClass, scopeKind: scope.kind, status: "started" } });
      } catch { return { ok: false, code: "riwi_tool_failed" }; }
    }

    const controller = new AbortController();
    let requestCancelled = false;
    let rejectCancellation: ((reason?: unknown) => void) | undefined;
    const abort = () => {
      requestCancelled = true;
      controller.abort();
      rejectCancellation?.(new Error("riwi_request_cancelled"));
    };
    if (input.signal?.aborted) {
      abort();
      await this.auditFailure(input.actor, input.correlationId, contract, "request_cancelled", 0).catch(() => {});
      return { ok: false, code: "riwi_tool_failed" };
    }
    const cancelled = input.signal
      ? new Promise<never>((_, reject) => { rejectCancellation = reject; })
      : new Promise<never>(() => {});
    input.signal?.addEventListener("abort", abort, { once: true });
    let timeoutHit = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timeoutHandle = setTimeout(() => { timeoutHit = true; controller.abort(); reject(new Error("riwi_tool_timeout")); }, contract.timeoutMs); });
    try {
      const handlerPromise = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error("riwi_request_cancelled");
        return (async () => {
          if (this.siteAdapter && !await currentAdapterActor(this.siteAdapter, input.actor, contract.timeoutMs, controller.signal)) throw new Error("riwi_actor_revoked");
          if (controller.signal.aborted) throw new Error("riwi_request_cancelled");
          return handler(parsed.data, { actor: input.actor, correlationId: input.correlationId, signal: controller.signal, scope });
        })();
      });
      const rawResult = await Promise.race([handlerPromise, timeout, cancelled]);
      if (this.siteAdapter && !await currentAdapterActor(this.siteAdapter, input.actor, contract.timeoutMs, controller.signal)) {
        await this.auditDenied(input.actor, input.correlationId, contract);
        return { ok: false, code: "riwi_permission_denied" };
      }
      const output = contract.outputSchema.safeParse(rawResult);
      if (!output.success) {
        if (contract.auditMode === "required") await this.auditFailure(input.actor, input.correlationId, contract, "invalid_output", Date.now() - started);
        return { ok: false, code: "riwi_tool_failed" };
      }
      if (contract.auditMode !== "none") {
        try {
          await this.writeAudit({ actorUserId: input.actor.id, action: "riwi.tool.succeeded", targetType: "riwi_tool", targetId: contract.name,
            metadata: { correlationId: input.correlationId, role: input.actor.role, capability: contract.capability, toolName: contract.name, riskClass: contract.riskClass, scopeKind: scope.kind, durationMs: Date.now() - started, status: "succeeded" } });
        } catch { return { ok: false, code: "riwi_tool_failed" }; }
      }
      // Success auditing is asynchronous: revocation while it runs must still
      // suppress the returned data. Adapter lookups also honor cancellation.
      if (this.siteAdapter && !await currentAdapterActor(this.siteAdapter, input.actor, contract.timeoutMs, controller.signal)) {
        await this.auditDenied(input.actor, input.correlationId, contract);
        return { ok: false, code: "riwi_permission_denied" };
      }
      if (controller.signal.aborted) return { ok: false, code: requestCancelled ? "riwi_tool_failed" : "riwi_tool_timeout" };
      return { ok: true, value: output.data };
    } catch (error) {
      if (!requestCancelled && !timeoutHit && error instanceof Error && error.message === "riwi_actor_revoked") {
        await this.auditDenied(input.actor, input.correlationId, contract);
        return { ok: false, code: "riwi_permission_denied" };
      }
      const code = timeoutHit || (controller.signal.aborted && !requestCancelled) ? "riwi_tool_timeout" : "riwi_tool_failed";
      const auditCode = requestCancelled ? "request_cancelled" : code;
      if (contract.auditMode !== "none") await this.auditFailure(input.actor, input.correlationId, contract, auditCode, Date.now() - started).catch(() => {});
      return { ok: false, code };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      input.signal?.removeEventListener("abort", abort);
    }
  }

  private async auditDenied(actor: RiwiActor, correlationId: string, contract: RiwiToolContract, code = "permission_denied") {
    await this.writeAudit({ actorUserId: actor.id, action: "riwi.request.denied", targetType: "riwi_tool", targetId: contract.name,
      metadata: { correlationId, role: actor.role, capability: contract.capability, toolName: contract.name, status: code } }).catch(() => {});
  }

  private async auditFailure(actor: RiwiActor, correlationId: string, contract: RiwiToolContract, code: string, durationMs: number) {
    await this.writeAudit({ actorUserId: actor.id, action: "riwi.tool.failed", targetType: "riwi_tool", targetId: contract.name,
      metadata: { correlationId, role: actor.role, capability: contract.capability, toolName: contract.name, riskClass: contract.riskClass, status: code, durationMs } });
  }
}
