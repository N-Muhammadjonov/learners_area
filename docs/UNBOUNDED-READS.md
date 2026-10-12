# §10 Unbounded learner-facing reads — measured

`listActivePrompts(channel)` in `src/lib/data/speaking-practice.ts` is `findMany({ where, orderBy })`
with no limit, and both callers hand the whole result to a client component, so every published
prompt is read and serialised into the page on every request. Measured against a running server
and instrumented PostgreSQL with a tagged corpus built and destroyed by this probe.

## Raw measurements

| surface | corpus | published bank | HTTP | queries | rows read | db ms | median ms | bytes | prompts rendered |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Speaking Practice | 100 | 106 | 200 | 2 | 107 | 0.51 | 61.4 | 278522 | 100 |
| Speaking AI | 100 | 106 | 200 | 3 | 107 | 0.51 | 53.5 | 277396 | 100 |
| Speaking Practice | 1000 | 1006 | 200 | 2 | 1007 | 3.14 | 92.8 | 811323 | 1000 |
| Speaking AI | 1000 | 1006 | 200 | 3 | 1007 | 3.33 | 96 | 810196 | 1000 |
| Speaking Practice | 10000 | 10006 | 200 | 2 | 10007 | 55.34 | 638.8 | 6148732 | 10000 |
| Speaking AI | 10000 | 10006 | 200 | 3 | 10007 | 85.55 | 656.9 | 6147196 | 10000 |

## Growth and verdict

| surface | corpus | rows read | bytes | prompts rendered | median ms | queries | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Speaking Practice | 100→10000 | 107→10007 (×93.523) | 278522→6148732 (×22.076) | 100→10000 (×100) | 61.4→638.8 (×10.404) | 2→2 | UNBOUNDED |
| Speaking AI | 100→10000 | 107→10007 (×93.523) | 277396→6147196 (×22.16) | 100→10000 (×100) | 53.5→656.9 (×12.279) | 3→3 | UNBOUNDED |
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

- Speaking Practice @100: 0.48 ms over 1 call(s), 106 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking Practice @100: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking AI @100: 0.48 ms over 1 call(s), 106 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking AI @100: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking Practice @1000: 3.12 ms over 1 call(s), 1006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking Practice @1000: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking AI @1000: 3.29 ms over 1 call(s), 1006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking AI @1000: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking Practice @10000: 55.32 ms over 1 call(s), 10006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking Practice @10000: 0.02 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `
- Speaking AI @10000: 85.51 ms over 1 call(s), 10006 rows — `select "id", "part", "category", "prompt_text", "cue_card", "prep_seconds", "answer_seconds", "follow_ups", "study_support", "exte`
- Speaking AI @10000: 0.03 ms over 1 call(s), 1 rows — `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" `

<!-- hand-written:begin — preserved verbatim when this document is regenerated -->

## Correction: the 6.15 MB above is a LOWER BOUND, not the production cost

The table was produced by `scripts/measure-unbounded-reads.mjs`, whose 10 000-prompt fixture
inserts only these columns:

```sql
insert into speaking_prompts (id, part, category, prompt_text, publication_state, is_active, created_at)
```

So every measured row carried the **default empty** `study_support`
(`{vocabularyHtml:"",modelAnswerHtml:"",ideasHtml:"",vocabulary:[]}`) and the default empty
`follow_ups` (`[]`). The 6.15 MB measured above at 10 000 prompts is therefore the cost of the browse
metadata and prompt text **with no study support in the bank at all** — the two largest fields the
section above correctly identifies as "the ones in use" were empty when it was measured.

Composition of that fixture, measured with `pg_column_size` over 10 000 rows:

| column group | bytes at 10 000 rows | per row | share |
| --- | --- | --- | --- |
| `prompt_text` | 1 073 kB | ~107 B | 34% |
| `study_support` **while empty** | 869 kB | ~87 B | **28%** |
| `id`, `part`, `category`, `available_in`, `publication_state`, `created_at`, `is_active`, `source_class` | 713 kB | ~71 B | 23% |
| `follow_ups` **while empty** | 49 kB | ~5 B | 2% |
| whole row | 3 135 kB | ~314 B | 100% |

Two things follow, and they point in opposite directions:

- **28% of every row is an empty skeleton carrying no information.** That is 869 kB shipped to the
  browser for nothing at 10 000 prompts, before a single model answer exists.
- **The remaining 72% is what a populated bank adds to.** Real study support is prose HTML —
  vocabulary, a model answer, ideas — so the production payload is the 6.15 MB above *plus* roughly
  the per-prompt study-support size times 10 000. The recorded figure understates the cost of doing
  nothing.

**No populated figure is quoted here, deliberately.** To estimate one I inserted 10 000 rows with a
synthetic filler of a known byte size, and the result is not usable: filler of 2 048 B per prompt
stored *smaller* than filler of 512 B per prompt (1 172 kB versus 5 898 kB across 10 000 rows),
because repetitive text crosses the TOAST threshold and compresses roughly 17×, while prose HTML
would not. Any number derived from it would be a fabricated benchmark. The real magnitude needs the
owner's canonical speaking bank, which is an owner-asset blocker and is not invented here.

What this changes for the decision, not the decision itself. The option already recorded as
OWNER_DECISION_REQUIRED — move Part/Topic grouping server-side behind a keyset cursor the way
`listLivePartnerQuestions` does — now has a second, smaller variant worth pricing alongside it:

1. **Page the bank server-side** (as recorded above). Bounded regardless of how large study support
   grows. Changes what the Part/Topic steps request and render.
2. **Ship browse columns only, and fetch `study_support` / `follow_ups` / `cue_card` when a question
   is selected.** Keeps the current client-side browsing and search intact, removes the 28%-empty
   skeleton and the heavy per-prompt fields from the initial payload, and makes the payload grow with
   the number of *questions listed* rather than the weight of every question's study material. The
   cost is a fetch and a loading state at selection time, which is a learner-visible change to a
   protected surface — so it is the owner's call, not a measurement probe's.

Neither is applied here. The status stays `OWNER_DECISION_REQUIRED`, now with the correction that the
previously recorded cost was measured against an empty study-support bank and is a floor.

<!-- hand-written:end -->
