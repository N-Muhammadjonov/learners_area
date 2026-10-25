import { backendOrigin } from "./origin";

const HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
]);

/** Transport only. FastAPI owns authentication, validation and every API action. */
export async function forwardToBackend(request: Request): Promise<Response> {
  try {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith("/api/")) return new Response(null, { status: 404 });
    const target = new URL(incoming.pathname + incoming.search, backendOrigin());
    const headers = new Headers();
    for (const [key, value] of request.headers) {
      if (!HOP_HEADERS.has(key) && !key.startsWith("x-backend-") && !["x-forwarded-host", "x-forwarded-proto"].includes(key)) headers.set(key, value);
    }
    const publicOrigin = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL) : incoming;
    headers.set("x-forwarded-host", publicOrigin.host);
    headers.set("x-forwarded-proto", publicOrigin.protocol.slice(0, -1));
    if (process.env.BACKEND_SERVICE_TOKEN) headers.set("x-backend-service-token", process.env.BACKEND_SERVICE_TOKEN);
    // Native fetch decodes responses. Request identity bytes to avoid carrying
    // stale compression and length headers into the browser response.
    headers.set("accept-encoding", "identity");
    const options: RequestInit & { duplex?: "half" } = {
      method: request.method, headers, redirect: "manual", cache: "no-store", signal: request.signal,
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      options.body = request.body;
      options.duplex = "half";
    }
    let upstream = await fetch(target, options);
    // Next previously supplied HEAD for GET routes automatically. FastAPI's
    // explicit HEAD handlers win; otherwise retain that framework behavior.
    if (request.method === "HEAD" && upstream.status === 405 && /\bGET\b/.test(upstream.headers.get("allow") ?? "")) {
      await upstream.body?.cancel();
      upstream = await fetch(target, { ...options, method: "GET" });
    }
    const outgoing = new Headers();
    for (const [key, value] of upstream.headers) {
      if (!HOP_HEADERS.has(key) && key !== "set-cookie" && key !== "content-encoding") outgoing.set(key, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) outgoing.append("set-cookie", cookie);
    if (request.method === "HEAD") await upstream.body?.cancel();
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status, statusText: upstream.statusText, headers: outgoing,
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json({ error: "service_unavailable", reason: "backend_unreachable" }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
