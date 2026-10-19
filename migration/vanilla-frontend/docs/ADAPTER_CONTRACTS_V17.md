# V17 additive contracts — existing engines retained

All V14–V16 authority/barrier/typed ACK/three-record exam recovery/media bounds stay.
Review uses existing POST /api/listening/full/:id/progress {activity:'review',answers}.
One bounded pending intent adds no server lock or exactly-once contract. Existing
CheckpointWriter owns serialization/coalescing/stale suppression/manual retry.
Recovery GET authored-state is authoritative; GET /progress supplies typed status,
including exam. Fresh own reviewAnswers must exactly match every pending revision;
canonical attempt must remain submitted and match, activity must be available.
Fresh reads do NOT provide atomic cross-device CAS. Cancellation is NOT rollback.
The server unit-union contract is idempotent; partial counts cannot identify which
questions committed. No false per-question receipt is manufactured from counts.
New intent cannot overwrite pending work from another attempt. That retained conflict
currently requires explicit reconciliation, not automatic abandoned-work replay.

Lexical: existing GET /api/vocabulary/meaning?sourceId=:test&q=:spelling checks server
product +active-exam permission and returns {status:'unresolved',contextual:null}.
No occurrence spans were provided for these Review selections, therefore NO catalogue
sense matching. Existing WordPopover shows meaning-unchecked, optional own notes and
existing authorized save contract. Session secrets never enter storage/opaque child.
No concurrent Dictionary architecture/migrations/data touched. Mode is presentation,
not authorization. Parent examLock +server permission; stale/aborted responses cannot
open a popup. Only normalized letters/marks/apostrophes/hyphens/spaces <=120 chars.
Raw authored text and selection are unchanged. All cross-frame messages retain exact
source/window/token checks; sandbox allow-scripts ONLY and CSP unchanged.

Single pending JSON record version1 stores public owner/test/attempt identifiers and
own answers, no session cookie/token/keys/transcript/answer key. Malformed/foreign bytes
are not silently deleted. ACK clears only matching latest body. Quota falls back to
existing owned memory warning. Durability and comprehensive recovery remain qualified
by browser storage availability, same-context ownership and pending acceptance gaps.
