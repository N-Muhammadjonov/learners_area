import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { subscribeAccessChanges } from "@/lib/auth/access-change-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The browser opens ONE stream per /app tab. Only owner-initiated/other genuine
 * database role or account-status changes send a data event. Heartbeats have
 * no database reads. PostgreSQL LISTEN is shared per Node process.
 *
 * Access to this stream is established with the existing authoritative check.
 * It is a UI invalidation channel, NEVER a substitute for API authorization.
 */
export async function GET(req: NextRequest) {
  if (!process.env.AUTH_EVENTS_DATABASE_URL) {
    return NextResponse.json({ error: "access_events_disabled" }, { status: 503 });
  }
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

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
      const subscription = subscribeAccessChanges(user.id, () => send("event: access-changed\ndata: {}\n\n"));
      const keepAlive = setInterval(() => send(": keep-alive\n\n"), 25000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        subscription.close();
        req.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* already canceled */ }
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
      send("retry: 5000\n\n");
      void subscription.ready.then((ok) => {
        if (!ok) {
          send("event: unavailable\ndata: {}\n\n");
          cleanup();
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
