# RIWI procedural help and language expansion — 2026-11-13

Work started from remote main `69c1b46e0a21976d21532b9a1ce991ea49a629d4`.
The earlier RIWI checkpoint and remote QA branch are ancestors of this main.
Implementation is on local main. Production release and database migration are
outside this change. The existing QA Preview branch is used for deployment only.
Remote main advanced during implementation; `3a1cef04bad066cf7002d99509b67a6928c34a56`
was merged without conflicts before preparing the Preview.

## Delivered behaviour

- All 200 supplied intents have original Uzbek/English explanations and preserve
  all 1,000 supplied expressions. The original markdown and its hash remain in
  `contracts/riwi_sources`; document text grants no permission.
- All shipped grammar books are indexed: 80 core, 77 Speaking, 120 Writing units.
  Rules, instructional examples and stage kinds are included; exercise items,
  keys, model exercise solutions and practice-QA banks are excluded. Uzbek rules
  are preserved; English presentation uses the formula, examples and English
  procedural guidance. It is not a claim that every source paragraph was translated.
- Canonical dictionary lookup can supply a verified verb sense for new examples
  in four supported tenses. Unknown verb inflections/senses are not invented.
- A keyword retrieves candidate intents; weighted content matching compares the
  request and requires a unique strong match. Numbers and polarity remain
  constraints. This is a bounded matcher, not an embedding or neural model.
- Unmatched questions receive three server-selected, role-filtered common
  questions. This is a curated list, not a measured popularity ranking. All 32
  workflow groups are covered, rather than only MCQ. Clicking a question sends it
  once and receives its actual explanation. A suggestion does not submit pending
  attachments or another learner's target scope. IDs survive history reload and
  are filtered again against the current server actor.
- RIWI teaches a method instead of revealing exercise keys. Objective review
  retains attempt ownership/submission/teacher-assignment checks and returns an
  empty officialAnswer with teachingOnly=true, without the authored solution.
- Ten everyday topics have twelve original, bilingual, four-turn dialogues each.
  Contextual follow-ups use only the same user's unexpired, same-role chat.
  Owner identity is described as Learners Area's authorised Owner; an unverified
  person's name is not invented or permanently hardcoded.
- Explicit dialect corrections can reference reviewed new workflows, FAQs and
  dialogues in private memory. They are role-rechecked on reuse, store references
  rather than answer bodies, and never turn a user claim into a permission or fact.
- No external LLM/speech service was added. Existing transient on-device dictation
  and the exact double-check notice remain intact.

## Automated evidence

- 3,646 RIWI backend tests, plus 282 subtests, passed.
- 41 HTTP/SEO/native-build/static-asset core checks passed. The native build
  packages 1,010 files and 138 routes; Docker's build-only Rollup dependency was
  installed in the QA environment rather than changing application dependencies.
- 45 RIWI frontend tests passed, including actual DOM suggestion clicks.
- Separate synthetic semantic holdout: 26/26. See
  `offline-semantic-holdout.json`. It includes multiple modules, spelling/dialect,
  unsupported intents, numeric differences, grammar units and role refusals. It
  uses no DB or external provider and is **not live/browser proof**.
- Full frontend suite: 1,672 passed, 11 existing skips, 22 failures. Every one of
  those 22 failures also reproduces on untouched baseline main under the same
  dependencies; there are no new-only failures in this comparison. See
  `frontend-baseline-comparison.json`. The full frontend suite is not green.
- The old RIWI schema test froze the whole repo at 82 migrations although current
  main has 84. It now allows additive main migrations; existing RIWI filename/hash,
  FK and index assertions stay enforced. No SQL file or database was changed.

## Live evidence

Pending deployment and Owner-session verification. Safari can open a QA tab;
the production session is preserved. Do not label live acceptance complete until
the deployed commit, actual Owner session, question buttons and replies are observed.

## Remaining practical limits

Arbitrary language comprehension, arbitrary sentence generation/translation and
perfect dialect recognition are not claimed. An uncertain match asks for help
instead of selecting a nearest answer. No exercise keys are newly indexed.
Physical microphone and iPhone acceptance were not rerun for this change.
