import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { enforce, RULES } from "@/lib/http/rate-limit";
import {
  sessionForParticipant,
  acceptInvite, acceptRules, blockUser, closeInvite, getState, goOffline, goOnline, hangup, heartbeat, invite, listOnline, practiceStarted, reportConnection,
} from "@/lib/data/live-partner";
import { LIVE_PARTNER_ERROR_STATUS, LivePartnerError } from "@/lib/live-partner/rules";
import { issueSignalToken, realtimeReadiness, turnCredentials } from "@/lib/live-partner/signal-token";

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
  const [state, online, realtime] = await Promise.all([getState(user.id), listOnline(user.id), realtimeReadiness()]);
  return NextResponse.json({ ...state, online, realtime }, noStore);
}

/** Entering a call requires a transport that can carry it right now. */
const NEEDS_TRANSPORT = new Set(["go_online", "invite", "accept"]);

/** POST — one action; the user id is ALWAYS the session's, never the body's. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const body = parsed.data;
  const limited = enforce(RULES.livePartnerAction, user.id)
    ?? (body.action === "invite" ? enforce(RULES.livePartnerInvite, user.id) : null)
    ?? (body.action === "signal_token" ? enforce(RULES.livePartnerToken, user.id) : null);
  if (limited) return limited;
  if (NEEDS_TRANSPORT.has(body.action)) {
    const realtime = await realtimeReadiness();
    if (!realtime.ready) return NextResponse.json({ error: "realtime_not_configured", reason: realtime.reason }, { status: 503, ...noStore });
  }
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
        // Only a participant of a live (not ended) session; the shared secret never leaves the server.
        const session = await sessionForParticipant(user.id, body.sessionId);
        const token = await issueSignalToken({ userId: user.id, ...session });
        const turn = turnCredentials(user.id);
        if (!token || !turn) return NextResponse.json({ error: "realtime_not_configured" }, { status: 503, ...noStore });
        return NextResponse.json({ token, url: process.env.LIVE_PARTNER_SIGNAL_URL, role: session.role, ...turn }, noStore);
      }
    }
    const [state, online, realtime] = await Promise.all([getState(user.id), listOnline(user.id), realtimeReadiness()]);
    return NextResponse.json({ ok: true, ...state, online, realtime }, noStore);
  } catch (error) {
    if (error instanceof LivePartnerError) return NextResponse.json({ error: error.code }, { status: LIVE_PARTNER_ERROR_STATUS[error.code], ...noStore });
    throw error;
  }
}
