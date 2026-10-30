# Task 11 security validation

Scope: FastAPI API, live session authority, role projections, Telegram exchange,
private media, uploads, AI admission and bounded request handling. All adversarial
requests use synthetic IDs/accounts and isolated databases. No production attack,
manual browser acceptance or paid AI request was performed.

## Reproduced and repaired

| Trigger | Before (c824d9c) | After |
|---|---|---|
| Signing failure during Telegram registration | Account and admission remained committed | Both roll back; no cookie |
| Session epoch changes during membership I/O | Old session could finish Telegram link and receive new cookie | 401, no link or cookie |
| Exact session logs out during membership I/O | Same stale-authority acceptance | 401, no link or cookie |
| Speaking submission wins after delete preview | Submitted attempt deleted, 200 | Submitted attempt survives, 409 |

The exchange now holds the intent row lock through account/admission writes and
one-time consumption. A failed consume raises out of the transaction so writes
roll back. Linking checks the current account epoch and exact-session revocation
after membership I/O, inside the locked write phase. Speaking deletion uses a
conditional owner/status mutation; evaluations are removed only after that
mutation succeeds, in the same transaction. Media cleanup runs outside the DB
lease. Ordinary self-owned draft deletion remains 200; foreign deletion is 403.

## Evidence map

| Property | Evidence |
|---|---|
| Anonymous resource denial | `security_anonymous_probe.py`: all 273 API methods, 0 database calls, 234 x 401 / 23 x 403 / 11 x 400. Only version/logout and three public OAuth redirects succeed. Empty payloads are a guard sweep, not exhaustive fuzzing. |
| Owner all / Teacher assigned / Admin operations / Student self | Existing `browser_staff_monitoring.py`, invoked by the full integration probe: explicit roster links, private assessment/homework/review scopes, removed link denial, owner access and admin/student rejection. |
| Cross-user Writing/Speaking/media isolation | Full integration plus existing private evaluation and media capability tests; student IDs are bound by backend authority and teacher access by `teacher_student_links`. |
| Session freshness/revocation | New actual PostgreSQL membership-gap tests; existing request-scope authority and access-event tests. JWT role claims do not replace live DB authority. |
| CSRF/cookies/headers | Existing HTTP/origin-boundary tests: foreign/null origins rejected, origin proof does not grant a user session, HTTPS cookies retain Secure/HttpOnly/Partitioned behavior and CSP/nosniff. |
| Malicious uploads | Existing extension/signature/size, foreign upload, forged attachment and canonical MIME tests; no new type policy added. |
| AI/provider abuse | Existing admission, shared/per-user budgets, provider URL, size/deadline/output validation and foreign evaluation tests. Model output cannot invoke tools or grant a role. |
| Exhaustion/private storage | Existing request budgets, bounded media streaming, path/range checks and worker capability expiry/revocation tests. |
| Changed-source secrets | Changes contain only explicitly synthetic fixture credentials, no production secrets, new provider credentials or production configuration values. |

Actual PostgreSQL fault/race probe: 16 checks, no external calls. Full backend:
3,100 passed. Full integration: 426 HTTP, 151 decoder, 118 DOM, 8 migration replay
checks; 72 migrations / 127 typed tables. Backend check and diff check pass.
Frontend source is unchanged, so its prior npm/build result is reused explicitly.
The isolated race probe is `tests/security_atomicity_postgres_probe.py`; its DSN
guard requires loopback and a fresh `learners_security_` database.

No migration or production configuration change is required. Deployment is the
already-authorized Task 11 source release. These checks establish specific
defenses and repaired failures, not a claim that the site cannot be compromised.
