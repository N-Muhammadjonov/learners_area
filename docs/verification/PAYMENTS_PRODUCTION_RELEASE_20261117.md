# Payment and prepaid production release

Verified 2026-11-17, Asia/Tashkent. [PR #203](https://github.com/N-Muhammadjonov/learners_area/pull/203)
merged as `636358677a88aeaaa7e62716e944a2b71d1fc096`. Railway deployment
`0282bb51-6892-49bb-85bd-75fdbbafa60b` is SUCCESS, with one running replica,
verified database TLS and a successful `/readyz` healthcheck.

The prior gate covered only the installed Academy foundation, and its runtime
image omitted the two feature migrators. The new explicit `--scope payments`
gate ran before the new web process and applied both feature migrations in one
transaction at `2026-11-16T20:24:55.805796Z`.

| Check | Observed result |
|---|---|
| Fresh encrypted R2 backup | 66,948,227 bytes; AES-256-GCM; download checksum verified |
| Backup SHA-256 | `949ccd6df47e1c9deb77612a032d1e71d7b94fa6abfb70edb25e1b799323b986` |
| Backup schemas | `public`, `drizzle`, `la_academy_migrations` |
| Isolated PostgreSQL restore and feature rehearsal | Passed; 242 source tables and 992 source constraints captured |
| Production migration checksums | Both match the checked-in native SQL |
| Existing foundation | 17 migrations retained, 12 finance accounts |
| New feature boundary | 6 RLS tables, 0 direct API table/trigger grants, 0 API-role access to the private feature-journal schemas |
| Historical production records | 9 users retained; cash/journal rows remain 0; no test transactions inserted |
| Finance invariant | 0 unbalanced journal entries |

The ciphertext and its sanitized rehearsal manifest remain in the existing private
`learners-area` bucket. The full object key and hashes are in the
[machine-readable receipt](PAYMENTS_PRODUCTION_RELEASE_20261117.json). The key
value is absent from the receipt and repository. The archive covers application
schemas, not platform Auth/Storage/Vault, role passwords, media bytes or complete
disaster-recovery RPO/RTO acceptance.

`SELF_SERVICE_PAYMENTS_ENABLED`, `PREPAID_BILLING_ENABLED` and
`ACADEMY_ASSISTANT_ENABLED` were set to `1` for this deployment;
`PAYMENTS_RETURN_ORIGIN` is `https://learnersarea.uz`. Payment methods remain
unavailable because real merchant credentials and verification flags are absent.
The Academy assistant retains deterministic read/draft operation; external model
verification was not enabled. No calendar scheduler, production sample policy,
payment or message was created. Amount and duration remain editable operator
inputs; 200000 UZS / 7 days is only an example.

[Full CI 43947518306](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43947518306)
passed at `bdcfe282646a5720ab7a72c8fca9ca256f830d2d`: 7604 backend tests,
287 subtests, 1833 frontend passes, 11 unchanged external-fixture skips, migration
contracts, native PostgreSQL 17 recovery, browser role journeys and motion parity.
Parent Connect also passed. The native tests retain existing cash across restore,
reject corrupt downloads/failed rehearsal, and roll back both migrations when the
second fails. The Docker COPY formatting issue found in the first CI run was
corrected; the final run has no failures.

Supabase security advisory output contains only informational no-policy findings
for private backend-managed tables. Direct API exposure was checked separately.
Cloudflare rejected this environment's unauthenticated automated public probe
with 403/code 1010; WAF settings were preserved. Railway's internal readiness
passed. Human browser/audio and external merchant acceptance remain distinct
from these server-side checks and are tracked only in the
[canonical actions](../SALE_READY_MANUAL_ACTIONS.md).

Rollback disables new purchases/module flags and preserves all financial history.
Corrections use additive migrations and domain reversals; the release gate does
not restore over production or delete records.
