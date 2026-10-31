# Listening Test 16 — Part 1 closure gate (2026-10-31)

## Current reproducible state
- Source: `services/backend/assets/listening/test-16.json`, `transcript[1]`
- Active pinned dictionary: `rel-v1-1fa06d8d41d8ff701632573e`
- 566 legacy-release verified spans remain in `audits/listening/test-16-verified-binding-plan.json` (243 unique senses independently checked against active R2)
- All **126 uncovered transcript tokens** have source offsets and proposed lexical targets in `test-16-part1-staged-remaining-bindings.json`
- 57 staged draft operations (including new lexical units and added senses) in `test-16-part1-dictionary-drafts.json`
- `semi-finals` must reuse the existing `semifinal` sense by adding the surface form to a new release; `trainers` must use the new shoe sense of existing `trainer`, not the instructor sense.
- Proper names (Scope, Brighton Marina, Palace Pier, Hong Kong), spelling M-A-R-I-N-A, and clock notation need distinct entity/abbreviation handling, not guessed English common-noun senses.

## Do not mark completion from staged data
A proposed target is **not** an entryId/senseId in the active release. Only a new validated, immutable release may supply the missing IDs and canonical meaning hashes. Existing release plan cannot accept draft IDs. A direct binding would violate `dictionary_context.apply_context_bindings`.

## Deterministic completion sequence
1. Audit each draft against the appropriate Cambridge/Oxford/Longman entry (for named entities use reliable official place/organization evidence instead); correct unsupported CEFR, examples, and relation claims before publish.
2. Check duplicates against every entry in the active release using normalized lemma, part of speech, and lexical type. Apply new-lexeme drafts before add-sense drafts with deterministic new-entry IDs. Apply the semifinal form extension and trainer new shoe sense; use a copy-on-write new release. Preserve editorial sources and existing relations.
3. Generate a full, version-pinned Part 1 binding plan for the **new** release, replacing any smaller overlapping bound spans when a verified compound/fixed expression is used. Do not break or delete the other three parts; preserve their own independently pinned plans.
4. Resolve the remaining lexical items to actual entryId, senseId, surface_form, POS, and canonical `senseMeaningHash`; re-check every source offset against original transcript. Mark proper-name tokens separately as verified named entities (if the product has no named-entity support, add it before claiming 100% token coverage).
5. Run the Python preflight and regression tests, then validate the assembled binding plan against the new R2 release; require zero unaccounted tokens and zero overlap/ambiguity. Preserve and reconcile the eight old unresolved sentence-fragment annotations atomically.
6. Only after the new release and all verification gates pass, use a guarded operator-authorized maintenance transaction to apply Part 1 bindings. Assert that the release ID, source SHA, old row inventory, and existing learner content remain unchanged. Do not advance to Part 2 without confirmed Part 1 QA.

## Explicit blockers as of this commit
- No new dictionary release has been built/published. `57` drafts are not live senses.
- The `126` remaining tokens are enumerated and assigned editorial destinations, **not** live bound.
- Runtime database occurrence reconciliation and end-to-end tests have not run.
- Production and main intentionally remain unchanged.

Do not display `Part 1 = 100% integrated` until every gate above is met.
