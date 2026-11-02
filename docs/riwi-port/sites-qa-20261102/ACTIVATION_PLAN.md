# Activation plan requiring explicit approval where indicated

Target only existing Supabase QA project `bpexpsugmuhwmztacbqd`, Vercel preview
for `arena/learners-area-next`, and owner-private Site
`appgprj_6ae812aa05a48191a4cca62debe8de65`. Production is excluded.

1. Restore supported connectivity to the existing Site source Git server.
   Resume its existing project identity; do not register a duplicate.
2. **Approval required after automatic rejection:** establish and verify a
   recoverable QA backup before any migration. Preserve the one existing user
   and all existing data. Check affected data counts, schema/trigger state and
   migration journal against the 66-entry baseline. If a verified backup cannot
   be obtained, stop before migration. No destructive reset or broad cleanup.
3. Apply the 13 pending repository journal migrations and two platform scripts
   listed in `MIGRATION_REVIEW.json`, with baseline guards and transactional
   execution. Verify final schema, exact journal hashes, RLS/server-only access,
   and preservation of existing data. Do not infer a rollback from migration
   names: use the verified recovery artifact if needed.
4. **Approval required after automatic rejection:** configure preview-scoped
   server access for this private Site only. The proposed seven-day preview
   access credential would be stored only as a Sites secret and never returned
   to browsers, committed, printed or used for production. Native Learners Area
   authentication/authorization remains mandatory. Do not weaken protection
   or create the credential until explicitly authorized.
5. Pin the gateway to the reviewed vocabulary-fix preview, update its truthful
   status only after validation, and publish through the supported Sites source
   helper plus native private save/deploy. Confirm the actual returned URL.
6. Create synthetic `.invalid` test accounts/work only, then verify login,
   student self-scope, assigned-teacher scope, Admin operational-only access,
   Owner centre scope, Writing/Speaking null criteria, vocabulary word sense
   limitations, RIWI conversation isolation and evaluation persistence.
7. Run browser QA when browser access exists. Report failed/unverified flows
   individually. Neither a READY build nor passing mechanical tests satisfies
   semantic model training, independent assessment calibration, or the main
   merge gate.
