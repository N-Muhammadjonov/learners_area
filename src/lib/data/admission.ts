import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accessRequests, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { notifyUsers, staffAdminUserIds } from "./notifications";
import { isAccountStatus, type AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";

/**
 * The private-centre admission workflow.
 *
 * A visitor registers, gets a PENDING account and asks for access. Owner/admin
 * approve or reject; approval is what switches the account to ACTIVE, which is
 * the only status that opens private content. Nothing here trusts the client:
 * the decision endpoint re-checks the actor's role from the database and the
 * applicant id comes from the request row, never from the request body.
 */

export type AccessRequestRow = {
  id: string;
  userId: string;
  status: "pending" | "approved" | "rejected";
  message: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
  applicantName: string;
  applicantEmail: string | null;
  applicantRole: Role;
  applicantStatus: AccountStatus;
};

/** Open requests, oldest first so the queue is worked in arrival order. */
export async function listPendingAccessRequests(): Promise<AccessRequestRow[]> {
  const rows = await db
    .select({
      id: accessRequests.id,
      userId: accessRequests.userId,
      status: accessRequests.status,
      message: accessRequests.message,
      createdAt: accessRequests.createdAt,
      decidedAt: accessRequests.decidedAt,
      decisionNote: accessRequests.decisionNote,
      applicantName: users.name,
      applicantEmail: users.email,
      applicantRole: users.role,
      applicantStatus: users.accountStatus,
    })
    .from(accessRequests)
    .innerJoin(users, eq(accessRequests.userId, users.id))
    .where(eq(accessRequests.status, "pending"))
    .orderBy(accessRequests.createdAt);
  return rows;
}

export async function listRecentDecisions(limit = 20): Promise<AccessRequestRow[]> {
  return db
    .select({
      id: accessRequests.id,
      userId: accessRequests.userId,
      status: accessRequests.status,
      message: accessRequests.message,
      createdAt: accessRequests.createdAt,
      decidedAt: accessRequests.decidedAt,
      decisionNote: accessRequests.decisionNote,
      applicantName: users.name,
      applicantEmail: users.email,
      applicantRole: users.role,
      applicantStatus: users.accountStatus,
    })
    .from(accessRequests)
    .innerJoin(users, eq(accessRequests.userId, users.id))
    .where(and(eq(accessRequests.status, "approved")))
    .orderBy(desc(accessRequests.decidedAt))
    .limit(limit);
}

export async function findOpenRequestForUser(userId: string) {
  return db.query.accessRequests.findFirst({
    where: and(eq(accessRequests.userId, userId), eq(accessRequests.status, "pending")),
    orderBy: desc(accessRequests.createdAt),
  });
}

export async function createAccessRequest(input: { userId: string; message?: string | null }) {
  const [row] = await db
    .insert(accessRequests)
    .values({ userId: input.userId, message: input.message ?? null, status: "pending" })
    .returning();

  await db
    .update(users)
    .set({ accountStatus: "pending", statusUpdatedAt: new Date(), statusReason: null })
    .where(eq(users.id, input.userId));

  await recordAudit({
    actorUserId: input.userId,
    action: "access.requested",
    targetType: "access_request",
    targetId: row?.id,
  });

  // Owner and admins hear about it in-app immediately. A future Telegram
  // notification would hook in here and must never be required for the queue
  // to work.
  const reviewers = await staffAdminUserIds();
  await notifyUsers(reviewers, {
    type: "ACCESS_REQUESTED",
    title: "New access request",
    body: "An applicant is waiting for approval.",
    href: "/admin/admissions",
    payload: { requestId: row?.id },
  });

  return row ?? null;
}

export type DecisionInput = {
  requestId: string;
  /** The deciding administrator (authoritative role already verified). */
  actorUserId: string;
  decision: "approve" | "reject";
  note?: string | null;
};

export async function decideAccessRequest(input: DecisionInput) {
  const request = await db.query.accessRequests.findFirst({
    where: eq(accessRequests.id, input.requestId),
  });
  if (!request) return { ok: false as const, error: "not_found" };

  const approved = input.decision === "approve";
  const now = new Date();

  // The decision is claimed atomically: the update only matches while the row is
  // still pending, so two administrators clicking at the same moment cannot both
  // approve the same applicant and send two conflicting notifications. The loser
  // of the race sees `already_decided`, which is the truth.
  const claimed = await db
    .update(accessRequests)
    .set({
      status: approved ? "approved" : "rejected",
      decidedByUserId: input.actorUserId,
      decidedAt: now,
      decisionNote: input.note ?? null,
    })
    .where(and(eq(accessRequests.id, input.requestId), eq(accessRequests.status, "pending")))
    .returning({ id: accessRequests.id });

  if (claimed.length === 0) return { ok: false as const, error: "already_decided" };

  await db
    .update(users)
    .set({
      accountStatus: approved ? "active" : "rejected",
      statusUpdatedAt: now,
      statusReason: approved ? null : (input.note ?? null),
    })
    .where(eq(users.id, request.userId));

  await recordAudit({
    actorUserId: input.actorUserId,
    action: approved ? "access.approved" : "access.rejected",
    targetType: "user",
    targetId: request.userId,
    metadata: { requestId: request.id },
  });

  await notifyUsers([request.userId], {
    type: approved ? "ACCESS_APPROVED" : "ACCESS_REJECTED",
    title: approved ? "Access approved" : "Access rejected",
    body: approved
      ? "Your Learners Area access has been approved. Welcome in."
      : (input.note ?? "Your access request was not approved."),
    href: approved ? "/dashboard" : "/pending",
  });

  return { ok: true as const, status: approved ? "active" : "rejected", userId: request.userId };
}

export async function setAccountStatus(input: {
  userId: string;
  status: AccountStatus;
  actorUserId: string;
  reason?: string | null;
}) {
  if (!isAccountStatus(input.status)) return { ok: false as const, error: "invalid_status" };
  const now = new Date();
  await db
    .update(users)
    .set({ accountStatus: input.status, statusUpdatedAt: now, statusReason: input.reason ?? null })
    .where(eq(users.id, input.userId));

  await recordAudit({
    actorUserId: input.actorUserId,
    action: input.status === "suspended" ? "account.suspended" : "account.reactivated",
    targetType: "user",
    targetId: input.userId,
    metadata: { status: input.status },
  });

  await notifyUsers([input.userId], {
    type: input.status === "suspended" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_UPDATED",
    title: input.status === "suspended" ? "Account suspended" : `Account ${input.status}`,
    body: input.reason ?? null,
    href: input.status === "active" ? "/dashboard" : "/pending",
  });

  return { ok: true as const };
}
