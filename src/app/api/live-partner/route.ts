import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import {
  acceptInvite, acceptRules, blockUser, closeInvite, getState, goOffline, goOnline, hangup, heartbeat, invite, listOnline, practiceStarted, reportConnection,
} from "@/lib/data/live-partner";
import { LIVE_PARTNER_ERROR_STATUS, LivePartnerError } from "@/lib/live-partner/rules";
import { issueSignalToken, signalConfigured } from "@/lib/live-partner/signal-token";

const uuid = z.string().uuid();
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept_rules"), version: z.number().int() }),
  z.object({ action: z.literal("go_online") }),
  z.object({ action: z.literal("go_offline") }),
  z.object({ action: z.literal("heartbeat") }),
  z.object({ action: z.literal("practice_started") }),
  z.object({ action: z.literal("invite"), toUserId: uuid }),
  z.object({ action: z.literal("accept"), inviteId: uuid }),
  z.object({ action: z.literal("decline"), inviteId: uuid }),
  z.object({ action: z.literal("cancel"), inviteId: uuid }),
  z.object({ action: z.literal("connection"), sessionId: uuid, status: z.enum(["connected", "reconnecting"]) }),
  z.object({ action: z.literal("hangup"), sessionId: uuid }),
  z.object({ action: z.literal("block"), userId: uuid }),
  z.object({ action: z.literal("signal_token"), sessionId: uuid }),
]);

const noStore = { headers: { "Cache-Control": "private, no-store" } };

/** GET — my authoritative state + who is AVAILABLE. Never cached, never shared. */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const [state, online] = await Promise.all([getState(user.id), listOnline(user.id)]);
  return NextResponse.json({ ...state, online, realtimeConfigured: signalConfigured() }, noStore);
}

/** POST — one action; the user id is ALWAYS the session's, never the body's. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const body = parsed.data;
  try {
    switch (body.action) {
      case "accept_rules": await acceptRules(user.id, body.version); break;
      case "go_online": await goOnline(user.id); break;
      case "go_offline": await goOffline(user.id); break;
      case "heartbeat": await heartbeat(user.id); break;
      case "practice_started": await practiceStarted(user.id); break;
      case "invite": await invite(user.id, body.toUserId); break;
      case "accept": await acceptInvite(user.id, body.inviteId); break;
      case "decline": await closeInvite(user.id, body.inviteId, "decline"); break;
      case "cancel": await closeInvite(user.id, body.inviteId, "cancel"); break;
      case "connection": await reportConnection(user.id, body.sessionId, body.status); break;
      case "hangup": await hangup(user.id, body.sessionId); break;
      case "block": await blockUser(user.id, body.userId); break;
      case "signal_token": {
        const state = await getState(user.id);
        if (state.sessionId !== body.sessionId) throw new LivePartnerError("session_not_found");
        const token = await issueSignalToken({ userId: user.id, sessionId: body.sessionId });
        if (!token) return NextResponse.json({ error: "realtime_not_configured" }, { status: 503, ...noStore });
        return NextResponse.json({ token, url: process.env.LIVE_PARTNER_SIGNAL_URL, relayOnly: true }, noStore);
      }
    }
    const [state, online] = await Promise.all([getState(user.id), listOnline(user.id)]);
    return NextResponse.json({ ok: true, ...state, online, realtimeConfigured: signalConfigured() }, noStore);
  } catch (error) {
    if (error instanceof LivePartnerError) return NextResponse.json({ error: error.code }, { status: LIVE_PARTNER_ERROR_STATUS[error.code], ...noStore });
    throw error;
  }
}
