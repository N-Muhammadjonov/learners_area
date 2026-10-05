# Migration integrity validation

For each mode record final SHA, source/destination fingerprints, manifest hash, exact per-table counts/hashes, object counts/bytes/hashes, FK/constraint validation, identity mapping, soft-delete/revocation/supersession/tombstone result, and canonical regression outputs. Check max timestamps and representative relationships, not counts alone. Scan archive for deployment-secret and mode-specific canaries. Test manifest/table/object tampering, truncated archive, >1,000 rows, injected mid-import failure and clean retry. A skipped check is not PASS.
