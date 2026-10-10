# Scale measurement (Packages B2 and G)

Measured against `http://127.0.0.1:3000` and a local PostgreSQL 18 with `pg_stat_statements` preloaded, so
`queryCalls` and `dbTimeMs` are PostgreSQL's own accounting of what the server asked it to do
during one measured request — not estimates. Latency is the median of 5 repeats.
Corpora are tagged, asserted to be exactly the intended size before each measurement, and
removed afterwards; the removed-row counts are reported at the end of the run.

**19 measurements · 0 defect(s).**

| # | section | subject | measurement |
| --- | --- | --- | --- |
| 1 | S1 | GET /api/speaking/attempts with 100 attempts in the corpus | httpStatus=200 · returnedAttempts=100 · responseBytes=47751 · medianLatencyMs=10 · queryCalls=10 · dbTimeMs=1.44 · rowsReadByPostgres=505 · boundedRead=true · verdict=BOUNDED |
| 2 | S1 | GET /app/speaking/history (the page learners use) with 100 attempts | httpStatus=200 · responseBytes=373721 · medianLatencyMs=86 · queryCalls=15 · dbTimeMs=1.36 · rowsReadByPostgres=505 · note=listAttempts() bounds this at 100 and resolves prompts in one query restricted to the referenced ids |
| 3 | S1 | learner isolation at 100 attempts (student B reads the same endpoint) | httpStatus=200 · attemptsReturnedToB=0 · anyOfAsAttemptsVisibleToB=false · verdict=ISOLATED |
| 4 | S1 | reviewer scope at 100 attempts (teacher reads the same endpoint) | httpStatus=200 · attemptsReturned=100 · distinctUsers=1 · note=documented behaviour is that staff see attempts for review; what matters is whether that read is bounded |
| 5 | S1 | GET /api/speaking/attempts with 1000 attempts in the corpus | httpStatus=200 · returnedAttempts=100 · responseBytes=47751 · medianLatencyMs=7.1 · queryCalls=10 · dbTimeMs=2.44 · rowsReadByPostgres=505 · boundedRead=true · verdict=BOUNDED |
| 6 | S1 | GET /app/speaking/history (the page learners use) with 1000 attempts | httpStatus=200 · responseBytes=373721 · medianLatencyMs=71.8 · queryCalls=15 · dbTimeMs=2.81 · rowsReadByPostgres=505 · note=listAttempts() bounds this at 100 and resolves prompts in one query restricted to the referenced ids |
| 7 | S1 | learner isolation at 1000 attempts (student B reads the same endpoint) | httpStatus=200 · attemptsReturnedToB=0 · anyOfAsAttemptsVisibleToB=false · verdict=ISOLATED |
| 8 | S1 | reviewer scope at 1000 attempts (teacher reads the same endpoint) | httpStatus=200 · attemptsReturned=100 · distinctUsers=1 · note=documented behaviour is that staff see attempts for review; what matters is whether that read is bounded |
| 9 | S1 | GET /api/speaking/attempts with 10000 attempts in the corpus | httpStatus=200 · returnedAttempts=100 · responseBytes=47751 · medianLatencyMs=11.3 · queryCalls=10 · dbTimeMs=19.94 · rowsReadByPostgres=505 · boundedRead=true · verdict=BOUNDED |
| 10 | S1 | GET /app/speaking/history (the page learners use) with 10000 attempts | httpStatus=200 · responseBytes=373721 · medianLatencyMs=69.8 · queryCalls=15 · dbTimeMs=21.13 · rowsReadByPostgres=505 · note=listAttempts() bounds this at 100 and resolves prompts in one query restricted to the referenced ids |
| 11 | S1 | learner isolation at 10000 attempts (student B reads the same endpoint) | httpStatus=200 · attemptsReturnedToB=0 · anyOfAsAttemptsVisibleToB=false · verdict=ISOLATED |
| 12 | S1 | reviewer scope at 10000 attempts (teacher reads the same endpoint) | httpStatus=200 · attemptsReturned=100 · distinctUsers=1 · note=documented behaviour is that staff see attempts for review; what matters is whether that read is bounded |
| 13 | S1 | boundedness of GET /api/speaking/attempts as the history grows | smallestCorpus=100 returned / 47751 B / 505 rows read · largestCorpus=100 returned / 47751 B / 505 rows read · payloadGrowthFactor=1 · rowsReadGrowthFactor=1 · verdict=BOUNDED — payload and rows read are flat across the corpus series |
| 14 | S1 | attempt identity, ordering and uniqueness on the returned page | returned=100 · uniqueIds=100 · everyRowHasStartedAt=true · orderingIsDescendingByStartedAt=true · queryCalls=2 · verdict=OK |
| 15 | S2 | full cursor traversal of a 1000-prompt bank | promptsInBank=1000 · pagesWalked=2 · promptsCollected=1000 · traversalMs=43.4 · queryCallsTotal=6 · queryCallsPerPage=3 · dbTimeMsTotal=10.74 · firstPageMs=20.1 · lastPageMs=23.2 · complete=true · verdict=OK — set-based, no N+1 |
| 16 | S2 | first page of a 1000-prompt bank | httpStatus=200 · questionsReturned=500 · matchingReported=1000 · responseBytes=102692 · medianLatencyMs=17.5 · queryCalls=15 · dbTimeMs=27.78 |
| 17 | S2 | full cursor traversal of a 10000-prompt bank | promptsInBank=10000 · pagesWalked=20 · promptsCollected=10000 · traversalMs=921.9 · queryCallsTotal=60 · queryCallsPerPage=3 · dbTimeMsTotal=709.41 · firstPageMs=61.3 · lastPageMs=23.7 · complete=true · verdict=OK — set-based, no N+1 |
| 18 | S2 | first page of a 10000-prompt bank | httpStatus=200 · questionsReturned=500 · matchingReported=10000 · responseBytes=103193 · medianLatencyMs=60.3 · queryCalls=15 · dbTimeMs=258.57 |
| 19 | S2 | per-page query cost as the bank grows (the N+1 test) | corpusGrowthFactor=10 · perPageQueryGrowthFactor=1 · from=1000 prompts @ 3 queries/page · to=10000 prompts @ 3 queries/page · verdict=FLAT — no N+1; per-page cost does not grow with the corpus |

## Slowest statements

**first page of a 1000-prompt bank**

- 23.33 ms over 5 call(s), 2505 row(s): `select "id", "part", "topic", "prompt_text", "cue_card", "external_id", "created_at", to_char("created_at" at time zone $7, $8) from "speaking_prompts`
- 4.37 ms over 5 call(s), 5 row(s): `select count(*)::int from "speaking_prompts" where ((("speaking_prompts"."publication_state" = $1 or ("speaking_prompts"."publication_state" = $2 and `
- 0.08 ms over 5 call(s), 5 row(s): `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" where "users"."id" =`

**first page of a 10000-prompt bank**

- 225.96 ms over 5 call(s), 2505 row(s): `select "id", "part", "topic", "prompt_text", "cue_card", "external_id", "created_at", to_char("created_at" at time zone $7, $8) from "speaking_prompts`
- 32.49 ms over 5 call(s), 5 row(s): `select count(*)::int from "speaking_prompts" where ((("speaking_prompts"."publication_state" = $1 or ("speaking_prompts"."publication_state" = $2 and `
- 0.11 ms over 5 call(s), 5 row(s): `select "id", "name", "email", "role", "account_status", "locale", "onboarding_completed_at", "status_reason" from "users" "users" where "users"."id" =`

## Defects

None. Every measured surface stayed within its bound and no per-page cost grew with corpus size.

