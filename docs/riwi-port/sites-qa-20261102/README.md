# RIWI QA database repair — 2026-11-02

**QA schema repaired. A fresh authenticated Safari retest is pending. Full RIWI
acceptance, semantic training and the main merge gate remain incomplete.**

The deployment tested by the Owner is `8054d75905e962c390ef2924a143c27f79bb3d7e`
on `arena/learners-area-next`. Its Vercel URL is
https://learners-area-gb825uhb9-learners-area.vercel.app.

## Observed failure

The Owner ran the fixed Safari API smoke checks at 10:37 Asia/Tashkent. Public
config, native password login, the live Owner session and RIWI targets returned
200. Owner diagnostics, assessment policies, knowledge and security signals
returned 503. Vercel logs for all four requests recorded
`schema_missing / UndefinedTableError / 42P01`. The QA database had 66 journal
entries and lacked the corresponding RIWI tables.

## Applied repair

Only Supabase `learners-area-qa` (`bpexpsugmuhwmztacbqd`) was changed.

1. Verified the original 66 migration hashes/timestamps and inspected affected
   rows. Writing language patterns and Live tables targeted by data-rewriting
   statements were empty.
2. Rehearsed recovery and the complete upgrade using isolated PGlite, with a
   synthetic populated Speaking attempt. Existing values were preserved.
3. Created `riwi_qa_recovery_20261102`, a private table-level recovery snapshot
   of 11 affected existing tables/journal. Each copy was restored into a
   short-lived private probe, checked against foreign keys, and compared by row
   count/digest. Source rows were unchanged. No users/credential table was
   copied or exported. This is an affected-table snapshot, not an offsite backup
   of the entire project.
4. Applied the 13 pending Drizzle entries and two platform scripts inside one
   atomic DO statement. Guards require the verified snapshot, the unchanged
   journal, the sole active QA Owner, empty data-rewrite targets and preservation
   of all historical values in affected data tables. Drizzle statement
   breakpoints are executed separately; original source hashes are retained.
5. Confirmed 79 journal entries, 16 RIWI tables with RLS, and no direct SELECT
   access for anon/authenticated roles. Counts remain: one user, one Speaking
   attempt, three evaluations, two video progress rows. Security advisors report
   no ERROR findings; three pre-existing mutable-search-path WARN findings
   remain. No production or main mutation was made.

The earlier broad rollout rejection was addressed with scoped recovery,
restoration rehearsal and strict data-preservation guards. Both subsequent
native database operations succeeded. Exact SQL and sanitized receipts are
tracked with this checkpoint.

## Remaining verification

The local execution environment disconnected after the database checks. A fresh
Safari HTTP result has **not** yet been collected. Rerun the existing Owner-run
`scripts/riwi-safari-smoke.py` on the same preview; never mark the four repaired
routes 200 until the actual results arrive.

The Python Safari runner, its local ignore entry and the offline recovery helper
were subsequently preserved and integrated with current main. See
`../code-readiness-20261102/README.md` for the latest code and test checkpoint.

Sites project `appgprj_6ae812aa05a48191a4cca62debe8de65` is still unpublished
(version 0, no live URL). No seven-day Vercel bypass credential was created.
Current verification uses the Owner's existing Safari/Vercel authentication.

Independent Vocabulary now withholds positive correctness for unverified word
sense. This fixes an unsupported claim; it does not add semantic inference or
prove that RIWI is trained. Main merge remains blocked.
