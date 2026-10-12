/**
 * The deterministic Retention evaluator.
 *
 * A pure function: learner recall text in, immutable Measurement Structure in,
 * score and breakdown out. No network, no clock, no randomness, no language
 * model. The same two inputs always produce byte-identical output, which is what
 * makes results reproducible, history explainable and re-grading unnecessary.
 *
 * The algorithm, in the owner's terms:
 *
 *   1. normalise the learner's answer and split it into evidence units;
 *   2. per claim, choose the evidence units its `scope` allows — one sentence at
 *      a time for `sentence`, the whole answer for `answer`;
 *   3. a reject phrase anywhere in those units contradicts the claim: 0 points;
 *   4. an accepted phrase inside one unit grants every NON-critical group;
 *      each critical group still needs its own authored value in that unit;
 *   5. otherwise every group is tested inside ONE unit, and the best single unit
 *      wins — unrelated sentences are never stitched together;
 *   6. a group counts once, however many of its alternatives appear;
 *   7. the score is the sum of the claim scores, an integer from 0 to 100.
 *
 * v4 (retention-deterministic-v4): every occurrence of an alternative is
 * considered (a negated first mention no longer hides a later affirmative one),
 * and answer scope keeps sentence boundaries so negation never crosses a full stop.
 *
 * Deliberate non-goals: grammar, spelling, article usage, word order and
 * sentence structure carry no points. A learner who remembers "Company founded
 * 1998" has remembered the fact, and the score says so.
 */

import type { MeasurementClaim, MeasurementGroup, RetentionBreakdown, RetentionClaimResult, RetentionClaimStatus, RetentionEvaluation, MeasurementStructureV1 } from "./types";
import { RETENTION_EVALUATOR_VERSION } from "./types";
import { SENTENCE_BOUNDARY, findPhraseAll, isNegated, numericTokens, splitEvidenceUnits, tokens, unitTokens } from "./normalize";

function phraseMatches(unit: string[], phrase: string): boolean {
  const phraseTokens = tokens(phrase);
  if (phraseTokens.length === 0) return false;
  // "the company did not close" must not satisfy the reject phrase "closed";
  // any affirmative occurrence does (v4: every occurrence is considered).
  return findPhraseAll(unit, phraseTokens, false).some((index) => !isNegated(unit, index));
}

function groupMatches(group: MeasurementGroup, unit: string[]): boolean {
  // Typo tolerance exists for ordinary concepts only. A critical group, an
  // entity, a number and a date are matched exactly — `1989` never satisfies
  // `1998`, and a misspelt proper noun is not silently accepted.
  const fuzzy = group.kind === "concept" && !group.critical;
  for (const alternative of group.anyOf) {
    const expected = tokens(alternative);
    if (expected.length === 0) continue;
    // v4: the FIRST occurrence being negated no longer hides a later affirmative one.
    if (findPhraseAll(unit, expected, fuzzy).some((index) => !isNegated(unit, index))) return true;
  }
  return false;
}

/**
 * Does this unit contradict a critical number/date the claim expects?
 *
 * True when the unit contains numbers, but not one of them is an allowed value
 * for any critical/numeric group. `"the population increased to 500,000"` against
 * a critical `50,000` therefore cannot take the full claim through an accepted
 * phrase: contradiction safety beats convenience.
 */
function hasCriticalNumericConflict(claim: MeasurementClaim, unit: string[]): boolean {
  const allowed = new Set<string>();
  for (const group of claim.groups) {
    if (group.kind === "number" || group.kind === "date" || group.critical) {
      for (const alternative of group.anyOf) {
        for (const token of tokens(alternative)) if (/^\d+$/u.test(token)) allowed.add(token);
      }
    }
  }
  if (allowed.size === 0) return false;
  const present = numericTokens(unit);
  if (present.length === 0) return false;
  return !present.some((token) => allowed.has(token));
}

type UnitVerdict = { score: number; matched: string[] };

