/**
 * How this application writes cookies.
 *
 * The centre's app is not always opened as a top-level website. The Arena preview
 * embeds it in a frame on a *different site*, and a `SameSite=Lax` cookie is never
 * stored in that situation: the browser drops the `Set-Cookie` from the sign-in
 * response, so the very next request arrives without a session and the visitor is
 * thrown back to the login screen — the sign-in "does nothing" while the server
 * logs a perfectly successful 200.
 *
 * So the browser's own context decides:
 *
 *   served over HTTPS  →  SameSite=None; Secure; Partitioned
 *   served over HTTP   →  SameSite=Lax            (unchanged, for local work)
 *
 * `Partitioned` (CHIPS) is not decoration. It keeps the cookie inside the
 * top-level site it was issued for, which is what makes this safe: a page on
 * another site that frames the app gets its own partition, and a cookie issued in
 * one partition is never sent in another — so removing `Lax` does not open a
 * cross-site request-forgery hole the way a bare `SameSite=None` would. It is also
 * the one cookie kind that survives third-party cookie blocking.
 *
 * Pure module: no server imports, so the rules can be unit tested directly.
 */

export type CookiePolicy = {
  sameSite: "lax" | "none";
  secure: boolean;
  partitioned: boolean;
};

type HeaderBag = { get(name: string): string | null };

export type RequestLike = {
  headers: HeaderBag;
  nextUrl?: { protocol?: string };
};

/** The cookie rules for a given transport. */
export function cookiePolicyFor(https: boolean): CookiePolicy {
  return https
    ? { sameSite: "none", secure: true, partitioned: true }
    : { sameSite: "lax", secure: false, partitioned: false };
}

function firstValue(header: string | null): string | null {
  if (!header) return null;
  const [first] = header.split(",");
  return first ? first.trim().toLowerCase() : null;
}

/**
 * Was this request made over TLS?
 *
 * Any signal is enough, because a *missed* signal breaks sign-in for real users
 * while a false positive only marks the cookie `Secure` on a connection that
 * already is one. Behind the preview's proxy the browser-facing scheme arrives as
 * `x-forwarded-proto`; the browser's own `Origin`/`Referer` on a state-changing
 * request is the backstop when a proxy forwards nothing.
 */
export function requestIsHttps(req: RequestLike): boolean {
  const forwarded = firstValue(req.headers.get("x-forwarded-proto"));
  if (forwarded === "https") return true;

  if (req.nextUrl?.protocol === "https:") return true;

  const origin = firstValue(req.headers.get("origin"));
  if (origin === "https://" || (origin?.startsWith("https://") ?? false)) return true;

  const referer = firstValue(req.headers.get("referer"));
  if (referer?.startsWith("https://") ?? false) return true;

  return false;
}

export function cookiePolicyForRequest(req: RequestLike): CookiePolicy {
  return cookiePolicyFor(requestIsHttps(req));
}

/**
 * A `Set-Cookie` that retires a cookie written with different attributes.
 *
 * A partitioned cookie is not removed by a plain expiry: the browser needs the
 * same partition key and the same `Partitioned` flag to find it. Sessions issued
 * before this policy existed are therefore cleared explicitly, otherwise "sign
 * out" would leave a working session behind.
 *
 * The value is empty and every attribute is a literal, so there is nothing to
 * escape — this only exists because the framework's cookie helper cannot emit two
 * deletions for one name.
 */
export function serializeCookieClear(name: string, policy: CookiePolicy): string {
  const parts = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    `SameSite=${policy.sameSite === "none" ? "None" : "Lax"}`,
  ];
  if (policy.secure) parts.push("Secure");
  if (policy.partitioned) parts.push("Partitioned");
  return parts.join("; ");
}
