# Static forensic inventory

{'VALID INTERNAL': 977, 'TEST': 219, 'DOCS': 163, 'REFERENCE PROVENANCE': 59}

Every recorded line has a category; code excerpts and dev seed passwords are intentionally omitted. Classification is path/context based, with runtime source sampling. It does not prove every occurrence harmless. `mock` includes the legitimate IELTS Mock Test domain; fallback includes defaults and provider degradation; `src/db/seed.ts` is an explicit development CLI and was not run on Preview. No runtime dangerouslySetInnerHTML/TODO/FIXME was found by this sweep. Runtime console.log matches are confined to the development seed CLI. Actual defects fixed are in the main defect ledger, not relabeled as test-only. Full browser failure-path coverage remains pending.
