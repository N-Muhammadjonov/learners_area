# Parallel AI ownership and reconciliation contract

Other AI owns35canonical staff product routes:23Admin,6Owner,6Teacher, from an offline V4 snapshot12308e89f67e573888ef4b23e6d85e005f2c2647. Arena V6 starts at newer V5 68778f85eb862206b22750656ccaea28fc8ac324. No staff route/module/adapter/action/contract was implemented here. `/app/reports` role-sensitive reporting is explicitly Arena Phase2 scope, NOT a staff-product route. No automatic merge or deployment.

- `/app/admin/admissions`
- `/app/admin/content`
- `/app/admin/content/workspace`
- `/app/admin/grammar/:id`
- `/app/admin/grammar`
- `/app/admin/listening/:id`
- `/app/admin/listening/import`
- `/app/admin/listening`
- `/app/admin/materials/:type/:id`
- `/app/admin/materials/:type`
- `/app/admin/materials`
- `/app/admin/people/:id`
- `/app/admin/people`
- `/app/admin/reading/:id`
- `/app/admin/reading/import`
- `/app/admin/reading`
- `/app/admin/reading/retention`
- `/app/admin/reading/retention/staged`
- `/app/admin/roster`
- `/app/admin/video-lessons`
- `/app/admin/writing/:kind/:id`
- `/app/admin/writing/:kind/new`
- `/app/admin/writing`
- `/app/owner/audit`
- `/app/owner/dictionary`
- `/app/owner/integrations`
- `/app/owner`
- `/app/owner/retention`
- `/app/owner/transfer`
- `/app/teacher/live-classes/:id`
- `/app/teacher/live-classes`
- `/app/teacher/speaking`
- `/app/teacher/students/:id`
- `/app/teacher/students`
- `/app/teacher/support`

## Integration, later and manual only

1. Pin both deliverable SHAs and inspect source/route/component ownership. Reconcile against LATEST verified Arena branch, never replace it with the V4 tree. Preserve newer legitimate commits.
2. Three-way review at V4 base, latest Arena, and staff delta. Apply only staff-owned hunks. Never wholesale replace `js/routes.js`, shared adapters, build/converters, native DOM helpers, session/authority/router, shell/profile/search/notifications, CSS/fonts/assets, fixtures/ledgers or package manifests from V4.
3. Preserve V5 session photoPresent/enums/opaque invalidations, own profile, diagnostics, locale mutation/focus/scroll cleanup and stable sidebar; preserve V6 reporting isolation/downloads and independent Dashboard lessons. Arena adds only a backwards-compatible `/app/reports` registry override and separate reporting modules; all staff route mappings are unchanged.
4. Preserve server-derived roles/ownership/revocation, exact roster policy and public attribution, no browser credentials/SQL/grading. Existing report API remains original backend; projections still proposals. Separate server approval required to integrate any proposed adapters.
5. Re-run ALL latest native units and browser baseline plus isolated staff journeys; test role/status/identity changes across reports and staff actions. Independently inspect source/asset/CSS and original rendered/live behavior; fixtures do not authorize production.
6. Record conflicts and rejected V4 rollback hunks. Owner review before any merge/integration; explicit owner approval before production replacement. No backend/provider/DB/DNS/production modifications in this task.
