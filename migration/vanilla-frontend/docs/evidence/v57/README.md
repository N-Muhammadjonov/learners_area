# V57 current-main staff parity corrections (staged)

Reference `main` b62b78f (read-only). Target Arena at latest HEAD, not pinned.

- Full-mock band and catalogue progress now follow `src/lib/progress/mock-summary.ts` (only completed `skill=full`, valid stored band, tie-break by id, historic removed test does not count as live catalogue). Individual skill cards retain their own records separately.
- People mock DTO now accepts `skill='full'` and `mockTestId=null` for historical records.
- Owner-only permanent Retention deletion uses confirmed `DELETE /api/admin/retention/texts/:id` with `{expectedLabel}`. 409 means active learner is blocking deletion; no auto-retry. Current source bilingual confirmation strings are bundled because Arena's older extracted dictionaries lack them.
- Content Workspace has canonical `academic` filter while displaying the localized Listening Academic label; adds deletion entry for eleven source-supported types.
- Material deletion type allowlist follows current main's `ContentWorkspace` owner type mapping.
- `staff-v57.test.mjs` adds targeted pure and transport tests. Historical `slice1-people.test.mjs` full-mock expectations aligned to current main.

Still blocked: `/api/frontend/staff/*` role-scoped GET DTO endpoints not live-verified; full Arena build and browser regression not run here. Treat as candidate only. `main`, database and backend unchanged.
