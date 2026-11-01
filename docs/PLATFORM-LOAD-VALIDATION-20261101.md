# Task 13: isolated capacity validation

Work continues on `arena/controlled-load-20261029`, based on owner main
`2da939fea47b3bb688b99de4a1588cd0966d9518`. New Mock authoring/grading,
Live Classes, Listening and Writing changes stay in place. No production load,
schema, DNS, secrets or resource configuration changes are part of this task.

## Reproduce

Build the existing production Dockerfile, then run:

```sh
docker build -f services/backend/Dockerfile -t learners-area-load:task13 .
python3 scripts/controlled_load.py --image learners-area-load:task13 --output /tmp/learners-load --levels 20
python3 scripts/controlled_load.py --image learners-area-load:task13 --output /tmp/learners-load-200 --levels 200
```

Only progress to 500 and then 1000 after the preceding current-source stage
passes. Runtime source changes must be committed before measurement. Each case
starts a fresh synthetic PostgreSQL database. Baseline application files come
from Task 1 commit `7e916a02ef7be3192f42bfd054fcf432318fbb47` through `git archive`;
main is never checked out for development. The image dependency file must match
current requirements. The exact image ID and source SHA accompany each result.

The internal Docker network has no published ports or external connectivity.
The fixture refuses any database identity other than `db/learners_load`, and
creates no production accounts. Only the run's explicitly named containers and
network are removed. Existing Docker workloads remain untouched.

## Workload and limits

- App: one worker, one CPU, 512 MiB. Database: one CPU, 1 GiB, pool 5,
  max connections 60, shared buffers 128 MiB. These are controlled local caps,
  not a claim about Railway's current quotas.
- Synthetic dataset: 1,000 learner identities, 322,263 dictionary entries,
  50,000 vocabulary rows, 105 Reading materials, 62 Listening materials,
  1,000 independent Writing drafts and Reading attempts. No customer content.
- An injected 5 ms delay per SQL call is a stated sensitivity assumption,
  not measured production network latency.
- 15 s ramp, 15 s warmup, 60 s measured steady traffic. Twenty users have a
  two-second action period; 200/500/1000 users have a ten-second period with
  deterministic 0.7–1.3 jitter. This is concurrent signed-in learner activity,
  not 1,000 simultaneous expensive evaluations.
- Mix: Dashboard 20%, Reading 15%, Listening 15%, Vocabulary 18%, Progress 10%,
  Writing save 10%, Presence 8%, private media range 1%, AI 2%, objective grading
  1%. Already submitted Reading attempts become ordinary Reading navigation.
- Real HTTP, authority checks, SQL, application admission and persisted grading
  are used. The paid provider alone is replaced by a deterministic 100 ms
  transport with band 7, confined to the test wrapper. Paid calls: zero.
- A simultaneous navigation burst and subsequent normal recovery traffic are
  reported separately from the paced traffic.

## Required evidence

Each JSON report includes p50/p95, status distribution, 429/503 reasons, achieved
throughput, pool wait/waiters, active/total backend sessions, HTTP in-flight
requests, CPU, RSS/cgroup memory, provider peak, successful persisted submissions,
lost acknowledged drafts, duplicate AI keys, score correctness and recovery.
Private per-user markers detect cross-user responses; a foreign-draft read must
be denied. Acknowledged draft versions are reconciled against the database.

The current-source sustainable gate requires functional correctness, at most 1%
normal-traffic errors and p95 at most 1,000 ms. Current AI concurrency must stay
at most four and backend connections at most six (pool five plus provider claim).
Critical API p95 changes are compared at equal workload; any increase over 10%
requires investigation before acceptance. Short smoke tests only validate the
runner and functional behavior; they do not certify capacity.

## Repairs identified during validation

Listening catalogue facts used per-material SQL. The replacement batches the
same user's attempts, activity stages, version-selected question counts and
checkpoints. Detail reads and learning state transitions retain their existing
logic. A differential PostgreSQL probe compares the exact current-main output
for own/other learner and teacher contexts, version fallback, malformed legacy
draft shape, completed attempts, legacy runtime checkpoints, NULL timestamp
ordering and growth by sixty materials. All 72 assertions passed; academic
catalogue round trips became 7–8 instead of up to 677 in the growth fixture.

