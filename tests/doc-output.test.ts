import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regenerating a measurement document must not destroy the analysis attached to it.
 *
 * `docs/UNBOUNDED-READS.md` is written by scripts/measure-unbounded-reads.mjs. A correction
 * explaining that the measured 6.15 MB is a FLOOR — the 10 000-prompt fixture inserts no
 * study_support, so 28% of every row was an empty skeleton — was appended to that document by
 * hand. The next run of the probe wrote the file with a bare writeFileSync and deleted all 3 600
 * characters of it. Nothing failed, nothing warned; the analysis was simply gone.
 *
 * These tests are the reason that cannot happen quietly again.
 */
const mod = () => import("../scripts/lib/doc-output.mjs" as string);

function scratch() {
  return mkdtempSync(join(tmpdir(), "doc-output-"));
}

test("the first write seeds the preserved region between the markers", async () => {
  const { writeGeneratedDoc, HAND_WRITTEN_BEGIN, HAND_WRITTEN_END } = await mod();
  const path = join(scratch(), "doc.md");

  writeGeneratedDoc(path, "| a | 1 |\n", { handWritten: "## Analysis\n\nProse a person wrote." });

  const out = readFileSync(path, "utf8");
  assert.ok(out.includes("| a | 1 |"), "the generated table is written");
  assert.ok(out.indexOf(HAND_WRITTEN_BEGIN) < out.indexOf("## Analysis"), "the region opens before the prose");
  assert.ok(out.indexOf("## Analysis") < out.indexOf(HAND_WRITTEN_END), "the region closes after the prose");
});

test("regenerating replaces the measurements but keeps the analysis verbatim", async () => {
  const { writeGeneratedDoc } = await mod();
  const path = join(scratch(), "doc.md");
  const analysis = "## Correction\n\nThe figure above is a floor, not the production cost.";

  writeGeneratedDoc(path, "| rows | 6148699 |\n", { handWritten: analysis });
  // A later run measures something different. The tables must move; the prose must not.
  writeGeneratedDoc(path, "| rows | 6148732 |\n");

  const out = readFileSync(path, "utf8");
  assert.ok(out.includes("6148732"), "the new measurement is written");
  assert.ok(!out.includes("6148699"), "the superseded measurement is gone — the tables really were regenerated");
  assert.ok(out.includes(analysis), "the hand-written analysis survived a regeneration unchanged");
});

test("a region already in the file wins over a seed, so a run cannot revert an edit", async () => {
  const { writeGeneratedDoc } = await mod();
  const path = join(scratch(), "doc.md");

  writeGeneratedDoc(path, "gen 1\n", { handWritten: "edited by a person" });
  writeGeneratedDoc(path, "gen 2\n", { handWritten: "stale seed text" });

  const out = readFileSync(path, "utf8");
  assert.ok(out.includes("edited by a person"), "what is in the file is what is kept");
  assert.ok(!out.includes("stale seed text"), "a caller cannot overwrite the file's own region by re-seeding");
});

test("a document with no markers is left alone and reports nothing preserved", async () => {
  const { extractHandWritten } = await mod();
  assert.equal(extractHandWritten("# just a table\n\n| a | 1 |\n"), null);
  assert.equal(extractHandWritten(null), null);
});

test("a begin marker with no end marker is refused rather than guessed at", async () => {
  const { writeGeneratedDoc, HAND_WRITTEN_BEGIN } = await mod();
  const path = join(scratch(), "doc.md");
  writeFileSync(path, `generated\n\n${HAND_WRITTEN_BEGIN}\n\nanalysis with no closing marker\n`);

  // The whole point of the module is that analysis is never lost silently. Faced with a region it
  // cannot delimit it must stop, not decide for itself where the prose ended.
  assert.throws(() => writeGeneratedDoc(path, "regenerated\n"), /no matching/);
  assert.ok(
    readFileSync(path, "utf8").includes("analysis with no closing marker"),
    "the refused run left the document exactly as it was",
  );
});

test("prose outside the markers is not preserved — the region has to be marked to survive", async () => {
  const { writeGeneratedDoc } = await mod();
  const path = join(scratch(), "doc.md");
  writeFileSync(path, "old generated table\n\ntrailing note nobody marked\n");

  writeGeneratedDoc(path, "new generated table\n");

  const out = readFileSync(path, "utf8");
  assert.ok(out.includes("new generated table"));
  assert.ok(
    !out.includes("trailing note nobody marked"),
    "unmarked text is regenerated away, which is why appending analysis without markers was never safe",
  );
});
