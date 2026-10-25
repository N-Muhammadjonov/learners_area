import "server-only";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import type { AccountStatus } from "@/lib/auth/account-status";

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
  accountStatus: AccountStatus;
  statusReason: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  telegramLinked: boolean;
};

export type PeopleFilters = {
  q?: string;
  role?: Role;
  status?: AccountStatus;
  page?: number;
};

export const PEOPLE_PAGE_SIZE = 25;
const MAX_PEOPLE_PAGE = 100_000;

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
  accountStatus: AccountStatus;
  statusReason: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  telegramId: string | null;
}): PersonRow {
  const { telegramId, ...rest } = row;
  return { ...rest, telegramLinked: Boolean(telegramId) };
}

function safeQuery(value: string | undefined): string {
  return (value ?? "").trim().slice(0, 100);
}

function escapedContainsPattern(query: string): string {
  const escaped = query.replace(/[%_\\]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

/** Shared parameterized predicate for both the count and bounded page queries. */
export function buildPeopleWhere(filters: PeopleFilters = {}) {
  const query = safeQuery(filters.q);
  return and(
    filters.role ? eq(users.role, filters.role) : undefined,
    filters.status ? eq(users.accountStatus, filters.status) : undefined,
    query
      ? or(
          ilike(users.name, escapedContainsPattern(query)),
          ilike(users.email, escapedContainsPattern(query)),
        )
      : undefined,
  );
}

/** Exposed as a query-contract seam so tests compile SQL without a database. */
export function buildPeopleListQuery(filters: PeopleFilters = {}, page = 1) {
  const safePage = Math.min(MAX_PEOPLE_PAGE, Math.max(1, Math.floor(page) || 1));
  return db
    .select(columns)
    .from(users)
    .where(buildPeopleWhere(filters))
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(PEOPLE_PAGE_SIZE)
    .offset((safePage - 1) * PEOPLE_PAGE_SIZE);
}

export function buildPeopleCountQuery(filters: PeopleFilters = {}) {
  return db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(buildPeopleWhere(filters));
}

export async function listPeople(filters: PeopleFilters = {}) {
  const query = safeQuery(filters.q);
  const normalizedFilters = { q: query, role: filters.role, status: filters.status };
  const [countRow] = await buildPeopleCountQuery(normalizedFilters);
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PEOPLE_PAGE_SIZE));
  const requestedPage = Number.isFinite(filters.page) ? Math.floor(filters.page as number) : 1;
  const page = Math.min(totalPages, Math.max(1, requestedPage));
  const people = (await buildPeopleListQuery(normalizedFilters, page)).map(shape);

  return {
    people,
    filters: normalizedFilters,
    page,
    pageSize: PEOPLE_PAGE_SIZE,
    total,
    totalPages,
  };
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
