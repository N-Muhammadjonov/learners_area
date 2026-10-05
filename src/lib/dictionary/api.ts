import { NextResponse } from "next/server";
export const privateHeaders = { "Cache-Control": "private, no-store" };
const allowed = new Set([
  "dictionary_unavailable",
  "release_mismatch",
  "sense_not_found",
  "entry_not_found",
  "duplicate_lexeme",
  "duplicate_sense",
  "example_not_found",
  "publish_already_running",
  "no_drafts",
  "stale_draft",
  "draft_batch_limit",
  "candidate_already_exists",
  "job_not_found",
  "previous_release_unavailable",
  "manifest_validation_failed",
  "index_validation_failed",
  "release_validation_failed",
  "draft_set_changed",
]);
export const apiError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  return NextResponse.json(
    { error: allowed.has(message) ? message : "temporarily_unavailable" },
    { status: allowed.has(message) ? 409 : 503, headers: privateHeaders },
  );
};
