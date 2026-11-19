/**
 * First-party sign-in must use an unpartitioned, persistent HttpOnly cookie.
 * A cross-site iframe needs SameSite=None; Secure; Partitioned (CHIPS).
 * Safari versions without CHIPS support can reject partitioned cookies, even
 * for first-party use, so HTTPS alone must never select the embedded policy.
 * Keep this pure contract aligned with services/backend/app/security.py.
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
export function cookiePolicyFor(https: boolean, embedded = false): CookiePolicy {
  return https && embedded
    ? { sameSite: "none", secure: true, partitioned: true }
    : { sameSite: "lax", secure: https, partitioned: false };
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
  const embedded = req.headers.get("x-learners-embedded") === "1" ||
    ["iframe", "frame"].includes((req.headers.get("sec-fetch-dest") ?? "").toLowerCase());
  return cookiePolicyFor(requestIsHttps(req), embedded);
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
