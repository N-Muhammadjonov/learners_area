# Retention drafts (N14)

**Provenance: AI draft — not human-approved, not official IELTS material.** CEFR level, factual
accuracy and wording have **not** been checked by a person. Treat every text and every fact as
unverified until a human reviewer approves it.

This folder holds 75 original reading/recall drafts (15 each for A2, B1, B2, C1, C2) in the
strict 100-point measurement structure. Sources are in `src/<LEVEL>.txt`.

    node --conditions=react-server --import tsx scripts/build-retention-drafts.ts [--check]

## What the build actually proves (receipt: `docs/receipts/N14-retention-drafts.json`)

Every check uses the production modules (`countWords`, `validateMeasurementStructure`,
`evaluateRecall` at `retention-deterministic-v4`):

* **Word ranges:** each draft is inside its level's range.
* **Grounding:** every rubric group is grounded in the text.
* **Canonical recall:** each draft's labels, one sentence per claim, score **exactly 100**, with
  every claim captured. This holds for all 75.
* **Graded label values:** every number or year written in a label is graded by a
  number/date/entity group of that claim. A wrong year can therefore never take full points.
  Example: C2-03 with 1945→1946 or 2019→2020.
* **Wrong and missing values:** for **every** group (date, number, entity, concept), a wrong value
  and a missing value in the canonical recall must cost that claim points. That is 1,444
  mutations, all enforced.
* **Keyword lists:** a list of unrelated topic words scores < 50, and one rubric term per claim
  scores < 100.
* **Source text score:** recorded with its cause. 67/75 score 100. The other 8 score 90, all because
  of `sentence-scope-split`: the source spreads one fact over two sentences, and sentence scope
  deliberately refuses to stitch them. No deficit comes from negation or absence; the test
  enforces this.

## Root causes found by the audit (fixed)

The earlier build only checked "joined labels ≥ 70". The independent audit found 34 drafts whose
joined labels scored < 100 and 20 whose source text scored < 100. The causes were:

1. **Authoring:** label text missing the group term, or using a possessive ("Anderson's") that
   is a different token from the entity. Labels were rewritten.
2. **Authoring: negative facts.** A group like `garden` for "had no garden" can never match.
   Groups for negative facts are now the negative phrase (`no garden`).
3. **Answer-scope leakage:** a fuzzy concept matched in a different claim's sentence (for
   example, mutating `paralysis` still matched "analysis"). Those groups are now critical (exact).
4. **Scorer defects, fixed as evaluator v4** (new attempts only; stored attempts keep their v3
   score and breakdown, and nothing is re-graded):
   * a negation crossed sentence boundaries in answer scope;
   * only the first occurrence of an alternative was considered;
   * decimals ("1.27") split a sentence in two.
5. **Missing date/number groups:** years written in labels (C2-03 1945, 2019, and others) were not
   graded at all.

**Known limitation (not fixed):** a bare list of the exact rubric terms still scores 100 on
65/75 drafts. The scorer is keyword-based by design, and the rubric is never sent to learners.

## Boundaries

None of these drafts is in any bank, seed or migration, and `tests/n14-retention-drafts.test.ts`
enforces that. Publishing requires human review and approval through the admin flow.
