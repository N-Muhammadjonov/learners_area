# RIWI D-01 — owner-selected chat retention

Owner decision recorded on 2026-10-08:

> so'nggi 30 kunlik barcha xabar saqlanadi 7 kundan ko'proq offline bo'lgan students/usersning chatlari 8-kuni o'chib ketadi

## Implemented behavior

- All RIWI messages within the rolling last 30 × 24 hours remain stored; the 60-message count cap is removed from storage, transcript schemas, and reads.
- Message age is measured from each message's timestamp, rather than refreshed for every old message by a new turn. Exactly 30-day-old messages are retained while their conversation is still active.
- Chats are deleted when authenticated online inactivity is strictly greater than 7 × 24 hours, in the eighth day. This applies to student, teacher, admin, and owner accounts. User accounts, evaluations, and other academic records are outside this rule.
- Authenticated site requests and a visible, connected private-tab heartbeat record online activity. This timestamp is separate from meaningful learning activity. Background/closed tabs do not send presence heartbeats.
- User-row locks serialize the sweep and online updates. A returning user is checked for overdue chat deletion before their online timestamp is refreshed, so missed scheduled runs cannot resurrect expired chats.
- A transaction-scoped advisory lock protects the standalone scheduled sweep. Cleanup removes conversations with cascading child-message deletion, old messages, and expired conversations. Dry-run previews do not mutate data; applied cleanup records counts without private chat text in the audit trail.
- Presence requests expire after 15 seconds and permit later retries even if the transport never settles. Unmount aborts in-flight work and clears timers/listeners.
- English and Uzbek UI copy describes the selected policy.
- External-provider history remains limited to six eligible messages. Removing a storage count cap does not expand the provider's outbound context.
- Portable export filters messages outside the 30-day window and refuses rows without a valid timestamp. Conversation-retention proof from export adapters must also exclude offline owners. Destination adapters and live import/export acceptance are still unresolved project work.

## Rollout and deployment boundary

Migration `0049_riwi_online_activity_baseline.sql` initializes existing users' online clocks because the previous application did not update them. It preserves chats and learning records and gives existing users a seven-day online-inactivity window starting at rollout. It also adds the online-time index. Apply this migration once via its journal before enabling the new cleanup code/job. Its timestamp is greater than every earlier journal timestamp so an already-applied 0045 cannot cause 0049 to be skipped. Existing 0046–0048 timestamps precede 0045 and still require a separate migration-history repair and populated native PostgreSQL proof before deployment. Filename-ordered PGlite fixtures do not prove the Drizzle journal upgrade path.

The existing website branch has its own migration history. Reconcile these histories before integration; do not blindly append this numbered migration to the website branch.

`vercel.json` declares hourly cleanup at `/api/cron/riwi-chat-retention`. This machine endpoint requires a configured bearer `CRON_SECRET` of at least 32 characters. No secret value was generated, printed, or committed. Hourly execution means cleanup on the first successful scheduled run after the threshold, normally within the eighth day; outages may delay physical deletion. An overdue returning user's chats are deleted on their next authenticated request.

No migration was applied to a shared database. No scheduler, Preview, or Production deployment was changed. The deployed scheduler's support for hourly execution, configured secret, actual successful runs, native PostgreSQL concurrency, and browser presence acceptance require external verification. D-01 owner approval does not authorize Production GO.

## Current QA — 2026-10-09

Baseline: `e50a2a944f092c695711792b63dbfcf154739c65` on `arena/01a10bac-learners-area`. The prior manifest-completeness fix is preserved. Current focused tests: 44 passed, 0 failed, 0 skipped. UI tests: 234 passed, 0 failed, 0 skipped. Hung-heartbeat regression reproduced a failure before the deadline fix and passed afterward. These are current-patch results; older workspace test totals are not used as evidence.

Remaining scale work: removing the count cap exposes full transcript/scope reads; pagination and bounded authorization scanning still need separate implementation and scale QA. The offline sweep limits users per statement, but one user's chat count may exceed that limit. Do not treat this implementation as a sustained-load proof.

The unrestricted full-suite run was interrupted during the last Writing files while sharing resources with build/typecheck. Its partial result was 1,213 tests: 1,117 passed, 4 failed, 1 cancelled, 91 skipped. Three failures were local socket `listen EPERM`; one was the provider-lab timeout assertion. This is not full-suite PASS. The affected non-socket files are rerun sequentially, and native Terminal publication requires a fresh full-suite run with bounded test concurrency. Native PostgreSQL checks remain distinct from PGlite.

Sequential recheck of provider-lab and the three interrupted Writing files: 35 passed, 0 failed, 0 skipped. Typecheck, lint, production build and diff check passed. Drizzle metadata check exited successfully, but warned about the pre-existing 0046–0048 journal timestamps; those warnings remain an explicit deployment blocker. New 0049 timestamp ordering is covered by the focused regression test.

## Step-05 follow-up

The 0046–0048 timestamp skip is repaired in the canonical migration runner without changing historical journal entries. See `RIWI-STEP-05-MIGRATION-ORDER-2026-10-09.md`. Shared-target and native PostgreSQL acceptance remain open.
