import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { problemReports } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/data/audit";
import { listReports } from "@/lib/data/support";

/**
 * Report a problem.
 *
 * The client may send exactly these fields — the route, the module, what the
 * student typed, the viewport, the build and the last error code. Anything else
 * it tries to attach is dropped by the schema, which is why a support inbox can
 * never receive a session token or a password: there is no field for one.
 */
const schema = z.object({
  route: z
    .string()
    .min(1)
    .max(200)
    // Internal paths only: an absolute URL could carry a query string with data.
    .refine((value) => value.startsWith("/") && !value.startsWith("//"), "route must be an internal path"),
  module: z.string().min(1).max(60),
  message: z.string().min(3).max(2000),
  viewport: z.string().max(20).optional(),
  build: z.string().max(60).optional(),
  lastErrorCode: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const [report] = await db
    .insert(problemReports)
    .values({
      userId: user.id,
      route: parsed.data.route,
      module: parsed.data.module,
      message: parsed.data.message,
      viewport: parsed.data.viewport ?? null,
      build: parsed.data.build ?? null,
      lastErrorCode: parsed.data.lastErrorCode ?? null,
    })
    .returning();
  if (!report) return NextResponse.json({ error: "report_write_failed" }, { status: 500 });

  await recordAudit({
    actorUserId: user.id,
    action: "support.reported",
    targetType: "problem_report",
    targetId: report.id,
    metadata: { route: report.route, module: report.module },
  });

  return NextResponse.json({ ok: true, id: report.id });
}

/** The support inbox: staff only — a student cannot read other students' reports. */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({ reports: await listReports() });
}
