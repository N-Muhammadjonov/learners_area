import { NextRequest, NextResponse } from "next/server";
import { getCurrentSessionAuthority } from "@/lib/auth/current-user";
import { hasPrivateAccess } from "@/lib/auth/account-status";
import { subscribeAccessChanges } from "@/lib/auth/access-change-bus";
import { accessEventsConnectionString } from "@/lib/auth/access-event-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The browser opens ONE stream per /app tab. After an initial reconciliation,
 * committed authority changes send data events. Heartbeats have
 * no database reads. PostgreSQL LISTEN is shared per Node process.
 *
 * Access to this stream is established with the existing authoritative check.
 * It is a UI invalidation channel, NEVER a substitute for API authorization.
 */
export async function GET(req: NextRequest) {
  if (!accessEventsConnectionString()) {
    return NextResponse.json({ error: "access_events_disabled" }, { status: 503 });
  }
  const authority = await getCurrentSessionAuthority();
  const user = authority?.user;
  if (!user || !hasPrivateAccess(user.accountStatus)) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (value: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(value)); } catch { cleanup(); }
      };
      // "access-changed" does not carry another user's id, role or content.
      let subscriptionReady=false;
      // The bus also reconciles on reconnect. Coalesce its initial notification
      // into the one post-LISTEN check below; genuine later changes stay queued.
      const subscription = subscribeAccessChanges(user.id, () => {if(subscriptionReady)send("event: access-changed\ndata: {}\n\n");});
      const keepAlive = setInterval(() => send(": keep-alive\n\n"), 25000);
      let expiryTimer: ReturnType<typeof setTimeout>;
      const expire = () => {
        const remaining = authority!.expiresAt * 1000 - Date.now();
        if (remaining <= 0) { send("event: access-changed\ndata: {}\n\n"); cleanup(); return; }
        expiryTimer = setTimeout(expire, Math.min(remaining, 2_147_000_000));
      };
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        clearTimeout(expiryTimer);
        subscription.close();
        req.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* already canceled */ }
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
      expire();
      send("retry: 5000\n\n");
      void subscription.ready.then((ok) => {
        if (!ok) {
          send("event: unavailable\ndata: {}\n\n");
          cleanup();
        } else {
          // A revocation may commit after the initial read, before LISTEN is
          // live. Reconcile once after subscribing to close that setup gap.
          subscriptionReady=true;
          send("event: access-changed\ndata: {}\n\n");
        }
      }).catch(cleanup);
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
