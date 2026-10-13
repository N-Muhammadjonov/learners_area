import { NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission, type BotActor } from "./actor";
import { actorError } from "./http";
import type { AnyBotPermission } from "./permissions";

export async function guardBot(
  req: Request,
  permission: AnyBotPermission,
  actorTelegramId: unknown,
  options?: { requireAuditUser?: boolean }
): Promise<{ ok: true; actor: BotActor } | { ok: false; response: NextResponse }> {
  const authError = verifyInternalBotRequest(req);
  if (authError) return { ok: false, response: authError };
  const actor = await requireBotPermission(actorTelegramId, permission, options);
  if (!actor.ok) return { ok: false, response: actorError(actor.error) };
  return { ok: true, actor: actor.actor };
}

export function guardService(req: Request) {
  return verifyInternalBotRequest(req);
}
