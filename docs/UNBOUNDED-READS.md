# §10 Unbounded learner-facing reads — measured

`listActivePrompts(channel)` in `src/lib/data/speaking-practice.ts` is `findMany({ where, orderBy })`
with no limit, and both callers hand the whole result to a client component, so every published
prompt is read and serialised into the page on every request. Measured against a running server
and instrumented PostgreSQL with a tagged corpus built and destroyed by this probe.

## Raw measurements

| surface | corpus | published bank | HTTP | queries | rows read | db ms | median ms | bytes | prompts rendered |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Speaking Practice | 100 | 106 | 200 | 2 | 107 | 0.47 | 86.7 | 278257 | 100 |
| Speaking AI | 100 | 106 | 200 | 3 | 107 | 0.45 | 71.2 | 277229 | 100 |
| Speaking Practice | 1000 | 1006 | 200 | 2 | 1007 | 5.4 | 100.4 | 811466 | 1000 |
| Speaking AI | 1000 | 1006 | 200 | 3 | 1007 | 3.1 | 102.1 | 810029 | 1000 |
| Speaking Practice | 10000 | 10006 | 200 | 2 | 10007 | 39.08 | 650.2 | 6148467 | 10000 |
| Speaking AI | 10000 | 10006 | 200 | 3 | 10007 | 39.75 | 649.9 | 6147029 | 10000 |

## Growth and verdict

| surface | corpus | rows read | bytes | prompts rendered | median ms | queries | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Speaking Practice | 100→10000 | 107→10007 (×93.523) | 278257→6148467 (×22.096) | 100→10000 (×100) | 86.7→650.2 (×7.499) | 2→2 | UNBOUNDED |
| Speaking AI | 100→10000 | 107→10007 (×93.523) | 277229→6147029 (×22.173) | 100→10000 (×100) | 71.2→649.9 (×9.128) | 3→3 | UNBOUNDED |
| writing.listActivePrompts / listAllPrompts / listActivePromptsWithResources | n/a | NOT OBSERVED | NOT OBSERVED | NOT OBSERVED | NOT OBSERVED | NOT OBSERVED | NOT OBSERVED — no caller in src/app or src/components, so no request exercises them |

A read is called BOUNDED only when the rows it fetches and the bytes it ships stop growing with
the bank. A factor near the corpus ratio is linear growth, which is what this probe exists to
catch — and why the same walk is run at three sizes rather than one.

## Why this is not fixed by adding a limit

`PracticeStudio` takes `prompts: typeof speakingPrompts.$inferSelect[]` — whole rows — and does
the browsing itself in the browser: `partCounts(prompts)` for the Part step, `groupByTopic()` for
the Topic step, and a client-side search box. Bounding the read to a page would therefore strand
every prompt past the page and make the Part counts wrong, which is precisely the failure the
same file already documents for Live Partner: "the room used to ship the whole bank to the
browser and filter it there, so prompts past the limit could never be found", fixed there by
moving narrowing server-side behind a keyset cursor with `hasMore` / `nextCursor`.

Projecting fewer columns is not a safe substitute either: the panels render `study_support` and
the recorder uses `follow_ups`, so the large fields are the ones in use.

The equivalent fix here is to move Part/Topic grouping server-side and page it the way
`listLivePartnerQuestions` already does. That changes what a learner-facing surface requests and
renders, so it is recorded as OWNER_DECISION_REQUIRED with its measured cost attached rather
than applied inside a measurement probe, and rather than papered over with an arbitrary limit
that would silently hide content. The cost of doing nothing is the table above: at a 10 000-prompt
bank every visit to either page reads the whole bank and ships several megabytes to the browser.

## Slowest statements observed

- Speaking Practice @100: 0.45 ms over 1 call(s), 106 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking Practice @100: 0.02 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking AI @100: 0.42 ms over 1 call(s), 106 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking AI @100: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking Practice @1000: 5.37 ms over 1 call(s), 1006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking Practice @1000: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking AI @1000: 3.06 ms over 1 call(s), 1006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking AI @1000: 0.04 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking Practice @10000: 39.06 ms over 1 call(s), 10006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking Practice @10000: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking AI @10000: 39.7 ms over 1 call(s), 10006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking AI @10000: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `

