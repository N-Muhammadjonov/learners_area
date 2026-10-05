# Portable import specification

Apply the repository's canonical Drizzle migrations to an empty compatible PostgreSQL first. Import order is verify manifest/version/scope → verify every table stream checksum/count → dry-run plan → resolve identity/conflicts → one transaction for row mutations → O2 byte checksum and copy → constraints/sequences/indexes → regression.

Dry-run must not call mutation methods. Unsupported future versions, missing/duplicate/unexpected tables, deployment-secret fields, partial files, checksum mismatch, unmapped private scope or conflicts fail closed. A real destination adapter must implement `transaction` so any thrown error rolls back all staged rows. Re-running after rollback must produce the exact intended destination without duplicates. Provider readiness is not imported from a source key.

`importPortableArchive` accepts an explicit identity map. It never converts unmapped user scope into global scope. O1 copies no bytes; O2 verifies exact SHA-256 and length before `copyObject`.
