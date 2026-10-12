# Test residue audit — which QA2 test files leave rows behind

Produced by `scripts/audit-test-residue.mjs`, which captures every table's row count in the
`public` schema, runs **one** test file, captures again, and reports the delta. Zero delta is the
pass condition.

This exists because measuring a whole suite at once cannot answer the only question that matters
for cleanup: **which file leaked**. "The suite is green" says nothing about what it left behind — a
test can pass every assertion and still leave 786 rows in 19 tables.

## Result

```
24 file(s) audited · 16 clean · 8 leaving residue · 0 failing
```

The 24 files are every `tests/*.test.ts` that reads `QA2_DATABASE_TESTS`. The run used the full QA2
acceptance environment (`QA2_DATABASE_TESTS=1`, `STORAGE_PROVIDER=local`,
`STORAGE_LOCAL_DIR=/tmp/qa2-uploads`, `AUTH_SECRET`, `QA2_BASE_URL`) against a freshly migrated and
seeded local database, one file at a time, in series.

| file | rows left | tables | what accumulates |
| --- | --- | --- | --- |
| `tests/general-reading-qa2.test.ts` | **+786** | 19 | `general_reading_passages` 3→87, `lexical_occurrences` 0→235, `lexemes` 4→144, `general_reading_sets` 1→29, `activity_events` 4→15, `general_reading_progress` 0→6, `lexical_unit_forms` 0→13, `lexical_units` 0→5, +11 more |
| `tests/vocabulary-architecture-qa2.test.ts` | **+281** | 19 | `lexemes` 144→177, `lexical_occurrences` 235→285, `activity_events` 15→36, `general_reading_passages` 87→99, `general_reading_sets` 29→41, `lexical_unit_forms` 13→24, `lexical_units` 5→9, `lexical_unit_pronunciations` 0→1, +11 more |
| `tests/academic-reading-qa2.test.ts` | **+47** | 4 | `reading_questions` 6→46, `reading_passages` 1→4, `general_reading_passages` 0→3, `general_reading_sets` 0→1 |
| `tests/vocabulary-integrity-db.test.ts` | **+12** | 2 | `lexical_units` 9→15, `lexical_unit_forms` 24→30 |
| `tests/video-completion-db.test.ts` | **+11** | 1 | `content_versions` 0→11 |
| `tests/qa2-postgres-n07-n08.test.ts` | **+8** | 4 | `users` 34→36, `audit_log` 0→2, `retention_texts` 0→2, `retention_text_versions` 0→2 |
| `tests/vocabulary-points-db.test.ts` | **+8** | 2 | `lexical_units` 15→19, `lexical_unit_forms` 30→34 |
| `tests/retention-db.test.ts` | **+2** | 1 | `audit_log` 2→4 |

Totals are cumulative across the series, so the "from" value of one file is the "to" value of the
previous one. 1 155 rows remain after the eight files have each run once.

The 16 clean files include `tests/assignment-atomicity-qa2.test.ts`, `qa2-live-partner`,
`qa2-progress-scale`, `qa2-google-race`, `reading-v4-history-invariants`,
`reading-v4-scheduled-activation`, `speaking-shared-bank`, `speaking-topic-management`,
`writing-query-db`, `notifications-db`, `grammar-privacy-db`, `grammar-publication-qa2`,
`lexical-migration-db`, `dictionary-recent-qa2`, `reading-library-db`,
`qa2-speaking-bank-import`.

## A false alarm worth recording: `retention-db.test.ts` "test-failed"

The first audit run reported this file as `test-failed` rather than measuring it. It is not a
product defect and not an order dependency. `tests/retention-db.test.ts:16` is

```ts
assert.equal(process.env.STORAGE_PROVIDER, "local");
```

— a **precondition guard**, and a correct one: the test refuses to run rather than silently
exercising the wrong storage backend. The auditor was spawning each file with only `DATABASE_URL`
and `QA2_DATABASE_TESTS`, so the guard fired on line 16 and every subtest failed on
`expected: 'local'`.

That is worse than a nuisance. A file that throws on line 16 has written nothing and cleaned
nothing, so its residue is **unmeasurable** — the audit would have reported a failure and produced
no data for the one file whose subject is deletion and retention. The auditor now fails closed: it
names the missing variables and exits 2 instead of proceeding, so a correct refusal can never be
mislabelled as a test failure. Re-run with the complete environment, `retention-db` executes and
leaves `audit_log +2`.

## What this tool does not prove

Stated in the tool's own output and repeated here because it is the limitation that matters:

**Zero delta is not zero mutation.** A test that inserts a row and deletes it nets to zero. A test
that UPDATEs a row in place is invisible to a count entirely. Row counts are the cheap first line
of evidence, not a proof of isolation. Proving isolation for a given file needs that file's own
before/after comparison of the *content* of the rows it touches, which is what
`scripts/lib/fixture-safety.mjs` does for the probe scripts and what these eight files lack.

## Classification

`REPRODUCED_DEFECT` — test-suite hygiene, not production behaviour. The eight files write to the
shared QA database and do not remove what they wrote. Consequences that are real rather than
cosmetic: a later test in the same series sees a different corpus than the first one did
(`lexemes` grows 4→177 across the series, so any count-based or "first match" assertion becomes
order-dependent); the QA database cannot be reused for a measurement without a full re-migrate and
re-seed; and a residue audit of a *suite* cannot attribute any of it.

Not yet fixed. The fix belongs in each test file (tag its fixtures and delete them, or run inside a
rolled-back transaction), and `tests/general-reading-qa2.test.ts` and
`tests/vocabulary-architecture-qa2.test.ts` account for 1 067 of the 1 155 rows, so they are where
any remediation should start.
