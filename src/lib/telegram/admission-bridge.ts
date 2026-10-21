import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { canRequestAccess } from "@/lib/auth/account-status";
import {
  createAccessRequest,
  decideAccessRequest,
  findOpenRequestForUser,
  resolveRequestIdForDecision,
} from "@/lib/data/admission";
import { isTelegramUserId } from "./ids";
import { findTelegramContact, upsertTelegramContact } from "./contacts";
import { checkRequiredSubscriptions } from "./required-channels";
import { telegramApplicationGatesEnabled } from "./access-gates";

import {registrationFullNameSchema} from "@/lib/validation/auth";

export async function requestAccessFromTelegram(input: {
  telegramUserId: string;
  name: string;
  message?: string | null;
  username?: string | null;
  chatId?: string | null;
  languageCode?: string | null;
}) {
  if (!isTelegramUserId(input.telegramUserId)) return { ok: false as const, error: "invalid_actor" };
  // Once enabled, check before writing users, requests or events.
  // During the backend-first release phase, leave OFF for legacy bot compatibility.
  if (telegramApplicationGatesEnabled()) {
    const existingContact = await findTelegramContact(input.telegramUserId);
    if (!existingContact?.phoneNumber || !existingContact.phoneVerifiedAt) {
      return { ok: false as const, error: "phone_required" };
    }
    const membership = await checkRequiredSubscriptions(input.telegramUserId);
    if (!membership.ok) {
      return {
        ok: false as const,
        error: membership.error,
        requiredChannels: membership.channels,
      };
    }
  }
  const parsedName=registrationFullNameSchema.safeParse(input.name);
  if(!parsedName.success)return {ok:false as const,error:"invalid_input" as const};
  const name=parsedName.data;
  if (!name) return { ok: false as const, error: "invalid_input" };

  await upsertTelegramContact({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    username: input.username,
    languageCode: input.languageCode,
    restarted: true,
  });

  let user = await db.query.users.findFirst({ where: eq(users.telegramId, input.telegramUserId) });
  if (!user) {
    try {
      const [created] = await db
        .insert(users)
        .values({
          telegramId: input.telegramUserId,
          name,
          role: "student",
          accountStatus: "pending",
          locale: input.languageCode === "en" ? "en" : "uz",
        })
        .returning();
      user = created;
    } catch {
      user = await db.query.users.findFirst({ where: eq(users.telegramId, input.telegramUserId) });
    }
  }
  if (!user) return { ok: false as const, error: "internal_error" };

  if (user.accountStatus === "active") {
    return { ok: true as const, status: "already_active" as const, userId: user.id, requestId: null };
  }
  if (user.accountStatus === "suspended") {
    return { ok: true as const, status: "suspended" as const, userId: user.id, requestId: null };
  }
  if (!canRequestAccess(user.accountStatus)) {
    return { ok: false as const, error: "not_requestable" };
  }

  const open = await findOpenRequestForUser(user.id);
  if (open) {
    return { ok: true as const, status: "already_pending" as const, userId: user.id, requestId: open.id };
  }

  const request = await createAccessRequest({
    userId: user.id,
    message: input.message?.trim().slice(0, 500) || null,
    metadata: { source: "telegram_bot", telegramUserId: input.telegramUserId },
  });
  return {
    ok: true as const,
    status: user.accountStatus === "rejected" ? ("reopened" as const) : ("pending" as const),
    userId: user.id,
    requestId: request?.id ?? null,
  };
}

export async function decideAccessFromTelegram(input: {
  requestId: string;
  actorUserId: string;
  actorTelegramId: string;
  decision: "approve" | "reject";
  note?: string | null;
  applicantTelegramId?: string | null;
}) {
  if (input.applicantTelegramId && input.applicantTelegramId === input.actorTelegramId) {
    return { ok: false as const, error: "self_approval" };
  }
  const requestId = await resolveRequestIdForDecision(input.requestId);
  if (!requestId) return { ok: false as const, error: "not_found" };

  const result = await decideAccessRequest({
    requestId,
    actorUserId: input.actorUserId,
    decision: input.decision,
    note: input.note ?? null,
    metadata: { source: "telegram_bot", actorTelegramId: input.actorTelegramId },
  });
  return result;
}
