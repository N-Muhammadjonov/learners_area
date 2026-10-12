# Vocabulary — test evidence (forensic acceptance audit)

Environment: sandbox, isolated local PostgreSQL (embedded binary, UTF8), database
`learners_qa2` recreated from scratch, migrated to 0029, seeded, then upgraded to 0030
with the real `drizzle-kit migrate`. No Preview or Production database was touched.
No browser was available (Playwright Chromium download blocked) — nothing here is browser evidence.

| Suite | Command | Result |
|---|---|---|
| Full repository suite, QA2 enabled | `QA2_DATABASE_TESTS=1 STORAGE_PROVIDER=local DATABASE_URL=…/learners_qa2 SPEAKING_BANK_SOURCE=… npm test` | 767 tests: 765 pass, 0 fail, 2 skipped |
| UI suite (jsdom) | `TSX_TSCONFIG_PATH=tests/ui/tsconfig.json node --import tsx --test tests/ui/*.test.tsx` | 127/127 |
| General Reading QA2 (in full suite) | tests/general-reading-qa2.test.ts | 26/26 |
| Vocabulary architecture QA2 (in full suite) | tests/vocabulary-architecture-qa2.test.ts | 20/20 |
| 0030 upgrade gates | scripts/qa2-general-reading-0030-upgrade.mjs seed → migrate → verify | PASS (0 changed / 0 missing / 0 added rows in 10 tables; 0 passages turned General) |
| Retention schema | node scripts/verify-retention-schema.mjs | 11/11 |
| Typecheck / lint / diff | npm run typecheck · npm run lint · git diff --check | clean |
| Production build | npm run build | success |
| HTTP E2E (production build, local) | scripts/qa2-vocabulary-acceptance-e2e.ts | 67/67 |

Skipped (not counted as pass): 2 Listening owner-upload tests (`Uploaded owner source…`,
`Actual uploaded source grades all 40…`) — they need the owner's source files, which
are not in the repository. Unrelated to vocabulary.

## HTTP E2E runs, in order (none hidden)

1. Run 1 — script error: fixture inserted `users.onboarded_at` (no such column). Application not reached. Fixed the fixture.
2. Run 2 — script error: `user_vocabulary.review_stage` does not exist (correct column: `srs_stage`). This also exposed VD-006 in a QA2 test. Fixed both.
3. Run 3 — 67/67 on the fixed code.
4. Pre-fix reproduction — route.ts reverted to the audit-start version, rebuilt: **64/67**; the three failures were the VD-001 checks (active-exam save without occurrence → 200, passage-id variant → 200, forged source → 200).
5. Final — fresh 0029→0030 database, fixed build: 67/67 (also re-run from the committed script path: 67/67).

Final run output:

```
PASS AR-01 active exam HTML is plain text
PASS AR-02 no occurrence/sense ids or definitions in exam payload
PASS AR-06 lookup by active attempt id -> 403 lexical_assistance_locked
PASS AR-07 passage-id bypass -> 403
PASS AR-08 forged General mode (lookup) -> 403
PASS AR-05 Add to Vocabulary by API during exam (occurrence) -> 403
PASS VD-001 save WITHOUT occurrence during active exam -> 403
PASS VD-001 save without occurrence via passage id during exam -> 403
PASS VD-001 forged Reading source id -> 404
PASS AR-08b Academic occurrence through a General passage id -> rejected
PASS AR-10 review: financial bank exact sense
PASS BANK-POLYSEMY review: river bank -> river sense (distinct)
PASS SEC IDOR: B cannot use A's attempt id
PASS GR-01 list page
PASS GR-01 chooser offers P1/P2/P3/Full
PASS GR-02 Passage 1 page renders interactive text
PASS GR-03 Passage 2 page renders interactive text
PASS GR-04 Passage 3 page renders interactive text
PASS GR-05 Full Reading: 3 tabs + interactive text
PASS GR-payload answer key not shipped before Check
PASS GR-08/09 P1 bank resolves by occurrence to the exact sense, no attempt
PASS GR-08/09 P2 bank resolves by occurrence to the exact sense, no attempt
PASS GR-08/09 P3 bank resolves by occurrence to the exact sense, no attempt
PASS GR-10 trap: river bank unresolved, no meaning
PASS VD-001 unresolved Save w/o meaning -> 422 needs_definition (no spelling sense)
PASS VD-001 learner's own meaning saved as its own entry (never the catalogue/financial sense)
PASS GR-11 MWE 'took the cost into account' -> take into account
PASS GR-12 inflections runs/ran/running -> one sense; bought -> buy
PASS FUNCTION-WORD standalone 'the' is not a target
PASS GR save P1
PASS GR-16 P1+P3 same sense -> one item
PASS L-02 Activity 1 open exam: lookup -> 403
PASS L-03 meaning endpoint -> 403 during exam
PASS L-04 save during exam -> 403
PASS L-03b Activity 5 save during open exam -> 403
PASS L-05/06 review: financial bank exact sense
PASS L-07/08 one-meaning trap: river bank unresolved
PASS L-11 timestamps null (no word timing in source)
PASS L-12 Activity 5 sense is the canonical one (same as Reading)
PASS VD-002 forged sessionSenseId (valid sense from another source) -> 404
PASS VD-002 forged sense not saved
PASS L save from review
PASS L-14 Activity 5 save same sense ok
PASS L-09 listening word w/o occurrence + no meaning -> 422
PASS L-03c new open attempt re-locks review
PASS CROSS one item for Academic review + General P1/P3 + Listening
PASS CROSS contexts: 2 General + 1 Academic + 1 Listening
PASS GR-13 General context truthful (set, passageNo, sentence, no attempt id)
PASS BANK-POLYSEMY river saved as a separate item
PASS CONCURRENT 3 parallel saves: no 500, one item, one context
PASS REVISIT General ?passage=1/3, Academic attempt, Listening section
PASS SEC B cannot read A's contexts (IDOR)
PASS SEC B cannot review A's item
PASS SRS review over HTTP ok; canonical sense unchanged
PASS SRS re-encounter does not reset schedule
PASS SRS isolation: B has no item for the sense
PASS REFRESH GET /api/vocabulary shows the sense once
PASS RELOGIN (fresh session token) still one item
PASS POPUP knows saved state after refresh
PASS GR-15 progress Check grades + evidence quote; evidence created no sense
PASS GR-15 reload shows saved score
PASS GR-15 per-passage rows
PASS GR-07 progress API refuses Academic passage
PASS API malformed payload -> 400 (no stack)
PASS API forged occurrence id -> 4xx
PASS AR-09 retake re-locks the old review
PASS GR unaffected by Academic retake
E2E 67/67
```
