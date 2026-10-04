import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { Role } from "../src/lib/auth/roles";
import type { RiwiActor, ScopeDecision } from "../src/lib/services/riwi/capabilities";
import { RiwiToolBroker, type RiwiToolAuditEvent, type RiwiToolContract } from "../src/lib/services/riwi/tool-broker";

const STUDENT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const OWNER_ID = "aaaaaaaa-0000-4000-8000-000000000004";
const CORRELATION_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const actor = (id: string, role: Role): RiwiActor => ({ id, role, accountStatus: "active" });
const selfScope: (value: RiwiActor) => Promise<ScopeDecision> = async (value) => ({
  allowed: true, kind: "self", userIds: [value.id],
});

function contract(input: Partial<RiwiToolContract> = {}): RiwiToolContract {
  return {
    name: "test.read", version: "1", description: "bounded test read", capability: "riwi.progress.read_self",
    riskClass: "read-only", inputSchema: z.object({}).strict(), outputSchema: z.object({ value: z.string() }).strict(),
    timeoutMs: 100, idempotencyMode: "none", auditMode: "required", externalDataClass: "none",
    allowedRoles: ["student"], rowScopeResolver: async (value) => ({ allowed: true, kind: "self", userIds: [value.id] }),
    confirmationRequired: false, ...input,
  };
}

const createBroker = (events: RiwiToolAuditEvent[] = []) => new RiwiToolBroker(async (event) => {
  events.push(event);
});

test("registration requires bounded schemas, policy, timeout and mandatory audit", async () => {
  const broker = createBroker();
  const handler = async () => ({ value: "ok" });
  assert.throws(() => broker.register(contract({ timeoutMs: 0 }), handler), /riwi_tool_invalid_timeout/);
  assert.throws(() => broker.register(contract({ timeoutMs: 60_001 }), handler), /riwi_tool_invalid_timeout/);
  assert.throws(() => broker.register(contract({ auditMode: "metadata" }), handler), /riwi_tool_audit_required/);
  assert.throws(() => broker.register(contract({ riskClass: "outbound", externalDataClass: "none" }), handler), /riwi_tool_external_data_policy/);
  assert.throws(() => broker.register(contract({ riskClass: "high-impact-write", idempotencyMode: "business-key" }), handler), /riwi_tool_write_policy/);

  const mutableRoles: Role[] = ["student"];
  const sourceContract = contract({ name: "test.immutable", allowedRoles: mutableRoles });
  broker.register(sourceContract, handler);
  mutableRoles[0] = "owner";
  assert.ok(Object.isFrozen(broker.contract("test.immutable")));
  assert.ok(Object.isFrozen(broker.contract("test.immutable")?.allowedRoles));
  assert.deepEqual(await broker.call("test.immutable", {}, { actor: actor(OWNER_ID, "owner"), correlationId: CORRELATION_ID }), {
    ok: false, code: "riwi_permission_denied",
  }, "mutating the original roles array cannot elevate the registered tool");
});

