/**
 * A validated keyset cursor, shared by every bounded listing that has to stay walkable.
 *
 * WHY SHARED. Two listings already needed this (lesson units, the writing pattern
 * library) and each one hand-rolled the same decode-and-validate block. A validation
 * routine that exists twice drifts: one copy gains a UUID check, the other does not.
 *
 * WHAT IT IS, HONESTLY. base64url of JSON. It is NOT authenticated and must not be
 * described as server-minted: a caller can read it and can forge one. That is
 * acceptable because the cursor only selects a POSITION within an ordering the caller
 * is already entitled to read — every row it can reach is a row the same caller could
 * reach by paging from the start. What it must never do is widen access, reach the
 * database as a bad literal, or silently restart the walk and re-serve rows already
 * seen. Hence: fail closed, always, with one recognisable error.
 *
 * FILTER-BOUND. The tuple is only meaningful under the filter it was minted for.
 * Replaying page 2 of one search against a different search would resume at an
 * unrelated position and skip rows the caller never saw while reporting a clean page.
 * The filter fingerprint therefore travels inside the cursor and must match.
 */

const CURSOR_VERSION = 1;
/**
 * Refuse an absurd payload before spending work decoding and parsing it.
 *
 * MEASURED, NOT ASSUMED: removing this check (and the charset check below) does not
 * change a single verdict — every oversized or non-base64url input is rejected by the
 * JSON parse or the field checks anyway. They are kept as cheap pre-parse guards so a
 * megabyte of junk is dropped without being decoded, and are documented as redundant
 * rather than presented as load-bearing.
 *
 * The ceiling must stay comfortably above a LEGITIMATE cursor: three text keys at the
 * MAX_TEXT limit plus overhead is ~1.6 kB, so 1024 would have rejected valid cursors.
 */
const MAX_CHARS = 4096;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres integer bounds: an ordering key is a column value, not an arbitrary number. */
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
/** A text ordering key is a column value too; nothing legitimate is longer. */
const MAX_TEXT = 400;

export type CursorFieldKind = "text" | "int" | "uuid";

/** Thrown for every malformed, mis-versioned or mis-filtered cursor. */
export class InvalidCursorError extends Error {
  constructor(reason: string) {
    // The word "cursor" is load-bearing: routes match on it to answer 400 rather than
    // letting a bad literal surface as a 500.
    super(`invalid cursor: ${reason}`);
    this.name = "InvalidCursorError";
  }
}

export type CursorValue = string | number;

export function encodeCursor(kinds: readonly CursorFieldKind[], fingerprint: string, values: readonly CursorValue[]): string {
  if (values.length !== kinds.length) throw new InvalidCursorError("value count does not match the key shape");
  return Buffer.from(JSON.stringify([CURSOR_VERSION, fingerprint, ...values]), "utf8").toString("base64url");
}

/**
 * Decode and fully validate a cursor, or throw InvalidCursorError.
 *
 * `fingerprint` must be the fingerprint of the filter the CURRENT request is using.
 */
export function decodeCursor(
  raw: unknown,
  kinds: readonly CursorFieldKind[],
  fingerprint: string,
): CursorValue[] {
  if (typeof raw !== "string") throw new InvalidCursorError("not a string");
  if (raw.trim() === "") throw new InvalidCursorError("empty");
  if (raw.length > MAX_CHARS) throw new InvalidCursorError("oversized");
  if (!BASE64URL_RE.test(raw)) throw new InvalidCursorError("not base64url");

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError("not JSON");
  }
  if (!Array.isArray(parsed)) throw new InvalidCursorError("not a tuple");
  if (parsed.length !== kinds.length + 2) throw new InvalidCursorError("wrong tuple length");

  const [version, carried, ...values] = parsed as unknown[];
  if (version !== CURSOR_VERSION) throw new InvalidCursorError("unsupported version");
  if (typeof carried !== "string") throw new InvalidCursorError("missing filter fingerprint");
  if (carried !== fingerprint) throw new InvalidCursorError("minted under a different filter");

  return values.map((value, index) => {
    const kind = kinds[index]!;
    if (kind === "int") {
      if (typeof value !== "number" || !Number.isInteger(value)) throw new InvalidCursorError(`key ${index} is not an integer`);
      if (value < INT32_MIN || value > INT32_MAX) throw new InvalidCursorError(`key ${index} is out of range`);
      return value;
    }
    if (typeof value !== "string") throw new InvalidCursorError(`key ${index} is not text`);
    if (kind === "uuid" && !UUID_RE.test(value)) throw new InvalidCursorError(`key ${index} is not a uuid`);
    if (kind === "text" && value.length > MAX_TEXT) throw new InvalidCursorError(`key ${index} is too long`);
    return value;
  });
}

/** A stable fingerprint for a filter, so a cursor cannot be replayed under another one. */
export function filterFingerprint(filter: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(filter)
      .sort()
      .map((key) => [key, filter[key] ?? null]),
  );
}
