import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A real bcrypt hash, at the same cost factor, of a value that is not and can never be a
 * password anybody types. It exists so that signing in with an UNKNOWN email does the same
 * work as signing in with a known one.
 *
 * WHY THIS MATTERS (B4, account enumeration). `bcryptjs` at 12 rounds costs ~390 ms on this
 * hardware. The login handler can only call `verifyPassword` when it has a stored hash, so
 * before this existed an unknown account answered in ~1 ms and a known account in ~390 ms.
 * The response BODY was already uniform (`invalid_credentials` either way), but the response
 * TIME was a 390-millisecond oracle: an attacker could walk a list of emails and read off
 * which ones have accounts without ever guessing a password. Uniform messages are not the
 * whole of "does not leak", and this is the part that was missing.
 */
const DECOY_HASH = "$2a$12$NpanVw6DUsaA2WX2Obipc.94Av8DHYf.iT6gFPkLre9PfSqKIuYLe";

/**
 * Verify a password against a stored hash, or against the decoy when there is no account.
 *
 * Always performs exactly one bcrypt comparison, so the caller cannot be distinguished by
 * how long it took. Always returns false when `hash` is null: the decoy is a timing
 * equaliser, never a way in.
 */
export async function verifyPasswordOrDecoy(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, DECOY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}
