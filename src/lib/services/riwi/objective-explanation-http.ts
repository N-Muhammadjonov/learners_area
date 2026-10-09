import "server-only";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES, consume, clientKey } from "@/lib/http/rate-limit";
import { readRiwiBoundedJson } from "./http";
import { explainObjectiveAttempt } from "./objective-explanation";
import { objectiveExplanationRequestSchema } from "./objective-explanation-schema";

const defaults = {
  getUser: requireActiveUser,
  explain: explainObjectiveAttempt,
  consumeAccount: (id: string) => consume(RULES.riwiLearningReadByAccount, id),
  consumeIp: (request: NextRequest) => consume(RULES.riwiLearningReadByIp, clientKey(request)),
};

export async function handleObjectiveExplanation(request: NextRequest, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" } });
  if (!checkRequestOrigin(request).allowed) return json({ error: "invalid_request" }, 403);
  const ip = deps.consumeIp(request);
  if (!ip.ok) return json({ error: "rate_limited" }, 429);
  const user = await deps.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  if (user.accountStatus !== "active") return json({ error: "not_found" }, 403);
  if (!deps.consumeAccount(user.id).ok) return json({ error: "rate_limited" }, 429);
  const body = await readRiwiBoundedJson(request, 1024);
  if (!body.ok) return json({ error: "invalid_request" }, body.reason === "too_large" ? 413 : 400);
  const input = objectiveExplanationRequestSchema.safeParse(body.value);
  if (!input.success) return json({ error: "invalid_request" }, 400);
  try {
    const result = await deps.explain(user, input.data, randomUUID());
    if (!result.ok) return json({ error: result.code }, result.code === "not_found" ? 404 : result.code === "locked" ? 403 : 409);
    return json(result.value, 200);
  } catch { return json({ error: "explanation_unavailable" }, 503); }
}
