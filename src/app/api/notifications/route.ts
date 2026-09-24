import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { listNotifications, markNotificationsRead } from "@/lib/data/notifications";

/**
 * The notification inbox and the "mark all read" action.
 *
 * `userId` is taken from the session: there is no parameter a caller could
 * change to read somebody else's notifications.
 */
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const rows = await listNotifications(user.id, 30);
  return NextResponse.json({ ok: true, notifications: rows });
}

export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  await markNotificationsRead(user.id);
  return NextResponse.json({ ok: true });
}
