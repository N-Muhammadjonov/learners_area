import { normalizeOrigin } from "@/lib/config/site";

/**
 * The one place that decides the `origin` parameter for the YouTube JS API
 * (`enablejsapi=1`), for every player route (standalone and course-linked).
 *
 * Order, mirroring the trust rules of `requestOrigin` (request-origin.ts):
 *   1. the configured public origin (PUBLIC_BASE_URL / NEXT_PUBLIC_APP_URL);
 *   2. forwarded host/proto, only when proxy headers are trusted (Vercel or
 *      TRUST_PROXY_HEADERS=true);
 *   3. the Host header the browser addressed (http for loopback, https otherwise).
 *
 * Every candidate goes through `normalizeOrigin`, so the result is always
 * scheme + host (+ port) — never "*", a path, a query or credentials — or null
 * (then no origin parameter is sent). This value only tells YouTube where its
 * player messages go; the page's own postMessage target is always the player's
 * fixed origin, so request data can never widen who receives page messages.
 */
type HeaderReader = { get(name: string): string | null };

/** A plain DNS name or bracketed IPv6 literal with an optional port — nothing else (no "*", path, userinfo). */
const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
function fromHost(protocol: "http" | "https", host: string | null | undefined): string | null {
  const value = host?.trim();
  return value && HOST.test(value) ? normalizeOrigin(`${protocol}://${value}`) : null;
}

export function resolveEmbedOrigin(
  headers: HeaderReader,
  configured: string | null,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (configured) {
    const origin = normalizeOrigin(configured);
    if (origin) return origin;
  }
  const trustProxy = env.TRUST_PROXY_HEADERS === "true" || (env.TRUST_PROXY_HEADERS !== "false" && env.VERCEL === "1");
  if (trustProxy) {
    const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
    const protocol = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (protocol === "http" || protocol === "https") {
      const origin = fromHost(protocol, host);
      if (origin) return origin;
    }
  }
  const host = headers.get("host")?.trim() ?? "";
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  return fromHost(loopback ? "http" : "https", host);
}
