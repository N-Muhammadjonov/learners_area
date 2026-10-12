/**
 * Writing a generated measurement document without destroying the analysis attached to it.
 *
 * Eight probes in scripts/ regenerate a Markdown document from their measurements. They used to do
 * it with a bare writeFileSync, which silently deletes anything a person appended afterwards —
 * `docs/UNBOUNDED-READS.md` lost its whole "the 6.15 MB figure is a floor, not the production cost"
 * correction the first time the probe was re-run after that correction was written.
 *
 * The convention: generated content is rewritten every run; anything between the two markers below
 * is preserved verbatim. A begin marker with no end marker is refused rather than guessed at, so a
 * truncated document cannot be quietly rewritten into something else.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const HAND_WRITTEN_BEGIN =
  "<!-- hand-written:begin — preserved verbatim when this document is regenerated -->";
export const HAND_WRITTEN_END = "<!-- hand-written:end -->";

/**
 * The preserved region of an existing document, without its markers, or null when there is none.
 * Throws on a malformed region: losing analysis silently is the failure this module exists to stop,
 * so a half-marked document is an error, not an empty string.
 */
export function extractHandWritten(existing) {
  if (typeof existing !== "string") return null;
  const begin = existing.indexOf(HAND_WRITTEN_BEGIN);
  if (begin === -1) return null;
  const end = existing.indexOf(HAND_WRITTEN_END, begin + HAND_WRITTEN_BEGIN.length);
  if (end === -1) {
    throw new Error(
      `${HAND_WRITTEN_BEGIN} has no matching ${HAND_WRITTEN_END} — refusing to regenerate over a hand-written section it cannot delimit`,
    );
  }
  return existing.slice(begin + HAND_WRITTEN_BEGIN.length, end).replace(/^\n+|\n+$/g, "");
}

/**
 * Write `generated` to `path`, carrying over the preserved region.
 *
 * `handWritten` seeds the region the first time; afterwards the region already in the file wins, so
 * a later run cannot revert somebody's edit by re-seeding it. Returns what was written.
 */
export function writeGeneratedDoc(path, generated, { handWritten = null } = {}) {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  const preserved = extractHandWritten(existing) ?? handWritten;
  const body = `${generated.replace(/\n+$/, "")}\n`;
  const out = preserved
    ? `${body}\n${HAND_WRITTEN_BEGIN}\n\n${preserved.replace(/\n+$/, "")}\n\n${HAND_WRITTEN_END}\n`
    : body;
  writeFileSync(path, out);
  return out;
}