function scoreUnit(claim: MeasurementClaim, unit: string[]): UnitVerdict {
  const accepted = claim.acceptedPhrases.some((phrase) => phraseMatches(unit, phrase));
  const matched: string[] = [];
  let score = 0;
  for (const group of claim.groups) {
    // An accepted phrase vouches for the ordinary wording of the claim, never
    // for its critical facts: a critical number, date or entity is credited only
    // when THIS unit actually carries one of its authored values (v2). One
    // correct number can no longer neutralise a wrong date, and a wrong or
    // missing entity cannot ride in on a broad phrase.
    const viaPhrase = accepted && !group.critical && !hasCriticalNumericConflict(claim, unit);
    // A group is worth its configured points ONCE, however many of its
    // alternatives the learner used.
    if (viaPhrase || groupMatches(group, unit)) {
      matched.push(group.id);
      score += group.points;
    }
  }
  return { score: Math.min(score, claim.points), matched };
}

/**
 * Is this denial about THE claim? (v2)
 *
 * Token overlap alone is not enough: a shared year does not make "The weather
 * report for 1998 was not true" a statement about the company founded in 1998.
 * A unit is the claim's subject when it carries the claim's ordinary wording (an
 * accepted phrase or a concept/entity group). When it overlaps only through a
 * number or date, it is the claim's subject only if it carries no foreign content
 * of its own — "1998 was not true" still denies the claim.
 */
function unitRelevantTo(claim: MeasurementClaim, unit: string[]): boolean {
  if (claim.acceptedPhrases.some((phrase) => phraseMatches(unit, phrase))) return true;
  const matched = claim.groups.filter((group) => groupMatches(group, unit));
  if (matched.length === 0) return false;
  if (matched.some((group) => group.kind !== "number" && group.kind !== "date")) return true;
  const claimTokens = new Set<string>();
  for (const group of claim.groups) for (const alternative of group.anyOf) for (const token of tokens(alternative)) claimTokens.add(token);
  return unit.every((token) =>
    claimTokens.has(token) || /^\d+$/u.test(token) || DENIAL_FILLER.has(token) ||
    DISCLAIMER_PREFIXES.some((prefix) => token.startsWith(prefix)));
}

const DENIAL_FILLER = new Set(["not", "never", "no", "but", "and", "so", "however", "what", "all", ",", "actually", "really", "at"]);

/**
 * A denial with no subject of its own ("But this was not what happened", "It
 * was not true") refers back to the preceding sentence. Stopwords (this/it/that)
 * are already removed by normalisation, so the test is: after removing the
 * negation, the disclaimer word and connective filler, nothing is left. "The
 * weather report was not true" keeps "weather report" and is about something else.
 */
function denialIsAnaphoric(unit: string[]): boolean {
  return unit.every((token) => DENIAL_FILLER.has(token) || DISCLAIMER_PREFIXES.some((prefix) => token.startsWith(prefix)));
}

/**
 * Explicit denial of the remembered wording — "…but this was not what happened".
 *
 * A learner who lists the right words and then says they are not true has not
 * remembered the fact, and a system that paid them for the words would be
 * rewarding the opposite meaning. The rule is narrow and deterministic: a
 * negation token immediately followed (within three tokens) by a token that
 * begins with `happen`, `true`, `correct`, `accurate`, `real` or `fact`.
 */
const DISCLAIMER_PREFIXES = ["happen", "true", "correct", "accurate", "real", "fact"];

