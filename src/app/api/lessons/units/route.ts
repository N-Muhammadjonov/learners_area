import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { listUnitOptions, resolveUnitOptions, UNIT_RESOLVE_MAX } from "@/lib/content/lesson-staff";

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

  // Search narrows; it does not guarantee reachability. When many units share a title
  // under one module there is nothing left to type, so the page is walked with a keyset
  // cursor instead. A cursor the server did not mint is refused with 400 rather than
  // silently restarting the walk at page 1 and re-serving rows already seen.
  const cursor = req.nextUrl.searchParams.get("cursor");

  // Label lookup for an already-chosen unit. A lesson authored into unit #620 is in
  // neither the first page nor the author's current search, so reopening it would
  // leave the picker showing a selection it cannot name. The desk asks for the exact
  // ids it needs instead of loading the corpus.
  const rawIds = req.nextUrl.searchParams.get("ids");
  if (rawIds !== null) {
    const ids = rawIds.split(",").map((id) => id.trim()).filter(Boolean).slice(0, UNIT_RESOLVE_MAX);
    const options = await resolveUnitOptions(undefined, ids);
    return NextResponse.json({ options }, { headers: { "cache-control": "no-store" } });
  }

  try {
    const page = await listUnitOptions(undefined, {
      ...(search ? { search } : {}),
      ...(cursor === null ? {} : { cursor }),
    });
    return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && /cursor/i.test(error.message)) {
      return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    }
    throw error;
  }
}
