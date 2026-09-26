import { and, eq, lte, or, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Publication state — the ONE place that decides whether authored content is
 * live for a student.
 *
 * Staff write content long before students should see it, and content is
 * withdrawn long after it was used. A single boolean could not express the three
 * situations that look identical from the database's point of view:
 *
 *   - `draft`      written, deliberately not visible yet;
 *   - `scheduled`  visible from a stated moment onwards (a lesson that opens on
 *                  Monday, a practice test that unlocks at 09:00);
 *   - `published`  visible now;
 *   - `archived`   withdrawn from students, kept forever.
 *
 * The last one matters most: archiving must not delete anything. A student's
 * finished attempt, its score, the questions and their evidence quotes all stay
 * readable afterwards — only *starting* something new against unpublished
 * content is refused. That is why this rule is applied where an attempt is
 * created and never where a past attempt is shown.
 *
 * The module is pure: the same function answers "is this live?" for the
 * database queries, for the interface badge and for the tests. Staff lists do
 * not filter at all — an editor has to see drafts and the archive, which is why
 * there is no "visible to staff" counterpart below.
 */

export const PUBLICATION_STATES = ["draft", "scheduled", "published", "archived"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const DEFAULT_PUBLICATION_STATE: PublicationState = "published";

export function isPublicationState(value: unknown): value is PublicationState {
  return typeof value === "string" && (PUBLICATION_STATES as readonly string[]).includes(value);
}

/** What a publishable row has to carry. */
export type PublishableRow = {
  publicationState: string;
  publishAt?: Date | string | null;
};

function moment(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * Is this content live for a student at `now`?
 *
 * A `scheduled` row without a moment is treated as a draft: "scheduled for
 * never" is not a way to publish by accident, and an empty schedule is a data
 * mistake rather than an instruction.
 */
export function isLive(row: PublishableRow, now: Date = new Date()): boolean {
  if (row.publicationState === "published") return true;
  if (row.publicationState === "scheduled") {
    const at = moment(row.publishAt);
    return at !== null && at <= now.getTime();
  }
  return false;
}

/**
 * The transitions an editor may make.
 *
 * Anything not listed here is refused, so a stray request cannot put an archived
 * item on a future schedule without restoring it first. Every state can still
 * reach every other state by a short path — the point is that each move is
 * deliberate, not that anyone is trapped.
 */
export const ALLOWED_TRANSITIONS: Record<PublicationState, PublicationState[]> = {
  draft: ["scheduled", "published", "archived"],
  scheduled: ["draft", "published", "archived"],
  published: ["draft", "scheduled", "archived"],
  // An archived item comes back as a draft first, or as a direct restore that
  // publishes it again — both are deliberate. It may not be scheduled straight
  // out of the archive: a schedule is a plan, and a plan needs something to look
  // at first.
  archived: ["draft", "published"],
};

export function canTransition(from: PublicationState, to: PublicationState): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * A scheduled state needs a moment; every other state must not carry one. This
 * keeps the database from holding a `scheduled` row that will never open, and
 * from holding a `published` row with a confusing leftover date.
 */
export function publicationProblem(
  state: PublicationState,
  publishAt: Date | null | undefined,
): "missing_publish_at" | "unexpected_publish_at" | null {
  if (state === "scheduled") {
    if (!publishAt || Number.isNaN(publishAt.getTime())) return "missing_publish_at";
    return null;
  }
  if (publishAt) return "unexpected_publish_at";
  return null;
}

/**
 * The visibility condition in SQL, for the queries that list content for
 * students. One rule serves every content type, instead of seven hand-written
 * `is_active = true` filters that could drift apart.
 */
export function liveWhere(
  columns: { publicationState: AnyColumn; publishAt: AnyColumn },
  now: Date = new Date(),
): SQL {
  return or(
    eq(columns.publicationState, "published"),
    and(eq(columns.publicationState, "scheduled"), lte(columns.publishAt, now)),
  ) as SQL;
}