function unitDisclaimsMeaning(unit: string[]): boolean {
  for (let index = 0; index < unit.length; index += 1) {
    const token = unit[index]!;
    if (token !== "not" && token !== "never" && token !== "no") continue;
    if (unit[index + 1] === "only") continue;
    const limit = Math.min(index + 4, unit.length);
    for (let cursor = index + 1; cursor < limit; cursor += 1) {
      const candidate = unit[cursor]!;
      if (DISCLAIMER_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return true;
    }
  }
  return false;
}

function statusFor(awarded: number, possible: number): RetentionClaimStatus {
  if (awarded >= possible) return "captured";
  if (awarded > 0) return "partial";
  return "missed";
}

export function evaluateClaim(claim: MeasurementClaim, units: string[][], sentenceUnits: string[][] = units): RetentionClaimResult {
  // Denials are claim-local (v2): a disclaimer contradicts this claim only when
  // it sits in a sentence that carries evidence for the claim, or refers back
  // ("this/that/it was not true") to the immediately preceding relevant
  // sentence. An unrelated "the weather report was not true" no longer zeroes
  // a correctly remembered fact.
  const disclaimed = sentenceUnits.some((unit, index) =>
    unitDisclaimsMeaning(unit) && (
      unitRelevantTo(claim, unit) ||
      (index > 0 && denialIsAnaphoric(unit) && unitRelevantTo(claim, sentenceUnits[index - 1]!))
    ));
  const contradicted = disclaimed ||
    units.some((unit) => claim.rejectPhrases.some((phrase) => phraseMatches(unit, phrase)));

  if (contradicted) {
    return {
      claimId: claim.id,
      claimLabel: claim.label,
      possiblePoints: claim.points,
      awardedPoints: 0,
      status: "contradicted",
      matchedGroupIds: [],
      missingGroupIds: claim.groups.map((group) => group.id),
      missingCriticalGroupIds: claim.groups.filter((group) => group.critical).map((group) => group.id),
    };
  }

  let best: UnitVerdict = { score: 0, matched: [] };
  for (const unit of units) {
    const verdict = scoreUnit(claim, unit);
    // Strictly greater keeps the FIRST sentence when two tie: the choice is
    // deterministic and never depends on iteration accidents.
    if (verdict.score > best.score) best = verdict;
  }

  const possible = claim.points;
  const awarded = Math.max(0, Math.min(best.score, possible));
  const matchedSet = new Set(best.matched);

  return {
    claimId: claim.id,
    claimLabel: claim.label,
    possiblePoints: possible,
    awardedPoints: awarded,
    status: statusFor(awarded, possible),
    matchedGroupIds: claim.groups.filter((group) => matchedSet.has(group.id)).map((group) => group.id),
    missingGroupIds: claim.groups.filter((group) => !matchedSet.has(group.id)).map((group) => group.id),
    missingCriticalGroupIds: claim.groups
      .filter((group) => group.critical && !matchedSet.has(group.id))
      .map((group) => group.id),
  };
}

export function evaluateRecall(recallText: string, structure: MeasurementStructureV1): RetentionEvaluation {
  // An explicit list of isolated rubric terms contains separate fragments,
  // not evidence that those terms describe the same fact. Do not stitch it
  // together even for answer scope. Normal prose and terse factual sentences
  // ("Company founded 1998") retain the ordinary, grammar-neutral matcher.
  // Numeric separators such as 50,000 stay inside their term.
  const listParts = recallText.split(/,(?!\d)|[;\n]/u).map((part) => part.trim()).filter(Boolean);
  const rubricTerms = new Set(structure.claims.flatMap((claim) => claim.groups.flatMap((group) => group.anyOf.map((term) => tokens(term).join(" ")))));
  const isolatedTermList = listParts.length >= 2 && listParts.every((part) => rubricTerms.has(tokens(part).join(" ")));
  const sentenceUnits = (isolatedTermList ? listParts : splitEvidenceUnits(recallText)).map(unitTokens);
  // v4: the whole answer keeps its sentence boundaries as clause-boundary tokens,
  // so "…had no future. Cheap flights…" no longer negates "cheap" across the full
  // stop, and no authored phrase can be matched across two sentences.
  const wholeAnswer = sentenceUnits.flatMap((unit, index) => (index === 0 ? unit : [SENTENCE_BOUNDARY, ...unit]));

  const claims = structure.claims.map((claim) =>
    evaluateClaim(claim, claim.scope === "sentence" || isolatedTermList ? sentenceUnits : [wholeAnswer], sentenceUnits)
  );

  const score = claims.reduce((sum, claim) => sum + claim.awardedPoints, 0);
  const totalGroups = structure.claims.reduce((sum, claim) => sum + claim.groups.length, 0);
  const matchedGroups = claims.reduce((sum, claim) => sum + claim.matchedGroupIds.length, 0);

  const breakdown: RetentionBreakdown = {
    schemaVersion: 1,
    evaluatorVersion: RETENTION_EVALUATOR_VERSION,
    maxScore: structure.maxScore,
    score,
    totals: {
      captured: claims.filter((claim) => claim.status === "captured").length,
      partial: claims.filter((claim) => claim.status === "partial").length,
      missed: claims.filter((claim) => claim.status === "missed").length,
      contradicted: claims.filter((claim) => claim.status === "contradicted").length,
      matchedGroups,
      totalGroups,
      mainIdeasRemembered: claims.filter((claim) => claim.status === "captured").length,
      mainIdeasPossible: claims.length,
    },
    claims,
  };

  return { score, breakdown };
}
