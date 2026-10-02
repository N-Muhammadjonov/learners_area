import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActiveUser } from "@/lib/auth/current-user";
import { mayImportReading } from "@/lib/reading/permissions";
import { generalReadingSchemaReady } from "@/lib/data/general-reading";
import { generalReadingBundle, importGeneralReadingSet } from "@/lib/services/reading/general-import";

/**
 * Management import of one authored Reading set (the same JSON bundle and the
 * same idempotent importer as scripts/import-general-reading.ts). Draft unless
 * the bundle says publish. `dryRun` validates inside a rolled-back transaction.
 */
class DryRun extends Error {
  constructor(public result: unknown) { super("dry_run"); }
}

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!mayImportReading(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    if (!(await generalReadingSchemaReady())) return NextResponse.json({ error: "schema_not_ready" }, { status: 503 });
    const body = await req.json().catch(() => null);
    const parsed = generalReadingBundle.safeParse(body?.bundle);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json({ error: "invalid_bundle", detail: issue ? `${issue.path.join(".")}: ${issue.message}`.slice(0, 200) : undefined }, { status: 400 });
    }
    try {
      const result = await db.transaction(async (tx) => {
        const outcome = await importGeneralReadingSet(tx, parsed.data);
        if (body?.dryRun === true) throw new DryRun(outcome);
        return outcome;
      });
      return NextResponse.json({ ...result, dryRun: false }, { status: result.created ? 201 : 200 });
    } catch (error) {
      if (error instanceof DryRun) return NextResponse.json({ ...(error.result as object), dryRun: true });
      throw error;
    }
  } catch (error) {
    const correlationId = crypto.randomUUID().slice(0, 8);
    console.error("[reading-import] failed", { correlationId, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "unknown", correlationId }, { status: 500 });
  }
}
