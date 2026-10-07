import test from "node:test";
import assert from "node:assert/strict";
import {
  listeningCanonicalContentSchema,
  listeningExample,
  listeningSemanticIssues,
  validateCanonicalListeningPackage,
} from "../src/lib/import/listening/canonical";
import { registerImportDescriptors } from "../src/lib/import/capabilities";

/**
 * EVIDENCE WINDOWS vs THE RECORDING (W1–W4).
 *
 * An authored evidence window is a claim about the recording: "the answer is hearable here". If the
 * window starts after the audio ends, or ends past it, then review offers a segment the learner can
 * never hear — and the defect belongs to the SOURCE. So the import refuses the package with a
 * validation error that names the question, rather than clamping the number into range (which hides
 * the defect behind a plausible-looking value) or inventing a better one (which would fabricate
 * evidence the recording never contained).
 *
 * The duration checked against is the source's own statement of the recording, and the boundary is the
 * owner's: 0 <= start <= end <= duration.
 */

registerImportDescriptors();

type Evidence = { at: number; end?: number; why: string };
type Question = { evidence: Evidence; number: number };

/** The shipped example envelope, with one question's evidence window replaced. */
function packageWith(evidence: Partial<Evidence>, durationSec?: number) {
  const raw = listeningExample() as { content: unknown };
  const example = listeningCanonicalContentSchema.parse(raw.content);
  const questions = example.questions.map((question, index) =>
    index === 0
      ? {
          ...question,
          evidence: {
            ...question.evidence,
            ...evidence,
            ...(evidence.end === undefined && "end" in evidence ? { end: undefined } : {}),
          },
        }
      : question,
  );
  /*
   * Shortening the recording shortens its Part ranges: `partRanges` is a claim about the SAME audio,
   * and the stored-package domain rules refuse ranges that run past it (correctly). Carrying them
   * along keeps this fixture honest instead of tripping an unrelated rule.
   */
  const partRanges = durationSec
    ? Object.fromEntries(
        Object.entries(example.studyPack?.partRanges ?? {}).map(([part, range]) => [
          part,
          [Math.round((range[0] / example.audio.durationSec) * durationSec), Math.round((range[1] / example.audio.durationSec) * durationSec)],
        ]),
      )
    : undefined;
  const content = listeningCanonicalContentSchema.parse({
    ...example,
    ...(durationSec ? { audio: { ...example.audio, durationSec } } : {}),
    ...(partRanges && example.studyPack ? { studyPack: { ...example.studyPack, partRanges } } : {}),
    questions,
  });
  return { ...(raw as Record<string, unknown>), content } as never;
}

/** The blocking issue messages of a package, or an empty list when it is valid. */
function blockers(pkg: unknown): string[] {
  const result = validateCanonicalListeningPackage(pkg);
  return result.ok ? [] : result.issues.map((entry) => entry.message);
}

const DURATION = 1650.964898; // the owner's own Test 11 recording length

test("W1 a window inside the recording is accepted, boundaries included", () => {
  assert.deepEqual(blockers(packageWith({ at: 10, end: 20 })), [], "an ordinary window is valid");
  assert.deepEqual(blockers(packageWith({ at: 0, end: 5 })), [], "a window at the very start is valid");
  assert.deepEqual(blockers(packageWith({ at: 12.5, end: 12.5 })), [], "a zero-length window is not out of bounds");
  assert.deepEqual(
    blockers(packageWith({ at: DURATION - 10, end: DURATION }, DURATION)),
    [],
    "a window ENDING exactly at the end of the recording is valid — the end bound is inclusive",
  );
  /*
   * A window STARTING exactly at the end of the recording is refused, and that is the pre-existing
   * stored-package rule (`evidence.at >= duration` fails), not something this suite may relax: a
   * "play from here" control pointing at the last frame of the file is not usable evidence. W5 pins
   * that boundary so it cannot drift.
   */
  assert.deepEqual(blockers(packageWith({ at: 0, end: undefined })), [], "at: 0 alone means NO authored evidence, not a bad one");
});

test("W2 a window that starts before it ends is refused, named, and never silently repaired", () => {
  const messages = blockers(packageWith({ at: 30, end: 12 }));
  assert.equal(messages.length, 1, "exactly one blocking issue");
  assert.match(messages[0]!, /^Q1: /, "the question is named");
  assert.match(messages[0]!, /12/, "the authored end is quoted back");
  assert.match(messages[0]!, /30/, "and the authored start");
  assert.equal(
    messages.some((message) => /clamp|adjusted|corrected/i.test(message)),
    false,
    "the package is refused, not repaired",
  );

  // The validator must not have written anything: the same object still carries what the source said.
  const pkg = packageWith({ at: 30, end: 12 }) as { content: { questions: Question[] } };
  assert.equal(pkg.content.questions[0]!.evidence.at, 30);
  assert.equal(pkg.content.questions[0]!.evidence.end, 12);
});

