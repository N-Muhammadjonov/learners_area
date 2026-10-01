import { NextResponse, type NextRequest } from "next/server";

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

/**
 * A stable client key.
 *
 * Behind a proxy the left-most `x-forwarded-for` entry is the real client; when
 * the header is absent the request is local, and every local caller shares one
 * bucket on purpose (a local caller is not an internet attacker).
 */
export function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
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

function tooMany(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}

/** Refuses when the key is already blocked (no attempt is counted). */
export function blockIfOver(rule: RateLimitRule, key: string): NextResponse | null {
  const state = isBlocked(rule, key);
  return state.ok ? null : tooMany(state);
}

/**
 * Counts one attempt and refuses when that attempt exceeds the limit.
 * Use this for actions where every call is an attempt (registration, reset
 * request, upload intent); for sign-in use `blockIfOver` + `consume` on failure,
 * so a correct password is never counted.
 */
export function enforce(rule: RateLimitRule, key: string): NextResponse | null {
  const result = consume(rule, key);
  return result.ok ? null : tooMany(result);
}

/** Test/ops helper: drops every counter (used by unit tests). */
export function resetAll(): void {
  buckets.clear();
}
