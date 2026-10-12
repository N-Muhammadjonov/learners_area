import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions, speakingAttempts, speakingPrompts } from "@/db/schema";
import { publishedVersion } from "@/lib/content/versions";
import { isLive } from "@/lib/services/cms/publication";

/**
 * SPEAKING CANONICAL IDENTITY (§5).
 *
 * The Speaking Practice architecture stays exactly as it is: one bank
 * (`speaking_prompts`), one attempt history (`speaking_attempts`), recordings and
 * transcripts where they already live, and the RIWI evaluation boundary untouched.
 *
 * What this module adds is the identity RELATIONSHIP that was missing: an attempt now
 * records the exact revision it answered. Before this, `speaking_attempts.content_version_id`
 * existed in the schema and was never written, so a re-authored prompt silently changed
 * what an old attempt had been practising against.
 *
 * Two rules, both fail-closed:
 *
 *   • a prompt that is not LIVE for learners cannot be practised against (a draft or a
 *     future-scheduled prompt is not learner-facing, and binding its revision would be a
 *     publication bypass);
 *   • an attempt records the revision `publishedVersion` names — the newest PUBLISHED
 *     revision of that identity — or nothing. A legacy prompt with no canonical revision
 *     still starts (the architecture is unchanged) and its attempt is honestly unbound
 *     rather than pinned to an invented version.
 */

export type SpeakingPart = "part1" | "part2" | "part3" | "general";

/** Which canonical content type each bank part is authored as. */
export const SPEAKING_PART_CONTENT_TYPE: Record<"part1" | "part2" | "part3", string> = {
  part1: "part1_question",
  part2: "cue_card",
  part3: "part3_question",
};

export type SpeakingAttemptRow = typeof speakingAttempts.$inferSelect;

export type StartSpeakingAttemptInput = {
  actorId: string;
  promptId: string | null;
  part: SpeakingPart;
};

export type StartSpeakingAttemptResult =
  | {
      ok: true;
      attempt: SpeakingAttemptRow;
      /** The revision pinned on the attempt, when the bank could name one. */
      contentVersionId: string | null;
      /** Why an attempt is unbound, so the UI never implies a revision it does not have. */
      binding: "pinned" | "free_practice" | "no_canonical_revision";
    }
  | { ok: false; reason: "prompt_not_found" | "prompt_not_live" | "part_mismatch" };

type Select = typeof db.select;
type Insert = typeof db.insert;
type Executor = { select: Select; insert: Insert };

export async function startSpeakingAttempt(
  input: StartSpeakingAttemptInput,
  executor: Executor = db,
): Promise<StartSpeakingAttemptResult> {
  if (!input.promptId) {
    const [created] = await executor
      .insert(speakingAttempts)
      .values({ userId: input.actorId, promptId: null, part: input.part, status: "recording" })
      .returning();
    return { ok: true, attempt: created!, contentVersionId: null, binding: "free_practice" };
  }

  const [prompt] = await executor
    .select({
      id: speakingPrompts.id,
      part: speakingPrompts.part,
      externalId: speakingPrompts.externalId,
      isActive: speakingPrompts.isActive,
      publicationState: speakingPrompts.publicationState,
      publishAt: speakingPrompts.publishAt,
    })
    .from(speakingPrompts)
    .where(eq(speakingPrompts.id, input.promptId))
    .limit(1);

  // Missing or deactivated: the same answer the route has always given.
  if (!prompt || !prompt.isActive) return { ok: false, reason: "prompt_not_found" };

  // A prompt of one part is not an answer to another part. `general` is the declared
  // free-flow part, so it is only refused when the prompt itself is a specific part and
  // a DIFFERENT specific part was asked for.
  if (input.part !== "general" && prompt.part !== input.part) return { ok: false, reason: "part_mismatch" };
  if (input.part === "general" && prompt.part !== "general") return { ok: false, reason: "part_mismatch" };

  // Publication, by the ONE rule the learner reads use. `isActive` is not enough: it is a
  // legacy hint, and a draft with is_active = true is still a draft.
  if (!isLive({ publicationState: prompt.publicationState, publishAt: prompt.publishAt }))
    return { ok: false, reason: "prompt_not_live" };

  const contentType = prompt.part === "general" ? null : SPEAKING_PART_CONTENT_TYPE[prompt.part];
  const version =
    contentType && prompt.externalId ? await publishedVersion("speaking", contentType, prompt.externalId, executor as never) : null;

  const [created] = await executor
    .insert(speakingAttempts)
    .values({
      userId: input.actorId,
      promptId: prompt.id,
      part: input.part,
      status: "recording",
      contentVersionId: version?.id ?? null,
    })
    .returning();

  return {
    ok: true,
    attempt: created!,
    contentVersionId: version?.id ?? null,
    binding: version ? "pinned" : "no_canonical_revision",
  };
}

/**
 * The identity an attempt answered, resolved from the attempt's own pinned revision.
 *
 * This is what a reviewer, the timeline or a report may cite: the exact
 * `module:contentType:sourceRef@vN` the learner practised. An attempt with no pinned
 * revision returns null — never a guess from the current prompt row.
 */
export type SpeakingAttemptIdentity = {
  attemptId: string;
  contentVersionId: string;
  versionIdentity: string;
  title: string;
  publicationState: string;
};

export async function speakingAttemptIdentity(attemptId: string, executor: Executor = db): Promise<SpeakingAttemptIdentity | null> {
  const rows = await executor
    .select({
      attemptId: speakingAttempts.id,
      contentVersionId: speakingAttempts.contentVersionId,
      module: contentVersions.module,
      contentType: contentVersions.contentType,
      sourceRef: contentVersions.sourceRef,
      versionNo: contentVersions.versionNo,
      title: contentVersions.title,
      publicationState: contentVersions.publicationState,
    })
    .from(speakingAttempts)
    .innerJoin(contentVersions, eq(contentVersions.id, speakingAttempts.contentVersionId))
    .where(eq(speakingAttempts.id, attemptId))
    .limit(1);

  const row = rows[0];
  if (!row || !row.contentVersionId) return null;
  return {
    attemptId: row.attemptId,
    contentVersionId: row.contentVersionId,
    versionIdentity: `${row.module}:${row.contentType}:${row.sourceRef}@v${row.versionNo}`,
    title: row.title,
    publicationState: row.publicationState,
  };
}
