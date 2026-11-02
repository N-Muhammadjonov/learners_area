# Remaining RIWI acceptance steps

The QA database recovery and guarded migration steps are complete. See
`RECOVERY_AND_ROLLOUT.json` and `MIGRATION_REVIEW.json`.

1. Reconnect Safari. The workspace code, Safari runner, ignore entry and offline
   rehearsal helper are preserved in the latest code-readiness checkpoint.
2. Completed: the Owner's Safari API smoke on preview `761f760` returned 200 for
   public config, login/session/targets and all four previously failing Owner
   APIs. Evidence: `../code-readiness-20261102/SAFARI_SMOKE_PASS.json`.
3. The live chat transport/persistence/refusal/cleanup checks passed, while its
   normal answer was unavailable. Exercise task-evaluation flows and useful
   tutoring with suitable canonical content and a configured reasoning engine.
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
