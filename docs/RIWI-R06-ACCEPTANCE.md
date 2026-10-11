# R06 continuation and live acceptance

The published base is `5203241429908f66913529ec96b0214bd814da35` on
`arena/01a10bac-learners-area`. The local continuation fixes two reproduced
provider-router defects: cancellation during the awaited request audit could
still send a provider request; a rejected transport was incorrectly classified
as malformed output. Regression tests distinguish cancellation, transport
failure, invalid output and timeout, without leaking private diagnostics.

Current execution results belong in `RIWI-R06-LOCAL-VERIFICATION.json` and its
referenced raw evidence. Historical R04 and publication receipts describe their
original source and are not proof for the changed R06 candidate.

Current status: PARTIAL. One full native round passed (1478 backend, 261 UI,
zero failures/skips, typecheck/lint, 53 R06 HTTP checks and 13 R04 HTTP checks).
The execution connection then closed during the second backend round after
top-level test 724. That partial round is preserved and earns no pass credit.
Safari private-window password login and the RIWI student surface were observed
locally. The remaining student flow and teacher/admin/owner browser checks were
interrupted when Computer Use subsequently returned `Transport closed`.
The first QA cluster/app stopped and its random application database was removed.
The second cluster was subsequently stopped with its exact private identity
verified. The later browser runner was also interrupted; its separate cluster
and exact private Next launcher were stopped and the port listener disappeared.
Cleanup receipts are in `docs/evidence/riwi-r06-browser-interruption/`.
The interrupted browser run has no completed HTTP receipt and receives no pass
credit. Its disposable data are preserved, not represented as a completed
database removal. Current published groups remain 20/34; R06 gets no full-group
credit. Restore actual browser access before resuming the remaining role matrix.

## Local rehearsal

`scripts/qa-riwi-r06-runtime.ts` requires the portability test runner's identified
private native PostgreSQL cluster. It creates and later removes a new random
database, applies the canonical migration chain, uses synthetic identities and
fresh private local storage, and boots Next development mode on loopback.
External providers are disabled and credentials cleared in the app process.
No production build or hosted write is performed.

The HTTP matrix covers all four active roles, private conversation ownership,
foreign/null-origin chat denial, forged provider/role denial, owner-only provider
panels, CSRF delete denial without deletion, expired and suspended cookie replay,
owner demotion with the original cookie, logout cookie clearing, authenticated
private audio and foreign-student denial. Staff are legitimate recording
reviewers. Logout clears the browser cookie; it is not a JWT blacklist.

Optional third argument creates a private, mode-0600 browser readiness file with
disposable login credentials. A manual Safari session may test password login,
RIWI rendering, owner-page denial, refresh, back/forward and logout. Create the
readiness file's `.done` marker after the manual checks to release the app.
The hold expires after 20 minutes and fails unless completion was signalled.
Readiness files, passwords, tokens and PostgreSQL URLs must never be packaged as
evidence. HTTP assertions cannot be labelled actual browser acceptance.

## Exact deployment precondition

Read-only observations are in `RIWI-R06-TARGET-PREFLIGHT.json`: the visible Ready
Preview is `e50a2a944f092c695711792b63dbfcf154739c65`, older than the published
base. Its database/storage isolation and four-role QA identity set are not
verified. Do not mutate it or treat its outcomes as current-source proof.

For live acceptance, identify an authorized isolated deployment/database/private
object store. Record the exact candidate commit, canonical source manifest,
deployment ID/URL, migration journal, secret-free environment fingerprint and
four disposable active QA roles. Configure a registered provider's credentials
server-side; keep secrets out of chat, logs and evidence. Review deployment and
any still-required consequential owner decision before executing it.

## Remaining live matrix

| Check | Evidence required |
|---|---|
| Registered live provider | Execute `safe-grammar-explanation-v1` and `knowledge-untrusted-data-v1` through the owner Provider Lab; preserve normalized DTO, provider/model identity, durations, correlation IDs, secret-free usage and audit. A mock response earns no live-provider credit. |
| Timeout/cancellation | Controlled isolated transport interruption or bounded timeout, no successful result after cancellation, bounded fallback and safe error. Distinguish local fault injection from real-provider execution. |
| Malformed output | Controlled isolated adapter fixture rejects invalid DTO/citations/tool output; capture the applicable source. Do not claim a model returned malformed output unless observed. |
| Fallback | Owner-selected policy and authorized rollout produce the stated internal fallback or unavailable state, with honest provenance. |
| Four-role browser | Real password login for student, teacher, admin and owner, RIWI interaction and correct role surface; English/Uzbek and desktop/mobile acceptance remain scoped to actual observations. |
| Owner-only UI/API | Direct owner page and APIs deny other roles, disclose no owner data; owner sees real provider status. |
| Revocation/replay | Reuse the old signed cookie after isolated DB role demotion/suspension and expiry; privileged operations fail. Provider Lab same-key retry reuses one experiment; conflicting payload rejects without another provider call. |
| CSRF/IDOR | Foreign/null origin and forged authority reject; foreign conversation/recording identifiers disclose no private payload. |
| Back/forward/refresh/logout | Inspect authenticated browser history and refresh for all roles, then logout and repeat; no stale privileged action succeeds or duplicate mutation replays. |
| Private signed URL expiry | Use one disposable private R2/S3 object. Record issuance time, configured TTL and redacted object fingerprint; read before TTL, wait past TTL and verify the same signed URL rejects. A local stream or expired JWT is not signed-URL-expiry proof. |

R06 may become CLOSED only when the mandatory exact-target live/provider/browser
checks have real receipts. Partial local progress adds no full-group credit.
