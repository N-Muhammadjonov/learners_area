# V19 — bounded cross-context Review recovery; RESUMABLE PARTIAL

Exact V18 continuation from `febad852119ea4fbfdffd850f9899df45447b0bf` on
`arena/96836bcf-learners-area`. Local=remote and clean before edits. No reset,
restart, rebase, stash, clean, branch switch, merge or backend change. V1–V18 ZIP
bytes pinned in `evidence/v19/historical-archives.json` (23 tracked reference ZIPs,
including accepted V17 FINAL_VERIFIED and V18). Historical failed candidates remain
historical/non-delivery. Final `deliverables/V19_VERIFICATION.json` outside ZIP is
execution authority; this document does not substitute expected counts for receipts.

## Implemented using the existing journal, writer and original renderer
- Bounded, same authenticated-user/test/context-key discovery: at most512 key names,
  eight scoped records and2,000,000 retained characters per scan; each record at
  most1,000,000 characters. Only exact scoped Review values are read/deserialized;
  other key names may be enumerated, never their private values. Overflow is visible,
  not a promise of exhaustive recovery. An explicit Next bounded batch reaches
  later records without increasing per-action limits; concurrent writes may reorder
  key names, so Refresh resets pagination rather than claiming an exhaustive snapshot. Invalid/foreign/oversized records remain
  untouched and are not displayed as answers. No unrelated test/user search.
- No panel in the normal empty case. Storage events invalidate authorized details
  and rebuild bounded hints only; they do not authorize, expose saved answers, send
  mutations, or create completion. No BroadcastChannel or second persistence engine.
- Each record's explicit Check fresh-reads/validates `/api/frontend/session`, existing
  authored state and course progress, repeats canonical state AFTER held progress,
  and validates session again. A submitted canonical UUID, same user/test/attempt,
  available Review and exact server own revisions are required. Stored user IDs,
  titles, test numbers, spellings and browser key names never grant authorization.
- Explicit Adopt repeats all checks under the cooperating-browser recovery Web Lock,
  refuses current-context pending work or an active writer, and copies exact bytes
  into this tab's existing ReviewJournal. It sends NOTHING. A separate existing Retry
  freshly reconciles again, then uses the SAME CheckpointWriter and transport.
- Without Web Locks adoption safely refuses; no fallback promise of serialization.
  With unavailable/cleared storage, closed-tab recovery is not guaranteed. Native
  copy persistence is verified; quota failures retain originals and any written copy.
- One bounded transfer hint per source plus one provenance hint per target. Hints
  contain only scoped key names/SHA256/status, not credentials/material. They deny
  accidental duplicate copies but never authorize access or prove course completion.
  Typed exact owned ACK can mark a copy hint; changed source/answers/attempt/target
  cannot mark it. Existing unresolved retained slot is not overwritten or repurposed.
- Foreign-context source bytes are NEVER removed, including already-complete Review.
  localStorage cannot atomically compare-and-delete another tab's record. A foreign
  owner may still write or an aborted POST may commit. Therefore only the existing
  exact current-context pending record clears on typed ACK. A previously acknowledged
  copy is not offered for automatic replay; current server progress remains authority.
- Visible legacy/invalid canonical mapping isolation explains required server-side
  normalization; no guessed compatibility/import or new API. Existing safe retry remains.

## Validation, failure retention and scope
29 additive units (485 expected =456 preserved+29). New actual-source cases include
real closed page→new page recovery, real competing tabs, held A P1/successful B P2,
late responses after reload/closure/retake/new submitted attempt/authloss, six held
loading/evidence/transcript cases (material is inline in the existing authored DTO,
not an invented transcript endpoint), six held recovery-progress context changes,
nine authority failures/completion outcomes, multiple/malformed/foreign hints,
current-work conflict, storage-event invalidation, legacy isolation and12 keyboard/
wrapping cases:1440×900/768×1024/390×844 ×EN/UZ ×day/night.
Original source is read-only; fixture APIs/synthetic encoded audio are NOT live services.
All456/499/196/14 baseline assertions remain. Separate14 timing probe not added to499.
Initial29PASS3FAIL and31PASS1FAIL reports plus retake/debug outputs are retained.
Checked fixture state initially disabled the editing controls; corrected to unchecked.
Another tab's preserved session-refresh broadcast remounts/re-authorizes the first;
test now causally reenters Review. Retake baseline correctly refused a stale revision;
test waits for A's actual checked-state PUT ACK then B's fresh route read. Competing
UI buttons can be invalidated by real storage events; concurrency probe dispatches
both explicit DOM actions together, then checks only one owned copy and zero POSTs.
A new held-state probe also exposed direct original openActivity bypassing the
busy hydration UI. The existing policy wrapper now checks the existing hub busy
marker for ALL activity entry before canonical hydration, with an additive unit;
no new authority flag/CSP capability. The existing allowlisted hash activity is
deferred only until authentic hydration, checked against the still-current hash;
the owned observer disconnects on pagehide. A held #review URL has its own regression. Initial full-source failure report is retained.
The new-submission probe selects the first of the original five score boxes (strict
locator repair, no score assertion removed). A further unit reproduced a same-body replacement-attempt stale ACK deleting newer
pending bytes (true versus expected false). The existing journal ACK now accepts an
optional exact raw snapshot; current writer and completed-goal retry pass that snapshot.
Changed attempt/whitespace/part/answers cannot clear a newer record. A held browser
replacement-attempt regression exercises the real callback. Copy fences also recheck
view/session disposal after digest awaits; ACK transfer hints share the recovery lock.
No assertion weakened; full exact-package
execution is the delivery gate. A focused concurrency wait hit Chromium CSP
unsafe-eval in Playwright waitForFunction; preserved output, replaced by native
page.evaluate + frame/lock predicates, without relaxing CSP or assertions.

## Status — no promotion
Review frontend PARTIAL, original behavior PARTIAL, fixture only executed supported
cases, live UNVERIFIED. Full/Retry retain code-complete status. Script NOT advanced.
Reading NOT STARTED. Remaining ordinary gates include the comprehensive direct URL/
part-link/rapid Back+Forward/feedback-part/exit-submission matrix; wider held lexical,
material/audio and new-attempt permutations; complete media/focus/scroll/lifecycle
acceptance, and heterogeneous legacy catalogue/sequence normalization boundaries.
The executed two-tab cases are not a universal cross-device atomicity assertion.
Continuous other-tab canonical-attempt invalidation outside an in-flight ownership
check still needs its own frontend closure; storage hints currently invalidate
recovery details, not every previously authorized Review card/transcript. Do not
interpret the tested held-ACK retake denial as continuous revocation acceptance.
The preserved session-refresh policy may remount another tab to the authorized hub;
this is not claimed to preserve an open activity continuously across reauthentication.
Finish ordinary Review gates before Script→MCQ→Map→Choose TWO→Completion→Vocabulary.

No backend, Dictionary, staff, DB, R2/cloud, credentials or production changes.
Direct `authored?vocabulary=1` server exam-policy dependency remains UNVERIFIED and
separate GPT Work; permission preflight is not direct-endpoint security acceptance.
No CAS/exactly-once/abort-rollback/cross-device/codec/Safari/hardware/live guarantees.
Target1–100ms remains unmet; V18 median106.10ms,86.80–224.50,3/10 within target.
V19 diagnostic, if executed, is separately reported without production claims.
Source CSS and25 assets exact; compiled CSS deterministic, not matched rendered parity.
Overall implementation, functional/security and visual/live percentages UNDETERMINED:
no objective whole-product acceptance denominator. No deployment or main merge.