test("invocation checks actor, strict input, scope, output and confirmation before executing", async () => {
  const events: RiwiToolAuditEvent[] = [];
  const broker = createBroker(events);
  let executed = 0;
  broker.register(contract({ rowScopeResolver: selfScope }), async () => { executed++; return { value: "ok" }; });
  assert.deepEqual(await broker.call("test.read", {}, { actor: actor(STUDENT_ID, "student"), correlationId: CORRELATION_ID }), {
    ok: true, value: { value: "ok" },
  });
  assert.deepEqual(events.map((event) => event.action), ["riwi.tool.invoked", "riwi.tool.succeeded"]);

  assert.deepEqual(await broker.call("test.read", { extra: "denied" }, { actor: actor(STUDENT_ID, "student"), correlationId: CORRELATION_ID }), {
    ok: false, code: "riwi_tool_invalid_input",
  });
  assert.deepEqual(await broker.call("test.read", {}, { actor: actor(OWNER_ID, "owner"), correlationId: CORRELATION_ID }), {
    ok: false, code: "riwi_permission_denied",
  });

  const scoped = createBroker();
  scoped.register(contract({ name: "test.scoped", rowScopeResolver: async () => ({ allowed: false, reason: "not_found" }) }), async () => ({ value: "must-not-run" }));
  assert.deepEqual(await scoped.call("test.scoped", {}, { actor: actor(STUDENT_ID, "student"), correlationId: CORRELATION_ID }), {
    ok: false, code: "riwi_scope_denied",
  });

  const invalidOutput = createBroker();
  invalidOutput.register(contract({ name: "test.bad-output", rowScopeResolver: selfScope }), async () => ({ extra: true }) as never);
  assert.deepEqual(await invalidOutput.call("test.bad-output", {}, { actor: actor(STUDENT_ID, "student"), correlationId: CORRELATION_ID }), {
    ok: false, code: "riwi_tool_failed",
  });

  const confirmations: RiwiToolAuditEvent[] = [];
  const confirmation = createBroker(confirmations);
  confirmation.register(contract({ name: "test.confirm", riskClass: "high-impact-write", idempotencyMode: "business-key", confirmationRequired: true }), async () => {
    executed++;
    return { value: "must-not-run" };
  });
  assert.deepEqual(await confirmation.call("test.confirm", {}, { actor: actor(STUDENT_ID, "student"), correlationId: CORRELATION_ID }), {
    ok: false, code: "riwi_action_confirmation_required",
  });
  assert.equal(confirmations[0]?.action, "riwi.action.confirmation.required");
  assert.equal(executed, 1, "confirmation-required writes never run through the generic call path");
});

test("unknown tool names are not logged; audit failures, timeouts, and request aborts fail closed", async () => {
  const unknownEvents: RiwiToolAuditEvent[] = [];
  const unknown = createBroker(unknownEvents);
  assert.deepEqual(await unknown.call("untrusted-model-tool-name", {}, { actor: actor(STUDENT_ID, "student"), correlationId: CORRELATION_ID }), {
    ok: false, code: "riwi_tool_not_found",
  });
  assert.equal(unknownEvents[0]?.targetId, undefined);
  assert.equal(unknownEvents[0]?.metadata.status, "tool_not_found");

  const failingAudit = new RiwiToolBroker(async () => { throw new Error("audit unavailable"); });
  failingAudit.register(contract({ rowScopeResolver: selfScope }), async () => ({ value: "must-not-run" }));
  assert.deepEqual(await failingAudit.call("test.read", {}, { actor: actor(STUDENT_ID, "student"), correlationId: CORRELATION_ID }), {
    ok: false, code: "riwi_tool_failed",
  });

  const failedEvents: RiwiToolAuditEvent[] = [];
  const timeout = createBroker(failedEvents);
  timeout.register(contract({ name: "test.timeout", timeoutMs: 10, rowScopeResolver: selfScope }), async (_value, context) => new Promise((_resolve, reject) => {
    context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  assert.deepEqual(await timeout.call("test.timeout", {}, { actor: actor(STUDENT_ID, "student"), correlationId: CORRELATION_ID }), {
    ok: false, code: "riwi_tool_timeout",
  });

  const cancelled = createBroker(failedEvents);
  let executed = 0;
  cancelled.register(contract({ name: "test.cancel", rowScopeResolver: selfScope }), async () => {
    executed++;
    return new Promise(() => {});
  });
  const preAborted = new AbortController();
  preAborted.abort();
  assert.deepEqual(await cancelled.call("test.cancel", {}, { actor: actor(STUDENT_ID, "student"), correlationId: CORRELATION_ID, signal: preAborted.signal }), {
    ok: false, code: "riwi_tool_failed",
  });
  assert.equal(executed, 0);
  const requestAbort = new AbortController();
  const pending = cancelled.call("test.cancel", {}, { actor: actor(STUDENT_ID, "student"), correlationId: CORRELATION_ID, signal: requestAbort.signal });
  setTimeout(() => requestAbort.abort(), 5);
  assert.deepEqual(await pending, { ok: false, code: "riwi_tool_failed" });
  assert.equal(executed, 1);
  assert.ok(failedEvents.some((event) => event.action === "riwi.tool.failed" && event.metadata.status === "request_cancelled"));
});