test("W3 a window past the end of the recording is refused — from either side", () => {
  const beyond = blockers(packageWith({ at: DURATION + 5, end: DURATION + 10 }, DURATION));
  assert.equal(beyond.length, 2, "a window wholly beyond the recording breaks both bounds");
  assert.ok(beyond.every((message) => message.startsWith("Q1: ")));
  assert.ok(
    beyond.some((message) => message.includes(String(DURATION))),
    "the real duration is stated, so staff can check it against the file",
  );

  const overhang = blockers(packageWith({ at: DURATION - 2, end: DURATION + 2 }, DURATION));
  assert.equal(overhang.length, 1, "a window that merely overhangs the end breaks one bound");
  assert.match(overhang[0]!, /past the end of the recording/);

  // A start just inside the recording with no authored end is valid — the strict rule is about
  // STARTING at or past the end (W1), not about every window that reaches the last second.
  assert.deepEqual(blockers(packageWith({ at: DURATION - 1, end: undefined }, DURATION)), []);
});

test("W4 a study clip outside the recording is REFUSED as a readable issue — never thrown, never clamped", () => {
  /*
   * An impossible clip (one that can never play) is refused by the storage contract itself:
   * `listeningDomainIssues` fails it as "Clip outside audio". That rule predates this suite and is not
   * relaxed here.
   *
   * What this pins is HOW the refusal reaches staff. The stored schema is parsed (not safe-parsed) by the
   * normalizer, so before this change the failure escaped `validateCanonicalListeningPackage` as a thrown
   * ZodError: the import route could only answer with a generic error and a bare code, and the staff
   * member learned nothing about which clip or which bound. It now comes back as a blocking issue with
   * the sentence the domain rule wrote.
   */
  const raw = listeningExample() as { content: unknown };
  const example = listeningCanonicalContentSchema.parse(raw.content);
  const beyond = example.audio.durationSec + 100;
  const content = listeningCanonicalContentSchema.parse({
    ...example,
    keyword1: [
      { q: 1, at: beyond, end: beyond + 30, heard: "clipped phrase", link: "Q1", text: "A study clip whose sleeve runs past the recording." },
    ],
  });
  const pkg = { ...(raw as Record<string, unknown>), content } as never;

  assert.doesNotThrow(() => validateCanonicalListeningPackage(pkg), "the door answers with issues, it does not throw");
  const result = validateCanonicalListeningPackage(pkg);
  assert.equal(result.ok, false, "an impossible clip is refused");
  if (result.ok) return;
  assert.ok(result.issues.some((entry) => entry.blocking), "refused, not advised");
  assert.ok(
    result.issues.some((entry) => entry.code === "schema_invalid" && /clip/i.test(entry.message)),
    "the message names the clip, so staff know what to fix",
  );

  // Nothing was rewritten: the source's own numbers survive so they can be compared with the file.
  assert.equal((pkg as { content: { keyword1: { at: number }[] } }).content.keyword1[0]!.at, beyond);
});

test("W5 a package that breaks the stored-package domain rules is REFUSED with readable issues, never thrown", () => {
  /*
   * The stored package schema is stricter than the content schema: it is where the domain rules live
   * (numbering, pairing, Part ranges, evidence against the recording). The normalizer used to PARSE,
   * so those failures escaped `validateCanonicalListeningPackage` as a thrown ZodError — the import
   * could only answer with a generic error, and staff learned nothing. A validation door that can
   * throw is not a validation door.
   *
   * `at === duration` is exactly that case: it is not "past the end" (the semantic rule is strict) and
   * the content schema cannot see the recording, but the stored domain rule refuses a window that
   * starts on the last frame of the file.
   */
  const pkg = packageWith({ at: DURATION, end: undefined }, DURATION);
  assert.doesNotThrow(() => validateCanonicalListeningPackage(pkg));
  const result = validateCanonicalListeningPackage(pkg);
  assert.equal(result.ok, false, "the domain rule refuses it");
  if (result.ok) return;
  assert.ok(result.issues.length > 0);
  assert.ok(result.issues.every((entry) => entry.blocking), "and refuses it rather than advising");
  assert.match(result.issues.map((entry) => entry.message).join(" | "), /Q1/, "the message names the question");
});
