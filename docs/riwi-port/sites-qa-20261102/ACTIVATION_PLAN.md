# Remaining RIWI acceptance steps

The QA database recovery and guarded migration steps are complete. See
`RECOVERY_AND_ROLLOUT.json` and `MIGRATION_REVIEW.json`.

1. Reconnect the local workspace. Preserve the uncommitted Safari runner,
   ignore entry and offline rehearsal helper when syncing the remote checkpoint.
2. Rerun the fixed Safari API smoke against the pinned protected preview.
   Confirm login/session/targets and the four previously failing Owner APIs.
   Capture actual statuses and safe error codes. Do not infer HTTP success
   solely from successful SQL.
3. Exercise actual RIWI chat and task-evaluation flows with synthetic material.
   Verify persistence, expired/missing sessions, student self-scope, assigned
   teachers, Admin operational-only access and Owner centre scope. Keep current
   authorization rules.
4. Complete browser navigation/rendering QA when direct browser control is
   available. The existing Terminal runner verifies authenticated APIs and is
   not full visual or interactive browser QA.
5. Assess semantic evaluation and independently calibrated quality separately.
   Pattern observations and mechanical passing tests do not establish model
   training or IELTS assessment accuracy. Main merge gate stays closed.
6. If Sites hosting is resumed, retain the existing owner-private project ID,
   restore supported source Git connectivity, and use native private deployment.
   Any separate preview server-access credential still needs explicit approval
   after its earlier rejection. No such credential is needed for the current
   direct Safari verification path, and none has been created.

Production is excluded from all of the above operations.
