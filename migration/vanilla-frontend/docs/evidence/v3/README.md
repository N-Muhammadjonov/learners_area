# V3 evidence provenance

Source code checkpoint a4f72f8e558398e83d2ad268b1485d343eb0cb1e; migration status PARTIAL.

- `build-output.txt`: successful latest source build.
- `unit-results.tap`:142/142, including all58 preserved V2 units.
- `foundation-browser-output.txt`, `foundation-browser-results.json`, `foundation-regression/`: unchanged original27 browser probes rerun on V3;27PASS. Root historical evidence restored afterward.
- `v2-browser-output.txt`, `v2-regression/`: unchanged V2 harness rerun on V3;14PASS. Only current browser outputs/screens/performance copied here; historical V2 evidence restored unchanged.
- `browser-v3-output.txt`, `browser-v3-results.json`:49PASS; includes account and catalogue12-configuration matrices, source states, keyboard, stale imports, real pointer two-tab logout, code-only idle warming and repeated-URL history restoration. Fixtures are synthetic, not live acceptance. No production records/materials used.
- `catalogue-{390,768,1440}-uz-night.png`: opened for source-candidate layout/containment inspection; no original baseline comparison. Focus outline reflects native heading focus. Other screenshots are fixture UI only.
- `navigation-performance.json`, `performance-output.txt`: controlled local30-row synthetic diagnostic;15 samples each at0/50ms added fixture latency. Pending frame DOM is NOT ready content. rAF opportunities are NOT certified pixel paint. No original baseline, real backend/media latency, guarantee or general leak-freedom proof.
- `dependency-audit.json`:5 high dev-only findings after selector-parser override (previous7 incl2moderate). `runtime-dependency-audit.json`:0 runtime npm vulnerabilities; no production npm dependencies. No broad vulnerability-free claim.
- `selector-parser-css-comparison.txt`: current compiled CSS vs isolated source-checkout scratch Tailwind3.4.14 with old selector-parser6.1.4; byte-identical SHA. Override7.1.6 used in delivered lock/build. Scratch dependency copy is deliberately excluded from package; replicate independently if reviewing the override.
- `coverage-summary.json`: conservative V3 ledger output, not an automatically derived completion score.

The source browser harnesses exit nonzero on failed probes; counts were also inspected. Filtered runs overwrite reports: do not mistake a filtered pass for a full suite. Independent finalized-archive npmci/build/unit/browser logs live alongside the ZIP in `deliverables/v3-validation/` with `V3_VALIDATION.txt`; this directory is source-run evidence, not independent archive proof.