Current-main integration also exposed missing test migration coverage for the
canonical Mock extension, an outdated Admin foreign-class expectation, and
Owner read DTO compatibility gaps. Test databases now include the allowlisted
canonical platform migration; the stricter Admin boundary stays intact. Owner
responses keep the new main fields and add the fields existing frontend readers
require. Retention configuration reads remain read-only.

The campus home hidden-return rule is restored without changing the newer Mock
navigation rules. `wsproto` is declared for the existing Live Classes WebSocket
route. The Mock test's offline dependency fallback must not replace installed
libraries in the full test process.

The HTTP inventory now declares all 308 registered HTTP methods, including the
34 newer Mock/Live Classes methods, without claiming new integration proof for
them. Inventory checks exclude the separately registered WebSocket route.
Migration byte checks retain all original hashes and accept the existing paired
0073 migration. The two-process chat test uses an absolute application import
path. Catalogue unit doubles now distinguish batch queries from material rows.

Before these repairs the complete backend run produced 3,126 passes and 16
failures. Exactly the same sixteen cases on unmodified main `2da939f` produced
fourteen failures and two passes; the two local failures were outdated catalogue
doubles, covered independently by the real PostgreSQL differential probe.
After repair: **3,142 backend tests pass**. Build and backend import checks pass.
Native integration: 427 HTTP, 151 DTO, 118 DOM and eight migration replay checks
pass, using 74 canonical test migrations and 137 typed tables.

Frontend: **1,248 pass, four fail, eleven skip** after hydrating required content
fixtures and restoring the campus home rule. All four remaining failures were
reproduced on exact unmodified main `2da939f` in
`listening-test1-editorial-inventory.test.mjs`: gap-hidden target inventory,
Script-tab bridge source contract, context-review count (22 versus 21), and an
invalid staged sense UUID. These existing editorial/source issues are retained
as unresolved; no lexical IDs, transcript or owner-authored content is rewritten
to force a green suite.

## Actual controlled results

| Case | Steady requests | p50 ms | p95 ms | Errors | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Task 1 baseline, 20 learners | 469 | 1,354.914 | 4,893.599 | 0.0% | latency gate failed |
| Current, 20 learners | 599 | 74.005 | 127.225 | 0.0% | PASS |
| Task 1 baseline, 200 learners | 601 | 20,006.680 | 20,012.802 | 99.334% | overloaded |
| Current, 200 learners | 1,187 | 68.704 | 121.348 | 0.0% | PASS |
| Current, 500 learners | 2,971 | 71.036 | 168.716 | 0.0% | PASS |
| Current, 1,000 learners before Dashboard batch | 5,942 | 634.535 | 956.518 | 7.455% | failed error gate |
| Current, 1,000 learners after Dashboard batch | 5,942 | 70.671 | 211.066 | 0.0% | PASS |

The first 1,000-learner run reached the ordinary-request admission limit while
waiting on the five-connection pool. Dashboard now uses one scoped SQL snapshot
instead of eight round trips. The prior per-widget optional-table fallback stays
available. Another 24 PostgreSQL assertions compare owned/peer histories,
private evaluations, ordered timestamps, streaks and an optional-table outage
against exact main behavior. Only the failed 1,000-learner stage was rerun.

The final 1,000 run achieved 99.033 requests/s: 661 acknowledged draft owners,
175 AI submissions and 86 objective submissions, with zero lost confirmed
writes, duplicate AI keys or incorrect scores. Provider peak was two; backend
connection peak was five. Steady RSS changed from 112,074,752 to 112,209,920
bytes during the measured minute. Normal recovery was 40/40 HTTP 200, p95
45.263 ms. The separate 1,000-request burst returned 865 HTTP 200 and 135 bounded
HTTP 503 responses. No paid providers or production load were used.

All seven critical API p95 values improved in the equivalent 20- and 200-user
baseline comparisons; none regressed by more than 10%. Higher baseline overload
runs were omitted because the baseline already failed at 200. The original
baseline-200 diagnostic error breakdown also includes burst/recovery timeouts;
its steady status counts/error percentage remain separate. The 200 observer
stopped before burst; 500 and both 1,000 runs observe through recovery.

Raw results and limitations: `qa/evidence/controlled-load-20261101.json`.

## Delivery boundary

Local backend capacity evidence does not certify Internet latency, Cloudflare
capacity, real AI provider quotas or mobile/desktop visual acceptance. The owner
performs manual checks. Production delivery and deployment receipts belong to
Task 14 after this task's acceptance results are recorded.
