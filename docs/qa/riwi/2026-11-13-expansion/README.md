# RIWI procedural help and language expansion — 2026-11-13

Work started from remote main `69c1b46e0a21976d21532b9a1ce991ea49a629d4`.
The earlier RIWI checkpoint and remote QA branch are ancestors of this main.
Implementation was completed on main and released to Railway with explicit Owner approval. Database migration is outside this change.
The Owner clarified that Railway is the active host; Vercel is no longer the
deployment target for this work.
Remote main advanced during implementation; `3a1cef04bad066cf7002d99509b67a6928c34a56`
was merged without conflicts before preparing the Preview.

## Delivered behaviour

- All 200 supplied intents have original Uzbek/English explanations and preserve
  all 1,000 supplied expressions. The original markdown and its hash remain in
  `contracts/riwi_sources`; document text grants no permission.
- All shipped grammar books are indexed: 80 core, 77 Speaking, 120 Writing units.
  Rules, instructional examples and stage kinds are included; exercise items,
  keys, model exercise solutions and practice-QA banks are excluded. Uzbek rules
  are used; one derived contractions explanation was corrected to avoid claiming
  that spoken English always requires contracted forms. Original book bytes stay unchanged; English presentation uses the formula, examples and English
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

- After the live material-resolution fix, 3,653 RIWI backend tests, plus 282
  subtests, passed. The fix's affected help/material-search set has 150 passes.
- 41 HTTP/SEO/native-build/static-asset core checks passed. The native build
  packages 1,010 files and 138 routes; Docker's build-only Rollup dependency was
  installed in the QA environment rather than changing application dependencies.
- 45 RIWI frontend tests passed, including actual DOM suggestion clicks.
- Separate synthetic semantic holdout: 26/26. See
  `offline-semantic-holdout.json`. It includes multiple modules, spelling/dialect,
  unsupported intents, numeric differences, grammar units and role refusals. It
  uses no DB or external provider and is **not live/browser proof**.
- Full frontend suite before the last upstream-main integration: 1,672 passed,
  11 existing skips, 22 failures. Every one of
  those 22 failures also reproduces on untouched baseline main under the same
  dependencies; there are no new-only failures in this comparison. See
  `frontend-baseline-comparison.json`. The full frontend suite is not green.
- The old RIWI schema test froze the whole repo at 82 migrations although current
  main has 84. It now allows additive main migrations; existing RIWI filename/hash,
  FK and index assertions stay enforced. No SQL file or database was changed.

## Historical partial live evidence

Safari connected to the existing QA Owner session on deployed commit
`86cdce47564cd3d736e2b9ff663a5ae1f63a1040`. Owner role was visible in Profile;
the same synthetic messages were independently read from QA project
`bpexpsugmuhwmztacbqd`. Identity, dialect, three Vocabulary question buttons,
one-click sending/answering and a Speaking grammar unit worked. The DB confirms
three numbered examples in the grammar response. Screenshot and redacted
read-only checks are in `safari-vocabulary-suggestions.jpg` and `partial-live-qa.json`.

The first Reading unknown-question went through live material resolution and
asked for a title without buttons. Commit `9f166725` fixes that path and preserves
the assessment/role refusal without suggestions. Its tests pass; the corrected three-button Reading fallback was subsequently
accepted live on Railway in the existing Safari Owner session. A subsequent Vercel deployment was rate limited; after the
Owner's Railway correction, no further Vercel testing or deployment is planned.
The agent-created QA tab was closed and the user's prior Safari tab restored.

## Railway target and approval boundary

- Project: LEARNERS AREA (`7d1f50bb-3847-4d7c-b2c2-ef63f08a98dd`).
- Service: learners_area (`c4cb2c24-6777-4b90-a04e-43bc88d69e1c`).
- Only environment: production (`5255a4eb-401d-4fed-aec7-cd1433edc24f`).
- Source: N-Muhammadjonov/learners_area, main; Dockerfile:
  services/backend/Dockerfile. Public domain: learnersarea.uz.
- Observed successful deployment: `c5ca75ce-8acf-4908-a4cd-07a682511a94`,
  commit `3a1cef04bad066cf7002d99509b67a6928c34a56`.
- No Railway environment or service-configuration change was made.
  Pushing remote main triggers production directly. The Owner explicitly approved
  that main push and Railway production release on 2026-11-13 after reviewing the
  concrete code/test result. Production acceptance is recorded below.

## Remaining practical limits

Arbitrary language comprehension, arbitrary sentence generation/translation and
perfect dialect recognition are not claimed. An uncertain match asks for help
instead of selecting a nearest answer. No exercise keys are newly indexed.
Physical microphone and iPhone acceptance were not rerun for this change.

## Railway production acceptance — 2026-11-13 to 2026-11-14

- Application `cecd72e9` deployed successfully after explicit release approval.
  Native Safari Owner accepted Reading and Writing unknown-question suggestions,
  one-click question submission with an actual procedural answer, links, and core,
  Speaking and Writing grammar explanations. The Speaking grammar answer visibly
  contained all three examples across overlapping scroll views.
- Application `7365cee1` corrected the spoken-contractions overgeneralisation and
  literal Markdown markers. The revised rule was observed live. Informal
  `eganging kim` returned the authorised-platform Owner explanation.
- Reply language was changed to English through the separate picker: old Uzbek
  messages stayed unchanged and the next two-selection MCQ question received
  English procedural help rather than an answer key. The picker was restored to UZ.
- Dictionary example generation now requests a verified verb and reviewed exact
  meaning; occurrence-bound senses cannot be silently switched. The actual
  production answer at `64479c47` used write — yozmoq and three correct new
  past-simple examples. It no longer selected the unrelated spelling sense.
- Final source includes the Owner's complete removal of the obsolete Speaking
  activity. See `../2026-11-14-shadowing-removal/railway-release.json` for current
  application SHA, Railway receipt, HTTP checks and native Safari evidence.
- Current affected validation: 3,671 RIWI tests plus 282 subtests; 43 HTTP/SEO/
  material-create checks; six build checks; 111 focused frontend checks. The
  previously documented full-suite baseline failures are not reported as fixed.
- Browser screenshots with the Owner's actual profile image remain local rather
  than being published in Git. The night/UZ Main page was restored after acceptance.
