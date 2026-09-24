import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";

/**
 * The people directory used by the administrator and owner consoles.
 *
 * It returns exactly what those screens need to make a decision — name, contact,
 * role, admission state and when the account joined — and never a password hash,
 * a session token or a private submission.
 */

export type PersonRow = {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  accountStatus: "pending" | "active" | "rejected" | "suspended";
  statusReason: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  telegramLinked: boolean;
};

const columns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  accountStatus: users.accountStatus,
  statusReason: users.statusReason,
  createdAt: users.createdAt,
  lastActiveAt: users.lastActiveAt,
  telegramId: users.telegramId,
};

function shape(row: {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  accountStatus: PersonRow["accountStatus"];
  statusReason: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  telegramId: string | null;
}): PersonRow {
  const { telegramId, ...rest } = row;
  return { ...rest, telegramLinked: Boolean(telegramId) };
}

export async function listPeople(filter?: { role?: Role; status?: PersonRow["accountStatus"] }) {
  const rows = await db
    .select(columns)
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(200);
  return rows
    .map(shape)
    .filter((row) => (filter?.role ? row.role === filter.role : true))
    .filter((row) => (filter?.status ? row.accountStatus === filter.status : true));
}

export async function countPeople() {
  const rows = await db
    .select({ role: users.role, status: users.accountStatus, count: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.role, users.accountStatus);
  return rows;
}

export async function findPerson(id: string): Promise<PersonRow | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      accountStatus: true,
      statusReason: true,
      createdAt: true,
      lastActiveAt: true,
      telegramId: true,
    },
  });
  return row ? shape(row) : null;
}
