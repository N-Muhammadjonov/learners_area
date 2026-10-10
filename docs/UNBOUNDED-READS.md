# §10 Unbounded learner-facing reads — measured

`listActivePrompts(channel)` in `src/lib/data/speaking-practice.ts` is `findMany({ where, orderBy })`
with no limit, and both callers hand the whole result to a client component, so every published
prompt is read and serialised into the page on every request. Measured against a running server
and instrumented PostgreSQL with a tagged corpus built and destroyed by this probe.

## Raw measurements

| surface | corpus | published bank | HTTP | queries | rows read | db ms | median ms | bytes | prompts rendered |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Speaking Practice | 100 | 106 | 200 | 2 | 107 | 0.55 | 47.4 | 278897 | 100 |
| Speaking AI | 100 | 106 | 200 | 3 | 107 | 0.71 | 54.6 | 277363 | 100 |
| Speaking Practice | 1000 | 1006 | 200 | 2 | 1007 | 5.88 | 131.2 | 811698 | 1000 |
| Speaking AI | 1000 | 1006 | 200 | 3 | 1007 | 6.16 | 102.7 | 810163 | 1000 |
| Speaking Practice | 10000 | 10006 | 200 | 2 | 10007 | 86.38 | 822.7 | 6148699 | 10000 |
| Speaking AI | 10000 | 10006 | 200 | 3 | 10007 | 51.48 | 586.5 | 6147163 | 10000 |

## Growth and verdict

| surface | corpus | rows read | bytes | prompts rendered | median ms | queries | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Speaking Practice | 100→10000 | 107→10007 (×93.523) | 278897→6148699 (×22.046) | 100→10000 (×100) | 47.4→822.7 (×17.357) | 2→2 | UNBOUNDED |
| Speaking AI | 100→10000 | 107→10007 (×93.523) | 277363→6147163 (×22.163) | 100→10000 (×100) | 54.6→586.5 (×10.742) | 3→3 | UNBOUNDED |
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

- Speaking Practice @100: 0.53 ms over 1 call(s), 106 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking Practice @100: 0.02 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking AI @100: 0.67 ms over 1 call(s), 106 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking AI @100: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking Practice @1000: 5.85 ms over 1 call(s), 1006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking Practice @1000: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking AI @1000: 6.08 ms over 1 call(s), 1006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking AI @1000: 0.07 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking Practice @10000: 86.36 ms over 1 call(s), 10006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking Practice @10000: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking AI @10000: 51.44 ms over 1 call(s), 10006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking AI @10000: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `

