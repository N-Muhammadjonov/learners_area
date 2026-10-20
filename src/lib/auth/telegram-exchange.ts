import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramContacts, telegramLoginIntents, users } from "@/db/schema";
import { hashToken } from "@/lib/auth/telegram-intent";
import { createAccessRequest, findOpenRequestForUser } from "@/lib/data/admission";
import { recordAudit } from "@/lib/data/audit";
import type { ExchangeOutcome } from "@/lib/telegram/intent-purpose";
import { isTelegramUserId } from "@/lib/telegram/ids";
import { checkRequiredSubscriptions } from "@/lib/telegram/required-channels";
import { telegramApplicationGatesEnabled } from "@/lib/telegram/access-gates";
import {registrationFullNameSchema} from '@/lib/validation/auth';

type UserRow = typeof users.$inferSelect;

export type ExchangeResult =
  | { ok: false; error: "intent_not_confirmed" | "expired" | "already_consumed" | "no_linked_account" | "conflict" | "missing_user" | "phone_required" | "not_subscribed" | "membership_unavailable" | "full_name_required" | "change_not_available" }
  | { ok: true; user: UserRow; outcome: ExchangeOutcome };

/**
 * Apply the server-owned purpose. Does not consume the intent and does not
 * issue a session. The intent row is locked so two exchanges of the same
 * confirmation cannot both create an account. Login never inserts a user.
 */
export async function prepareIntentExchange(
  intentId: string,
  browserNonce: string,
  registrationGender?: "male" | "female",
  registrationName?:string,
  actor?:{id:string;authVersion:number},
): Promise<ExchangeResult> {
  const nonceHash = hashToken(browserNonce);
  // The website registration path must enforce the SAME admission prerequisites
  // as the bot's /apply API; otherwise applicants could bypass the channel gate.
  const preflight = await db.query.telegramLoginIntents.findFirst({
    where: and(
      eq(telegramLoginIntents.id, intentId),
      eq(telegramLoginIntents.browserNonceHash, nonceHash),
      eq(telegramLoginIntents.status, "confirmed"),
    ),
    columns: { telegramUserId: true, purpose: true },
  });
  if (telegramApplicationGatesEnabled() && preflight?.purpose === "register" && preflight.telegramUserId) {
    const contact = await db.query.telegramContacts.findFirst({
      where: eq(telegramContacts.telegramUserId, preflight.telegramUserId),
      columns: { phoneNumber: true, phoneVerifiedAt: true },
    });
    if (!contact?.phoneNumber || !contact.phoneVerifiedAt) {
      return { ok: false, error: "phone_required" };
    }
    const membership = await checkRequiredSubscriptions(preflight.telegramUserId);
    if (!membership.ok) return { ok: false, error: membership.error };
  }
  const prepared = await db.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(telegramLoginIntents)
      .where(and(eq(telegramLoginIntents.id, intentId), eq(telegramLoginIntents.browserNonceHash, nonceHash)))
      .for("update")
      .limit(1);
    if (!intent) return { ok: false as const, error: "intent_not_confirmed" as const };
    if (intent.status === "consumed") return { ok: false as const, error: "already_consumed" as const };
    if (intent.status !== "confirmed" || !intent.telegramUserId || !isTelegramUserId(intent.telegramUserId)) {
      return { ok: false as const, error: "intent_not_confirmed" as const };
    }
    if (intent.expiresAt.getTime() <= Date.now()) return { ok: false as const, error: "expired" as const };

    const purpose = intent.purpose === "register" || intent.purpose === "link" || intent.purpose==='replace' ? intent.purpose : "login";
    if (purpose === "login") {
      const [user] = await tx.select().from(users).where(eq(users.telegramId, intent.telegramUserId)).limit(1);
      if (!user) return { ok: false as const, error: "no_linked_account" as const };
      return { ok: true as const, user, outcome: "session" as const };
    }
    if (purpose === "link"||purpose==='replace') {
      if (!intent.userId) return { ok: false as const, error: "missing_user" as const };
      if(!actor||actor.id!==intent.userId)return {ok:false as const,error:'missing_user' as const};
      const linked = purpose==='replace'?await replaceTelegramForIntent(tx,intent.userId,intent.telegramUserId,actor):await linkForIntent(tx, intent.userId, intent.telegramUserId);
      if (!linked.ok) return { ok: false as const, error: linked.error };
      const [user] = await tx.select().from(users).where(eq(users.id, intent.userId)).limit(1);
      if (!user) return { ok: false as const, error: "missing_user" as const };
      return { ok: true as const, user, outcome: "session" as const };
    }

    const [existing] = await tx.select().from(users).where(eq(users.telegramId, intent.telegramUserId)).limit(1);
    if (existing) {
      // A pending applicant may finish their own registration name. An active
      // account's chosen name is never replaced by a Telegram profile name.
      const supplied=registrationFullNameSchema.safeParse(registrationName);
      const registering=(existing.accountStatus==='pending'||existing.accountStatus==='rejected')&&!existing.onboardingCompletedAt;
      const patch={...(registrationGender&&existing.gender===null&&registering?{gender:registrationGender}:{}),...(supplied.success&&registering?{name:supplied.data}:{})};
      const user=Object.keys(patch).length?(await tx.update(users).set(patch).where(and(eq(users.id,existing.id),or(eq(users.accountStatus,'pending'),eq(users.accountStatus,'rejected')))).returning())[0]??existing:existing;
      return { ok: true as const, user, outcome: "existing" as const, displayName: intent.displayName };
    }
    const fullName=registrationFullNameSchema.safeParse(registrationName);
    if(!fullName.success)return {ok:false as const,error:'full_name_required' as const};
    const [created] = await tx
      .insert(users)
      .values({
        telegramId: intent.telegramUserId,
        name: fullName.data,
        gender: registrationGender ?? null,
        role: "student",
        accountStatus: "pending",
        locale: intent.languageCode === "en" ? "en" : "uz",
      })
      .returning();
    if (!created) return { ok: false as const, error: "intent_not_confirmed" as const };
    return { ok: true as const, user: created, outcome: "created" as const };
  });

  if (!prepared.ok) return prepared;
  if (prepared.outcome === "session") return { ok: true, user: prepared.user, outcome: "session" };
  return finishRegister(prepared.user);
}

async function linkForIntent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  telegramUserId: string
) {
  const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.telegramId, telegramUserId)).limit(1);
  if (taken && taken.id !== userId) return { ok: false as const, error: "conflict" as const };
  const [target] = await tx.select({ id: users.id, telegramId: users.telegramId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return { ok: false as const, error: "missing_user" as const };
  if (target.telegramId && target.telegramId !== telegramUserId) return { ok: false as const, error: "conflict" as const };
  if (taken && taken.id === userId) return { ok: true as const };
  const updated = await tx
    .update(users)
    .set({ telegramId: telegramUserId })
    .where(and(eq(users.id, userId), or(isNull(users.telegramId), eq(users.telegramId, telegramUserId))))
    .returning({ id: users.id });
  if (updated.length === 0) return { ok: false as const, error: "conflict" as const };
  await tx
    .update(telegramContacts)
    .set({ linkedUserId: userId, updatedAt: new Date() })
    .where(eq(telegramContacts.telegramUserId, telegramUserId));
  // Keep the audit insert on the same connection as the user/contact updates.
  // A separate pool connection can wait on the uncommitted users row lock.
  await recordAudit({
    actorUserId: userId,
    action: "telegram.linked",
    targetType: "user",
    targetId: userId,
    metadata: { source: "telegram_intent_link", telegramUserId },
  }, tx);
  return { ok: true as const };
}

async function finishRegister(user: UserRow): Promise<ExchangeResult> {
  if (user.accountStatus === "active") return { ok: true, user, outcome: "already_active" };
  if (user.accountStatus === "suspended") return { ok: true, user, outcome: "suspended" };
  const open = await findOpenRequestForUser(user.id);
  if (open) return { ok: true, user, outcome: "already_pending" };
  const wasRejected = user.accountStatus === "rejected";
  await createAccessRequest({
    userId: user.id,
    metadata: { source: "telegram_website_register", telegramUserId: user.telegramId },
  });
  const fresh = (await db.query.users.findFirst({ where: eq(users.id, user.id) })) ?? user;
  return { ok: true, user: fresh, outcome: wasRejected ? "reopened" : "pending" };
}

/** Change only the verified Telegram binding of the same student UUID.
 * Learning history, admission and roles are never merged or reassigned. */
export async function replaceTelegramForIntent(tx:Parameters<Parameters<typeof db.transaction>[0]>[0],userId:string,telegramUserId:string,actor:{id:string;authVersion:number}){
 const [target]=await tx.select().from(users).where(eq(users.id,userId)).for('update').limit(1);
 if(!target||actor.id!==userId||target.authVersion!==actor.authVersion||target.accountStatus!=='active')return {ok:false as const,error:'missing_user' as const};
 // Staff bot authority has its own verified handover process.
 if(target.role!=='student')return {ok:false as const,error:'change_not_available' as const};
 const [taken]=await tx.select({id:users.id}).from(users).where(eq(users.telegramId,telegramUserId)).limit(1);
 if(taken&&taken.id!==userId)return {ok:false as const,error:'conflict' as const};
 const [contact]=await tx.select().from(telegramContacts).where(eq(telegramContacts.telegramUserId,telegramUserId)).for('update').limit(1);
 if(!contact?.phoneVerifiedAt||!contact.phoneNumber)return {ok:false as const,error:'phone_required' as const};
 if(contact.linkedUserId&&contact.linkedUserId!==userId)return {ok:false as const,error:'conflict' as const};
 if(target.telegramId===telegramUserId)return {ok:true as const};
 if(target.telegramId)await tx.update(telegramContacts).set({linkedUserId:null,updatedAt:new Date()}).where(and(eq(telegramContacts.telegramUserId,target.telegramId),eq(telegramContacts.linkedUserId,userId)));
 await tx.update(users).set({telegramId:telegramUserId,authVersion:sql`${users.authVersion}+1`}).where(eq(users.id,userId));
 await tx.update(telegramContacts).set({linkedUserId:userId,updatedAt:new Date()}).where(eq(telegramContacts.telegramUserId,telegramUserId));
 await recordAudit({actorUserId:userId,action:'telegram.linked',targetType:'user',targetId:userId,metadata:{source:'telegram_verified_replacement',previousTelegramId:target.telegramId,telegramUserId,resultsPreserved:true}},tx);
 return {ok:true as const};
}
