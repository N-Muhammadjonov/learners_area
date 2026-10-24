# Adapter contracts V26

V25 contracts remain authoritative and unchanged; see ADAPTER_CONTRACTS_V25.md. No new endpoint, server DTO, identity, grading or persistence engine. Browser URL/storage/focus remain hints, not authority.

## Functional changes
- Existing authored vocabulary modal now temporarily isolates background focus using existing DOM inert semantics, including its opaque iframe. A scope-owned MutationObserver isolates late-added background siblings; it disconnects on close. Focus confinement and isolation are synchronously removed by the existing lexical AbortSignal. Original dialog markup/classes/geometry and caller-controlled current-source focus restoration are unchanged. No delayed focus callback added.
- Existing Review material validator now accepts empty alternative-answer arrays (no extra accepted answers) used by actual catalogue sources. Arrays containing malformed/empty-string entries are still rejected. Original answers/checker/educational HTML are unchanged.
- Absent optional paraphrase/mistakeType presentation fields no longer prevent otherwise valid original Review controls. No field is filled, transformed or generated; original renderer retains its exact behavior, including original authoring omissions. Required answers/evidence/question identity/part/range validation remains intact.

ReviewAuthorityBarrier/source bridge/CheckpointWriter/ReviewJournal/exact-byte ACK/manual Retry/canonical isolation remain the same. Sandbox allow-scripts ONLY, CSP unchanged. Media256KiB chunks/8MiB LRU/max2 transports/MSE/Blob fallback unchanged.

## Remaining independently executable frontend gates
Phase2 exact retaining owner and stability are unresolved. Full15 requested mixed lifecycle combinations, full source-variant12-condition modal/scroll/focus combinations, JS/browser-native timer/RAF and transport/observer ownership attribution beyond CDP/24 modal cycles are not universally closed. Preserve Review PARTIAL; do not use unavailable live access to excuse these implementable gates. Existing404 source cases remain regression coverage, not automatic completion of unexecuted mixed combinations.
## External/source gates
Source10/source25 authoritative time mappings need existing owner-authorized corrections; this frontend does not invent content or timing. Authorized rendered original, live presentation-adapter integration, direct authored?vocabulary=1 backend exam policy (GPT Work), Safari/hardware/real recordings remain UNVERIFIED. No production probing, backend/API/schema/auth/grading/publication/cloud/Staff/Dictionary edits.
