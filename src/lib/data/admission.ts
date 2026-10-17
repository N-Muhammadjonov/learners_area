import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
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
  /** The request id, or — for an account waiting with no request row — its user id. */
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

/**
 * Everyone waiting for a decision, oldest first.
 *
 * This used to list `access_requests` rows only, and that is exactly how the
 * owner ended up with an empty queue while an applicant was staring at "waiting
 * for approval": registering created the account but no request row, so the
 * applicant was waiting *without* a request — visible to themselves and to
 * nobody else. A waiting account is the thing being queued, so the query starts
 * from the account and left-joins its open request:
 *
 *   - with a request row  → decide on the request (the normal case);
 *   - without one         → still queued; `id` is the user id and the decision
 *                           endpoint materialises the request row when the
 *                           administrator actually decides. The applicant is
 *                           never hidden behind a missing row.
 *
 * The extra `accountStatus = pending` condition keeps this a queue of *waiting*
 * people: an approved or rejected account with an old row cannot come back here.
 */
export async function listPendingAccessRequests(): Promise<AccessRequestRow[]> {
  const rows = await db
    .select({
      id: accessRequests.id,
      accountId: users.id,
      accountCreatedAt: users.createdAt,
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
    .from(users)
    .leftJoin(
      accessRequests,
      and(eq(accessRequests.userId, users.id), eq(accessRequests.status, "pending"))
    )
    .where(and(eq(users.accountStatus, "pending"), isNull(accessRequests.decidedAt)))
    .orderBy(users.createdAt);

  return rows.map((row) => ({
    ...row,
    // An account waiting without a request row is queued under its user id; the
    // decision endpoint recognises which kind of id it was handed.
    id: row.id ?? row.accountId,
    userId: row.accountId,
    status: "pending" as const,
    decidedAt: null,
    decisionNote: null,
    createdAt: row.createdAt ?? row.accountCreatedAt ?? new Date(),
  }));
}

/**
 * Materialise the missing request row for an account that is waiting without one.
 *
 * Called when an administrator actually decides, never during a page render: a
 * GET must not write. Returns the request id to decide on, or null when the
 * account is not in a state where a request may be created.
 */
export async function ensurePendingRequestForAccount(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  // Only an account that is genuinely waiting may be turned into a request;
  // this is not a way to approve, and it cannot approve anybody.
  if (!user || user.accountStatus !== "pending") {
    const open = await findOpenRequestForUser(userId);
    return open?.id ?? null;
  }
  const open = await findOpenRequestForUser(userId);
  if (open) return open.id;
  const created = await createAccessRequest({ userId });
  return created?.id ?? null;
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

/** One request row by its own id — used when an administrator decides. */
export async function resolveRequestIdForDecision(id: string): Promise<string | null> {
  if (await findAccessRequestById(id)) return id;
  return ensurePendingRequestForAccount(id);
}

export async function findAccessRequestById(id: string) {
  return db.query.accessRequests.findFirst({ where: eq(accessRequests.id, id) });
}

export async function findOpenRequestForUser(userId: string) {
  return db.query.accessRequests.findFirst({
    where: and(eq(accessRequests.userId, userId), eq(accessRequests.status, "pending")),
    orderBy: desc(accessRequests.createdAt),
  });
}

export async function createAccessRequest(input: { userId: string; message?: string | null; metadata?: Record<string, unknown> }) {
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
    metadata: input.metadata,
  });

  // Owner and admins hear about it in-app immediately. A future Telegram
  // notification would hook in here and must never be required for the queue
  // to work.
  const reviewers = await staffAdminUserIds();
  await notifyUsers(reviewers, {
    type: "ACCESS_REQUESTED",
    title: "New access request",
    body: "An applicant is waiting for approval.",
    href: "/app/admin/admissions",
    payload: { requestId: row?.id },
  });

  return row ?? null;
}

export type DecisionInput = {
  metadata?: Record<string, unknown>;
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
    metadata: { ...(input.metadata ?? {}), requestId: request.id },
  });

  await notifyUsers([request.userId], {
    type: approved ? "ACCESS_APPROVED" : "ACCESS_REJECTED",
    title: approved ? "Access approved" : "Access rejected",
    body: approved
      ? "Your Learners Area access has been approved. Welcome in."
      : (input.note ?? "Your access request was not approved."),
    href: approved ? "/app" : "/pending",
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
    href: input.status === "active" ? "/app" : "/pending",
  });

  return { ok: true as const };
}
