# V31 — inherited V30 state, evidence-only assessment

No runtime, contract, layout, content, route or component changes. No completion promotion. The inherited V30 statements below remain applicable; V31 outcomes and precise limitations are in V31_PHASE2_RESULTS.md and V31_RESOURCE_ACCEPTANCE.md. Final exact-artifact results are in deliverables/V31_VERIFICATION.json, outside the source-only ZIP by unchanged packaging policy.

# V30 internal ACK delivery fence; backend unchanged

Authored parent checkpoint ACK adds acknowledged=original entry snapshot to the existing internal parent/opaque-child message only. Existing writer, server endpoint/DTOs/validators/authority/journal policy unchanged. Child accepts canonical hydration only if current local data's exact JSON matches acknowledged bytes. Initial fresh authorized hydration unchanged. Newer owned data preserves debounce and pending bytes; no automatic replay or additional mutation. Missing acknowledged field cannot hydrate. Source token/parent checks unchanged.

Review progress ACK != checkpoint ACK. ReviewJournal still requires exact expectedRaw/body and current own canonical context; counts/HTTP200 are not evidence of byte ACK. UI epoch != route lifetime != canonical identity. Existing singleflight/explicit Retry/Adopt/foreign isolation/fresh validation/barriers reused. No exactly-once/CAS/abort rollback/cross-device lock guarantees.

Sandbox allow-scripts only, CSP/SOP unchanged;256KiB Range/8MiB LRU/max2 transports/MSE recovery/Blob fallback preserved. No backend/auth/API/DB/Supabase/R2/Workers/grading changes or live probes. Authored vocabulary backend exam-policy remains separate GPT Work UNVERIFIED; Staff/Dictionary untouched.
