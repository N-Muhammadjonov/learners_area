import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { problemReports, users } from "@/db/schema";

/**
 * The support inbox.
 *
 * Reports are read by staff only (enforced at the route), and the person who
 * reported is named — a report nobody can follow up with is not support.
 */
export async function listReports(limit = 50) {
  const rows = await db
    .select({
      report: problemReports,
      reporterName: users.name,
      reporterRole: users.role,
    })
    .from(problemReports)
    .innerJoin(users, eq(problemReports.userId, users.id))
    .orderBy(desc(problemReports.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.report.id,
    route: row.report.route,
    module: row.report.module,
    message: row.report.message,
    viewport: row.report.viewport,
    build: row.report.build,
    lastErrorCode: row.report.lastErrorCode,
    status: row.report.status,
    createdAt: row.report.createdAt.toISOString(),
    resolvedAt: row.report.resolvedAt ? row.report.resolvedAt.toISOString() : null,
    reporterName: row.reporterName,
    reporterRole: row.reporterRole,
  }));
}
