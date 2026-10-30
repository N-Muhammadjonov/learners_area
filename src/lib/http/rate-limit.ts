
/**
 * A small, dependency-free abuse limiter.
 *
 * Learners Area is a single private centre, so an in-process sliding window is
 * the right size for now: no Redis, no paid service, and no new deployment
 * requirement. The store is deliberately behind a tiny interface, so a
 * multi-instance deployment can later swap it for a shared store without
 * touching a single call site.
 *
 * Counters are per *action* and per *key* (an account, an IP, or both). Nothing
 * here trusts the client: the key is derived on the server, and the caller
 * decides what a failed attempt means.
 *
 * Memory hygiene: a bucket list is pruned on every access of the same action, so
 * an idle action never grows without bound.
 */

type Bucket = { count: number; expiresAt: number };

const buckets = new Map<string, Map<string, Bucket>>();

export type RateLimitRule = {
  /** Stable action name — also the bucket namespace (`login`, `register`, …). */
  name: string;
  /** How many attempts are allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Seconds until the window frees up; meaningful only when `ok` is false. */
  retryAfterSeconds: number;
};

/** Defaults, in one place. Every one of them can be overridden by an env var. */
export const RULES = {
  /**
   * Failed sign-ins only. A correct password never counts against a student, so
   * a forgotten password cannot lock a real learner out, while a password
   * guessing loop hits the wall quickly.
   */
  loginByAccount: { name: "login_account", limit: 8, windowMs: 15 * 60_000 },
  loginByIp: { name: "login_ip", limit: 40, windowMs: 15 * 60_000 },
  register: { name: "register", limit: 10, windowMs: 60 * 60_000 },
  passwordReset: { name: "password_reset", limit: 5, windowMs: 15 * 60_000 },
  admissionRequest: { name: "admission_request", limit: 10, windowMs: 60 * 60_000 },
  telegramAuth: { name: "telegram_auth", limit: 20, windowMs: 15 * 60_000 },
  evaluation: { name: "evaluation", limit: 60, windowMs: 15 * 60_000 },
  uploadIntent: { name: "upload_intent", limit: 120, windowMs: 15 * 60_000 },
  vocabularySearch: { name: "vocabulary_search", limit: 300, windowMs: 60_000 },
  /** Live Partner actions per user (heartbeats included); invites are a subset. */
  livePartnerAction: { name: "live_partner_action", limit: 120, windowMs: 60_000 },
  livePartnerInvite: { name: "live_partner_invite", limit: 20, windowMs: 10 * 60_000 },
  livePartnerToken: { name: "live_partner_token", limit: 30, windowMs: 10 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

function limitFor(rule: RateLimitRule): number {
  const override = Number(process.env[`RATE_LIMIT_${rule.name.toUpperCase()}`]);
  return Number.isFinite(override) && override > 0 ? override : rule.limit;
}

function bucketsFor(name: string): Map<string, Bucket> {
  let list = buckets.get(name);
  if (!list) {
    list = new Map();
    buckets.set(name, list);
  }
  const now = Date.now();
  for (const [key, bucket] of list) {
    if (bucket.expiresAt <= now) list.delete(key);
  }
  return list;
}

/** Counts one attempt and reports whether it is allowed. */
export function consume(rule: RateLimitRule, key: string): RateLimitResult {
  const limit = limitFor(rule);
  const list = bucketsFor(rule.name);
  const now = Date.now();
  const existing = list.get(key);

  if (!existing || existing.expiresAt <= now) {
    list.set(key, { count: 1, expiresAt: now + rule.windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
    };
  }
  return { ok: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** Clears a bucket — used after a successful sign-in, so a good password forgives. */
export function reset(rule: RateLimitRule, key: string): void {
  buckets.get(rule.name)?.delete(key);
}

/** An IPv4/IPv6 literal, so a bucket key can never be arbitrary attacker text. */
function asIpAddress(value: string | undefined | null): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  // Strip an optional :port from IPv4, and [..] brackets from IPv6.
  const bare = candidate.startsWith("[")
    ? candidate.slice(1, candidate.indexOf("]") === -1 ? undefined : candidate.indexOf("]"))
    : candidate.split(":").length === 2
      ? candidate.split(":")[0]!
      : candidate;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (v4) {
    return v4.slice(1).every((part) => Number(part) <= 255) ? bare : null;
  }
  // Deliberately permissive about IPv6 shape, strict about its alphabet.
  if (/^[0-9a-f:]+$/i.test(bare) && bare.includes(":")) return bare.toLowerCase();
  return null;
}

/**
 * A stable client key that an untrusted caller cannot choose.
 *
 * THE TRUST BOUNDARY. `x-forwarded-for` is attacker-controlled input. Anything the
 * client sends arrives intact at the first proxy, which APPENDS rather than
 * sanitises, so the LEFT-most entry is whatever the caller typed. Keying the limiter
 * on it let any caller mint unlimited independent rate-limit identities — rotate the
 * header, get a fresh bucket, and every per-IP limit (failed sign-ins included)
 * stops existing.
 *
 * The order below prefers values a client cannot forge:
 *
 *  1. `x-vercel-forwarded-for` — written by Vercel's proxy. Vercel documents that it
 *     overwrites `x-forwarded-for` to prevent spoofing, and this header additionally
 *     survives an upstream proxy overwriting XFF.
 *  2. `x-real-ip` — the single client address Vercel's proxy calculates.
 *  3. `x-forwarded-for`, read RIGHT to LEFT. The right-most entry was appended by the
 *     hop closest to this server; everything to its left may be spoofed. This is the
 *     standard guidance and it is also what keeps a non-Vercel reverse proxy working.
 *
 * Each candidate must parse as an IP literal, so a forged header full of text cannot
 * become a bucket key either.
 *
 * IMPORTANT, and deliberately not papered over: headers 1 and 2 are only trustworthy
 * because the origin is reached through the platform proxy. If this app is ever
 * exposed directly to the internet, no header is trustworthy and per-IP limiting must
 * move to the edge. Per-ACCOUNT limits (`loginByAccount`, keyed on the email) do not
 * depend on any of this and remain effective regardless.
 */
export function clientKey(req: Request): string {
  const vercel = asIpAddress(req.headers.get("x-vercel-forwarded-for"));
  if (vercel) return vercel;

  const real = asIpAddress(req.headers.get("x-real-ip"));
  if (real) return real;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    // Right to left: the first parseable address nearest this server.
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      const ip = asIpAddress(hops[i]);
      if (ip) return ip;
    }
  }
  return "local";
}

/** Bucket key for an account-scoped rule (email or user id, lowercased). */
export function accountKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Is this key already over the limit? Does not count an attempt. */
export function isBlocked(rule: RateLimitRule, key: string): RateLimitResult {
  const limit = limitFor(rule);
  const bucket = buckets.get(rule.name)?.get(key);
  const now = Date.now();
  if (!bucket || bucket.expiresAt <= now) return { ok: true, remaining: limit, retryAfterSeconds: 0 };
  if (bucket.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)) };
  }
  return { ok: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

function tooMany(result: RateLimitResult): Response {
  return Response.json(
    { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}

/** Refuses when the key is already blocked (no attempt is counted). */
export function blockIfOver(rule: RateLimitRule, key: string): Response | null {
  const state = isBlocked(rule, key);
  return state.ok ? null : tooMany(state);
}

/**
 * Counts one attempt and refuses when that attempt exceeds the limit.
 * Use this for actions where every call is an attempt (registration, reset
 * request, upload intent); for sign-in use `blockIfOver` + `consume` on failure,
 * so a correct password is never counted.
 */
export function enforce(rule: RateLimitRule, key: string): Response | null {
  const result = consume(rule, key);
  return result.ok ? null : tooMany(result);
}

/** Test/ops helper: drops every counter (used by unit tests). */
export function resetAll(): void {
  buckets.clear();
}
