# V31 non-destructive V29 → V30 archive composition audit

Read-only machine evidence: `evidence/v31/archive-size-audit.json`; reproducible with `scripts/archive-audit-v31.py`. Every outer member's compressed/uncompressed size and SHA256 is recorded, along with added/changed/removed paths. Both archives pass CRC. Baseline V30 independently matched EVERY member to its pinned source/seal Git bytes before V31 execution.

V29: 45,977,248 bytes, SHA256 `638edc56ae85150ca7995f4dd7cf3da186d0611277841234229b761441e4ff80`.
V30: 98,858,509 bytes, SHA256 `160d800a7680839ff8303f0dceed079ae7ce66ebf510dd080a118adac2536878`.
Exact increase: **52,881,261 bytes**.

## Composition (compressed payload bytes)

| Category | V29 | V30 | Delta |
|---|---:|---:|---:|
| Migration source/tooling/documentation, including generated manifest/hash metadata | 1,696,882 | 1,737,865 | 40,983 |
| Required 25 static assets | 6,789,006 | 6,789,006 | 0 |
| Historical evidence, excluding duplicate checkpoint bodies | 37,184,188 | 37,372,031 | 187,843 |
| Historical checkpoint ZIP bodies in preservation evidence | 0 | 52,632,221 | 52,632,221 |
| Generated build files | 0 | 0 | 0 |
| Separate deliverables validation/verification reports | 0 | 0 | 0 |
| ZIP member/central-directory headers and container overhead | 307,172 | 327,386 | 20,214 |
| **Total** | **45,977,248** | **98,858,509** | **52,881,261** |

609→627 source/tooling/documentation members; 25→25 assets; 1,275→1,353 other evidence; 0→4 nested checkpoint bodies. Total 1,909→2,009 members. Every member is assigned exactly once; no residual unexplained bytes. Set reconciliation:100 added members compressed52,851,323;9 changed members net compressed+9,724;0 removed; headers+20,214 =52,881,261.

## Actual dominant contributors

The four bodies under `docs/evidence/v30/resume-preservation/files/<sha256>` are byte-identical to retained archives, not new application data:

| Original retained archive | Compressed bytes of duplicate body in V30 |
|---|---:|
| PARTIAL | 9,389,374 |
| CHECKPOINT V2 | 10,070,766 |
| CHECKPOINT V3 | 13,936,120 |
| CHECKPOINT V4 | 19,235,961 |
| **Total** | **52,632,221** |

These explain all but249,040 bytes of the increase. Their original body sizes total52,692,197 bytes. They were safely preserved during V30 resume handling because that lookup omitted deliverables. The V31 resume lookup explicitly includes deliverables: all359 unexpected restored files were preserved outside the repository and mapped back to existing byte-identical files, with a reference-only manifest. **No new duplicate archive bodies were introduced for V31.**

Important provenance correction: neither V29 nor V30 source ZIP contains direct `deliverables/` entries. **The V29 ZIP itself is not nested in V30.** It remains retained in the repository, along with all checkpoint ZIPs/sidecars. Excluding deliverables was already the packager policy, not a V31 retention change. V31's new packaging entry point retains exactly the existing exclusion, compression, timestamp, permissions, ordering, manifest and hash semantics, changing only target/version labels.

## Sensitive-data boundary

No .env/private-key/database dump/original-audio extension candidates or known private-key/AWS/GitHub-token signature hits were found in the two outer archives or any of the four nested known archives. Nested CRCs and retained-original SHA identities passed; nested member counts are91/259/318/192 (by the JSON's archive order), with no sensitive-extension/library-path candidates or credential-pattern hits. Required25 public asset hashes are independently pinned; the public brand video is not an original educational recording. Synthetic encoded audio remains test fixture code, not captured original audio. Original educational corpus/recordings are not imported into migration source; original mappings/content remain read-only and are checked by the final preservation manifest.

This is filename/signature screening plus full Git provenance and known-archive identity, **not a universal secret detector**. All raw candidate results and exact member identities are retained. No newly discovered protected content, credentials, database or private learner data is demonstrated. No source corpus, audio or private library was copied for V31.

## Remedy and retention decision

Retain all history unchanged, including the four duplicated bodies. No deduplication, deletion, hidden exclusions or changed verification identities are implemented. A future explicitly approved lossless content-addressed/reference packaging format could avoid repeated bodies, but must preserve each historical SHA, provide independent complete reconstruction and define retention compatibility before use. V31 cannot unilaterally make that policy change. Reference-only handling already prevents V31 resume work from adding another duplicate set, without changing any historical checkpoint.
