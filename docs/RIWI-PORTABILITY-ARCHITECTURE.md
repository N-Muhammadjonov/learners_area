# RIWI portability architecture

The runtime RIWI boundary remains under `src/lib/services/riwi`; site authorization is supplied by its capability/scope services and test doubles. Portability lives outside the model/tool registry in `src/lib/portability`. It provides a closed classification, deterministic JSONL, versioned/checksummed manifests, dry-run planning and transaction-bound import. It does **not** add shell, SQL, source-write or migration tools to RIWI.

Flow: canonical migrations → explicit scope → batched rows → JSONL SHA-256 → object manifest → signed manifest hash → verify → dry-run → transactional import → object verification → relationship/regression checks. Provider logical policy may be portable only as approved policy metadata; credentials are supplied by the destination and readiness stays unverified until live-tested.

Core versions are in `types.ts`. Unsupported format/core/contract/policy/Speaking versions fail closed. The package is deterministic for equal inputs and timestamp. Identity mappings are passed explicitly to import; no missing user mapping may broaden a user scope to global.
