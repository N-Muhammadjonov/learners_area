# Retention drafts (N14)

**Provenance: AI draft — not human-approved, not official IELTS material.**

75 original reading/recall drafts (15 each for A2, B1, B2, C1, C2) in the strict
100-point measurement structure. Sources are in `src/<LEVEL>.txt`. Build them with:

    node --conditions=react-server --import tsx scripts/build-retention-drafts.ts [--check]

The build checks word ranges with the production `countWords`, checks the structure with
`validateMeasurementStructure`, and runs the `evaluateRecall` checks (full recall ≥ 70, empty = 0).
The receipt goes to `docs/receipts/N14-retention-drafts.json`.

These drafts are **not** imported into any bank, seed or migration, and
`tests/n14-retention-drafts.test.ts` enforces that. Publishing them needs human review and
approval through the admin flow first.
