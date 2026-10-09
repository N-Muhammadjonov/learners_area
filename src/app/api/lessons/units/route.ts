import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { listUnitOptions } from "@/lib/content/lesson-staff";

/**
 * Unit typeahead for the lesson authoring desk.
 *
 * The desk offers one bounded page of units. Once a centre grows past that page, the
 * only way to reach unit #501+ is to search the whole corpus server-side, which is what
 * this route does. Staff-only: the curriculum layout is not learner-facing data.
 */
export async function GET(req: NextRequest) {
  // Repository convention (tests/access-control.test.ts): only /api/{admin,owner,teacher}/*
  // may answer 403; every other private route refuses with 401 and confirms nothing about
  // the caller. requireStaff() is null for anonymous AND for signed-in non-staff, so a
  // learner learns nothing about the curriculum layout either way.
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("q") ?? "";
  // A long free-text term is pointless and only widens the ILIKE; cap it.
  const search = raw.trim().slice(0, 120);

  const page = await listUnitOptions(undefined, search ? { search } : {});
  return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
}
