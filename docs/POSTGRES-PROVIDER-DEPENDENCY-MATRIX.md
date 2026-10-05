# PostgreSQL provider dependency matrix

| Dependency | Repository truth | Portability action |
|---|---|---|
| SQL client | `pg` + Drizzle through `DATABASE_URL` | configure destination URL; no Supabase SDK dependency |
| Schema | canonical `drizzle/*.sql` and journal | apply in order; never fake journal |
| UUID | PostgreSQL UUID/default random UUID | verify required extension/function on destination during migration QA |
| JSONB/enums/indexes/FKs/checks | canonical migrations | validate after apply/import |
| advisory transaction locks | used by RIWI idempotency | destination must support PostgreSQL advisory locks |
| RLS/Auth | application server auth; no Supabase Auth API in RIWI path | verify database roles/grants independently |
| backup/PITR | provider operation | owner verifies source/destination capability and receipt |
| pool/TLS | provider configuration | size pool; retain certificate verification |
| object store | Cloudflare R2/S3-compatible, independent | choose O1 or O2 separately |

No claim is made that a destination is ready until canonical migration and real-PostgreSQL QA pass there. Timezone is UTC-aware in schema; collation/locale comparisons must be rehearsed. Sequence/identity state and FK validation are mandatory even though most IDs are UUIDs.
