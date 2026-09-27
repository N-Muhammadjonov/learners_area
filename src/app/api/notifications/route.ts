import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/current-user";
import { countUnread, listNotifications, markNotificationsRead } from "@/lib/data/notifications";

/**
 * The notification inbox and the "mark all read" action.
 *
 * `userId` is taken from the session: there is no parameter a caller could
 * change to read somebody else's notifications.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const [unread, rows] = await Promise.all([
    countUnread(user.id),
    req.nextUrl.searchParams.get("count") === "1" ? Promise.resolve([]) : listNotifications(user.id, 30),
  ]);
  return NextResponse.json({ ok: true, notifications: rows, unread }, { headers: { "Cache-Control": "private, no-store" } });
}

const readInput = z.union([
  z.object({ ids: z.array(z.string().uuid()).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = readInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  await markNotificationsRead(user.id, "ids" in parsed.data ? parsed.data.ids : undefined);
  return NextResponse.json({ ok: true, unread: await countUnread(user.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
