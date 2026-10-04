import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES, accountKey, clientKey, consume } from "@/lib/http/rate-limit";
import { MODEL_ID, ownerAiStatus } from "@/lib/services/coach/owner-control";
import { authorizeCapability } from "@/lib/services/riwi/capabilities";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { readRiwiRollout } from "@/lib/services/riwi/rollout";
import {
  countRiwiProviderExperiments,
  listRiwiProviderExperimentPage,
  riwiProviderLabRequestSchema,
  runRiwiProviderExperiment,
  RiwiProviderLabError,
} from "@/lib/services/riwi/provider-lab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const providerSchema = z.object({
  id: z.string().max(60), displayName: z.string().max(120), type: z.literal("external"), model: z.string().max(120).nullable(),
  capabilities: z.array(z.string().max(100)).max(50), secretsPresent: z.boolean(), missingSecretNames: z.array(z.string().max(100)).max(20),
}).strict();
const normalizedSchema = z.object({ answer: z.string().max(6000), uncertainty: z.string().max(600).nullable(), citations: z.array(z.string().regex(/^K[1-5]$/)).max(5) }).strict().nullable();
const experimentSchema = z.object({
  id: z.string().uuid(), taskProfile: z.string().max(60), fixtureId: z.string().max(120),
  providers: z.array(z.string().max(60)).max(2), state: z.enum(["pending", "running", "completed", "partial", "failed"]),
  createdAt: z.string().datetime(), completedAt: z.string().datetime().nullable(),
  comparison: z.object({
    method: z.literal("normalized_exact_answer_text"), status: z.enum(["compared", "not_comparable"]),
    providerIds: z.array(z.string().max(60)).max(2), exactAnswerMatch: z.boolean().nullable(),
  }).strict().nullable(),
  results: z.array(z.object({
    providerId: z.string().max(60), model: z.string().max(120).nullable(), state: z.string().max(24),
    normalizedResult: normalizedSchema, durationMs: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
    estimatedCostMicros: z.number().int().nonnegative().nullable(), safeErrorCode: z.string().max(60).nullable(),
  }).strict()).max(2),
}).strict();
const getResponseSchema = z.object({
  ok: z.literal(true), enabled: z.object({ owner: z.boolean(), providerLab: z.boolean(), externalAi: z.boolean() }).strict(),
  providers: z.array(providerSchema).max(50), experiments: z.array(experimentSchema).max(50),
  nextCursor: z.string().max(2048).nullable(), experimentCount: z.number().int().nonnegative(),
}).strict();
const postResponseSchema = z.object({ ok: z.literal(true), replay: z.boolean(), experiment: experimentSchema }).strict();

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" } });
}
function denied(status: number, code = "not_found") { return json({ error: { code } }, status); }

async function ownerActor() {
  const user = await requireActiveUser();
  if (!user || user.role !== "owner" || !authorizeCapability({ id: user.id, role: user.role, accountStatus: user.accountStatus }, "riwi.provider.read_status").allowed) return null;
  return user;
}

export async function GET(req: NextRequest) {
  const user = await ownerActor();
  if (!user) return denied(401, "unauthorized");
  const ipLimit = consume(RULES.riwiGovernanceReadByIp, clientKey(req));
  if (!ipLimit.ok) return json({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: ipLimit.retryAfterSeconds }, 429);
  const accountLimit = consume(RULES.riwiGovernanceReadByAccount, accountKey(user.id));
  if (!accountLimit.ok) return json({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: accountLimit.retryAfterSeconds }, 429);
  const limits = req.nextUrl.searchParams.getAll("limit");
  const cursors = req.nextUrl.searchParams.getAll("cursor");
  if (limits.length > 1 || cursors.length > 1 || (limits[0] !== undefined && !/^\d{1,2}$/.test(limits[0]))) {
    return denied(400, "riwi_request_invalid");
  }
  const limit = limits[0] === undefined ? 20 : Number(limits[0]);
  if (limit < 1 || limit > 50) return denied(400, "riwi_request_invalid");
  try {
    const actor = { id: user.id, role: user.role, accountStatus: user.accountStatus };
    const [status, history, experimentCount] = await Promise.all([
      ownerAiStatus(),
      listRiwiProviderExperimentPage(actor, { limit, cursor: cursors[0] }),
      countRiwiProviderExperiments(actor),
    ]);
    const rollout = readRiwiRollout();
    const response = getResponseSchema.parse({
      ok: true,
      enabled: { owner: rollout.roles.owner, providerLab: rollout.providerLab, externalAi: rollout.externalAi && status.effective.externalEnabled },
      providers: status.providers
        .filter((provider) => provider.type === "external" && provider.capabilities.includes("riwi-assistant"))
        .map((provider) => ({
          id: provider.id, displayName: provider.displayName, type: provider.type,
          model: provider.model && MODEL_ID.test(provider.model) ? provider.model : null,
          capabilities: provider.capabilities, secretsPresent: provider.secretsPresent,
          missingSecretNames: provider.missingSecretNames,
        })),
      experiments: history.experiments,
      nextCursor: history.nextCursor,
      experimentCount,
    });
    return json(response);
  } catch (error) {
    if (error instanceof RiwiProviderLabError && error.code === "invalid_input") return denied(400, "riwi_request_invalid");
    return denied(503, "riwi_provider_lab_unavailable");
  }
}

export async function POST(req: NextRequest) {
  const user = await ownerActor();
  if (!user) return denied(401, "unauthorized");
  const actor = { id: user.id, role: user.role, accountStatus: user.accountStatus };
  if (!authorizeCapability(actor, "riwi.provider.live_test").allowed) return denied(403, "riwi_permission_denied");
  const rollout = readRiwiRollout();
  if (!rollout.roles.owner || !rollout.providerLab) return denied(404, "riwi_not_enabled");
  const origin = checkRequestOrigin(req);
  if (!origin.allowed) return denied(403, "riwi_request_invalid");
  const limit = consume(RULES.riwiProviderLab, accountKey(user.id));
  if (!limit.ok) return NextResponse.json({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: limit.retryAfterSeconds }, {
    status: 429,
    headers: {
      "Retry-After": String(limit.retryAfterSeconds),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
    },
  });
  const body = await readRiwiBoundedJson(req);
  if (!body.ok) return denied(body.reason === "too_large" ? 413 : 400, "riwi_request_invalid");
  const parsed = riwiProviderLabRequestSchema.safeParse(body.value);
  if (!parsed.success) return denied(400, "riwi_request_invalid");
  try {
    const outcome = await runRiwiProviderExperiment({
      actor, fixtureId: parsed.data.fixtureId, providerIds: parsed.data.providerIds,
      idempotencyKey: parsed.data.idempotencyKey, signal: req.signal,
    });
    return json(postResponseSchema.parse({ ok: true, replay: outcome.replay, experiment: outcome.experiment }));
  } catch (error) {
    if (error instanceof RiwiProviderLabError) {
      const status = error.code === "forbidden" ? 403 : error.code === "feature_disabled" ? 404
        : error.code === "concurrency_limited" || error.code === "rate_limited" ? 429 : error.code === "not_found" ? 404
          : error.code === "idempotency_conflict" ? 409 : error.code === "invalid_input" ? 400 : 503;
      return denied(status, `riwi_provider_lab_${error.code}`);
    }
    return denied(503, "riwi_provider_lab_unavailable");
  }
}
