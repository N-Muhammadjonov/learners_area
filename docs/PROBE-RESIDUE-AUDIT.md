# Mutating-probe cleanup audit (section 03.4)

## Why this was measured rather than reviewed

The question was "which mutating probes lack exception-safe cleanup?". Reading the
scripts cannot answer it. A grep for `INSERT` counts a `POST /api/auth/login` as a
mutation, and the presence of a cleanup block says nothing about whether the cleanup
works — a `delete` that silently matches nothing looks exactly like one that succeeds.

So residue is measured. `scripts/audit-probe-residue.mjs` counts every row in every
table in the `public` schema, runs a probe to completion, counts again, and reports the
per-table delta.

```
DATABASE_URL=... BASE_URL=... node scripts/audit-probe-residue.mjs verify-reading verify-lessons
```

**What a non-zero delta proves:** a real, reproducible leak.
**What a zero delta does NOT prove:** that nothing was mutated. A row created and
deleted inside the run nets to zero, and an UPDATE in place is invisible to a row
count. The harness is a leak detector, not a mutation detector.
**What it does not cover:** the throw path. A probe that cleans up correctly on the
success path can still orphan rows when an assertion fails midway. That is proven
per-probe by fault injection instead (see "Mutation testing" below).

## Measured result

Before: **14 of 29** probes exercised left rows behind on every run. After: **0**.

| Probe | Residue per run, before | Treatment |
|---|---|---|
| verify-vocabulary | +2 users, +14 lexemes, +13 lexical_units, +21 lexical_unit_forms, +14 user_vocabulary, +10 notifications, +16 activity_events, +6 audit_log, +4 vocab_point_events, +2 access_requests, +2 evaluations, +2 vocabulary_usages, +1 vocab_folders | differential sweep |
| verify-reading | +6 reading_answers, +1 reading_attempts, +1 lexemes, +1 lexical_units, +1 lexical_unit_forms, +1 user_vocabulary, +1 vocab_folders, +2 activity_events | differential sweep |
| verify-access | +1 users, +1 access_requests, +8 notifications, +6 audit_log | differential sweep |
| verify-publication | +1 reading_passages, +1 reading_questions, +1 reading_attempts, +1 reading_answers, +6 audit_log, +1 activity_events | differential sweep |
| verify-coach | +4 coach_weaknesses, +4 evaluations, +2 grammar_attempts, +2 vocabulary_usages, +1 vocab_point_events, +11 activity_events | differential sweep |
| verify-listening | +1 listening_attempts, +3 listening_answers, +1 listening_mcq_sessions, +1 activity_events | differential sweep + borrow/restore |
| verify-lessons | +2 lesson_notes, +1 lesson_progress, +3 activity_events | differential sweep + borrow/restore |
| verify-grammar | +4 grammar_attempts, +1 evaluations, +5 activity_events | differential sweep |
| verify-uploads | +3 content_versions, +3 activity_events (after the first pass) | tables added to the existing sweep |
| verify-support | +1 problem_reports, +1 audit_log | differential sweep |
| verify-owner | +2 notifications, +2 audit_log | differential sweep |
| verify-retention | +2 audit_log | differential sweep |
| verify-video-lessons | +1 content_versions, +1 audit_log | differential sweep |
| verify-live-classes | +1 activity_events | differential sweep |
| verify-listening-general | +2 activity_events | differential sweep |
| verify-writing | +1 typing_runs, +1 activity_events | differential sweep |

Already clean, left alone: `verify-progress`, `verify-dashboard`, `verify-navigation`,
`verify-pages`, `verify-a11y`, `verify-responsive`, `verify-shadowing`,
`verify-reading-v4`, `verify-admission-race`, `verify-retention-schema`,
`verify-listening-academic`, `verify-lesson-authoring-safety`,
`verify-lesson-learning-area`.

## The two patterns

**Differential sweep** (`createRowSweeper` in `scripts/lib/fixture-safety.mjs`).
These probes create rows over HTTP, so there is no single insertion point to tag. A tag
would not be enough anyway: it only covers rows the probe creates *deliberately*, while
the rows the PRODUCT creates in response — the notification, the audit entry, the
activity event — carry no tag at all, and those are most of the leak. So: snapshot the
owned tables **before the first mutation**, delete exactly the ids that appeared, then
re-query to **prove** they are gone. A row that existed before the run is never touched,
so a probe cannot destroy another suite's data or the seed.

`tables` must be ordered children-before-parents. This bit immediately: `lexemes`
references `lexical_units` with `RESTRICT`, so sweeping `lexical_units` first aborted the
sweep and the probe reported `fixture sweep FAILED` — correctly, which is the point.

**Borrow and restore** (`createRowBorrower`). Two probes deleted *pre-existing* rows as
setup — "clear this student's progress so the state machine can be walked from the
start". Those rows are seed data, not fixtures, and deleting them made the probe
**net-destructive**: `verify-lessons` measured `lesson_progress -1` and
`verify-listening` `listening_mcq_sessions -1` per run. The loss was invisible precisely
because a differential sweep only looks for rows that *appeared*. A probe may borrow
state; it must give it back, with the original ids so anything referencing them still
resolves.

The seeded `lesson_progress` rows for `new.student` had already been destroyed by
earlier runs before this was caught; a re-seed restores them.

## Exit paths

Cleanup is installed on every path a probe actually takes, not just the happy one
(`installSweepHandlers`): the tail of the script, `uncaughtException`,
`unhandledRejection`, and `beforeExit`. Most of these probes end with `process.exit()`,
which does **not** run `beforeExit` handlers — so the tail awaits the sweep explicitly.

A cleanup failure or any surviving row sets a non-zero exit code **even when every
assertion passed**. A probe that cannot clean up after itself has not proven it is
rerunnable, and the next run inherits state it did not create.

## Mutation testing

The sweeper's unit tests were verified by breaking the source three ways and confirming
each was caught (source restored byte-identical afterwards):

| Mutation | Result |
|---|---|
| sweep deletes every id, not only new ones | 11 pass / **2 fail** |
| residue re-query result discarded | 12 pass / **1 fail** |
| `sweep()` permitted without `capture()` | 12 pass / **1 fail** |

Two probes were also fault-injected end to end. With deletion removed from
`verify-vocabulary`, the run reported residue and **exited 1** despite 101/101
assertions passing; with a throw injected mid-run, the `uncaughtException` path still
swept the fixtures. The borrow/restore path was proven with a positive control in both
probes — a row inserted before the run, matched by id and contents afterwards — because
with no pre-existing rows to borrow the restore would have passed vacuously.

## Open, not fixed here

- `verify-brand` and `verify-theme` fail on design-token and brand-mark assertions.
  Neither is in the 24-suite acceptance gate and neither is related to this work;
  **not triaged yet** — they are either stale probes or real UI drift.
- `verify-listening-revision-migration` is refused by `assertMutableDatabase()` because
  it legitimately connects to the `postgres` maintenance database to create a throwaway
  one. The guard needs an explicit allowance for that narrow case.
- `verify-listening-mcq-probe-clean` fails on a missing relation; it expects a schema
  this QA database does not have.
- `verify-migration-tooling` requires `MIGRATION_TEST_ADMIN_URL`, which is unset. A
  configuration skip, not a failure.
