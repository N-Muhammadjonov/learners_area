# Portable export specification

Output is a private directory/archive with `manifest.json`, `tables/<allowlisted-table>.jsonl`, and optional object bytes. Rows are emitted in bounded batches; there is no fixed 1,000-row cap. Each table records exact row count, bytes and SHA-256. The manifest records scope, object mode, source fingerprint, RIWI/schema versions, creation time and its own canonical hash.

Required operator inputs: explicit mode A/B/C, O1/O2, source DB fingerprint, private destination, and—only for O2—approved source/destination object adapters. Use a restrictive umask (`077`), encrypted volume/archive, no Git working tree, and delete temporary plaintext after verified transfer. `src/lib/portability/encryption.ts` provides streaming AES-256-GCM file envelopes; the 32-byte key is supplied out-of-band and never embedded. Authentication failure rejects decryption. Never log rows.

Library API: `exportPortableArchive` in `src/lib/portability/archive.ts`. The migration operator must bind its streaming source/sink adapters. Repeatable proof command: `node --conditions=react-server --import tsx --test tests/riwi-portability-v2.test.ts`.
