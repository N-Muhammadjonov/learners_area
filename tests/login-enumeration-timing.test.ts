/**
 * B4 — the login path must not leak account existence through RESPONSE TIME.
 *
 * The response body was already uniform: `invalid_credentials` / 401 whether the email
 * belongs to nobody or to somebody who typed the wrong password. That is the part everyone
 * remembers to do. The part that was missing is the work: `bcryptjs` at 12 rounds costs
 * ~390 ms here, and the handler could only call it when it had a stored hash — so an unknown
 * account answered in ~1 ms. A 390 ms gap is not a subtle statistical signal, it is a
 * stopwatch reading, and it lets an attacker walk a list of emails and learn which ones have
 * accounts without ever guessing a password.
 *
 * These tests pin the remedy (always exactly one comparison) rather than only the symptom
 * (the two paths take a similar time), because a timing-only assertion can be satisfied by
 * an accidental slowdown and broken by an accidental speedup.
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword, verifyPasswordOrDecoy } from "../src/lib/auth/password";

/** Measured on this machine: a real 12-round comparison. Used only for order-of-magnitude floors. */
const A_REAL_COMPARISON_IS_SLOW_MS = 40;

test("EN1 an unknown account still performs exactly one bcrypt comparison", async () => {
  const compare = mock.method(bcrypt, "compare");
  try {
    const result = await verifyPasswordOrDecoy("whatever-they-typed", null);
    assert.equal(result, false, "no hash can never verify");
    assert.equal(compare.mock.callCount(), 1, "the timing equaliser is the comparison itself");
  } finally {
    compare.mock.restore();
  }
});

test("EN2 a missing hash and a present-but-wrong password both return false, both do the work", async () => {
  const stored = await hashPassword("correct-horse-battery");
  const compare = mock.method(bcrypt, "compare");
  try {
    assert.equal(await verifyPasswordOrDecoy("wrong", null), false);
    assert.equal(await verifyPasswordOrDecoy("wrong", stored), false);
    assert.equal(await verifyPasswordOrDecoy("wrong", undefined), false);
    assert.equal(await verifyPasswordOrDecoy("wrong", ""), false, "an empty hash string is not a hash");
    assert.equal(compare.mock.callCount(), 4, "every shape of 'no usable hash' still costs a comparison");
  } finally {
    compare.mock.restore();
  }
});

test("EN3 the decoy is a real hash of nothing useful: no plausible password verifies against it", async () => {
  // Positive control first — the mechanism can return true at all, so `false` below means
  // something and is not just a function that never succeeds.
  const stored = await hashPassword("S3cret-passphrase");
  assert.equal(await verifyPasswordOrDecoy("S3cret-passphrase", stored), true, "control: a correct password verifies");
  assert.equal(await verifyPassword("S3cret-passphrase", stored), true);

  // Now the decoy. These are the passwords an attacker would try against a login form.
  for (const candidate of [
    "", "password", "Password1", "Password123", "123456", "12345678", "qwerty",
    "Admin12345!", "Student12345!", "Teacher12345!", "Owner12345!",
    "learners-area-decoy-not-a-password",
  ]) {
    assert.equal(await verifyPasswordOrDecoy(candidate, null), false, `decoy must reject "${candidate}"`);
  }
});

test("EN4 the unknown-account path costs real time, not ~0 ms", async () => {
  const started = process.hrtime.bigint();
  const result = await verifyPasswordOrDecoy("some-password", null);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(result, false);
  // Deliberately a coarse FLOOR rather than a ratio against the known-account path: a
  // ratio assertion is flaky on a loaded CI box, while "did it do any bcrypt work at all"
  // is not. The defect this kills took ~1 ms, so 40 ms is a wide and stable margin.
  assert.ok(
    elapsedMs >= A_REAL_COMPARISON_IS_SLOW_MS,
    `the unknown-account path must do the hashing work, took ${elapsedMs.toFixed(1)} ms`,
  );
});

test("EN5 the two paths are no longer distinguishable by an order of magnitude", async () => {
  const stored = await hashPassword("correct-horse-battery");
  const time = async (hash: string | null) => {
    const started = process.hrtime.bigint();
    await verifyPasswordOrDecoy("an-incorrect-password", hash);
    return Number(process.hrtime.bigint() - started) / 1e6;
  };

  // Warm up: the first bcrypt call in a process pays JIT/initialisation cost that has
  // nothing to do with the account, and would otherwise dominate the comparison.
  await time(stored);

  const samples = 3;
  const known: number[] = [];
  const unknown: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    known.push(await time(stored));
    unknown.push(await time(null));
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const knownMs = median(known);
  const unknownMs = median(unknown);

  // The pre-fix gap was ~390 ms against ~1 ms — a ratio in the hundreds. Requiring the
  // ratio under 4 leaves enormous headroom for scheduler noise while still failing loudly
  // if the equaliser is removed.
  const ratio = Math.max(knownMs / unknownMs, unknownMs / knownMs);
  assert.ok(ratio < 4, `known ${knownMs.toFixed(0)} ms vs unknown ${unknownMs.toFixed(0)} ms (ratio ${ratio.toFixed(1)})`);
});

test("EN6 the login handler cannot silently go back to the leaking call", () => {
  const route = readFileSync("src/app/api/auth/login/route.ts", "utf8");
  // Behaviour is pinned by EN1–EN5; this pins the WIRING, so a future edit that swaps the
  // equalised call back for the raw one fails here rather than only in production timing.
  assert.ok(
    /verifyPasswordOrDecoy\(\s*password,\s*user\?\.passwordHash\s*\)/.test(route),
    "POST /api/auth/login must verify through the timing-equalised helper",
  );
  assert.ok(
    !/user\?\.passwordHash\s*\?\s*await\s+verifyPassword\(/.test(route),
    "the conditional-compare shape is the oracle and must not come back",
  );
});
