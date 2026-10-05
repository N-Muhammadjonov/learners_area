# Data migration scope specification

There is no default scope. An operator must choose exactly one:

| Scope | Manifest value | Includes | Excludes |
|---|---|---|---|
| A — full system | `full-system` | Learners Area site data plus RIWI core/governance according to the closed allowlist | deployment secrets; deleted/expired rows |
| B — RIWI only | `riwi` | approved RIWI knowledge and approved assessment policy/version metadata | users, chats, evaluations, Speaking sessions/transcripts/audio, site content |
| C — Learners Area only | `learners-area` | site users/content/progress/submissions/Speaking state | RIWI knowledge, approved policy intelligence, provider/security intelligence |

The executable allowlist is `src/lib/portability/classification.ts`. Its schema-coverage test fails when a Drizzle table is added without classification. Mode B is portable intelligence, not a database dump. Mode C can run with RIWI intelligence absent; RIWI-dependent surfaces must fail safely. Mode A still excludes environment credentials.

Object choice is independent: `keep-r2` retains authorized keys/configuration (O1); `move-objects` requires byte count and SHA-256 reconciliation before destination references are accepted (O2). Import never resurrects `deleted`, `expired`, `deletedAt` rows.
