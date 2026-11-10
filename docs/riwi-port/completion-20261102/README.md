# RIWI completion and training review — 2026-11-02

**The requested full-capability/training condition has not passed. Do not merge this candidate as a completed independent AI.** The Owner has authorized merging after completion and successful validation; that condition remains unsatisfied. No repeated merge permission is required once it is actually satisfied. No main merge or production deployment was performed.

## Answers supported by the evidence

| Question | Finding |
| --- | --- |
| Are the supplied prompts integrated? | All 68 source contracts are composed in the existing registry; 105 stable keys remain registered. The exact global teaching prompt is now included. The new Library upload is identical to the prior extracted source: 3909 lines, 114387 UTF-8 bytes, SHA-256 `7b78fbae566e1b055a6a5406b193c14a11c6f49f28a43fdde02a96443ab5c2fc`. Direct binary download failed; extracted-text verification is recorded honestly. |
| Was a neural language model trained on them? | **No.** No parameter-training run or language-model weight artifact is present in this candidate. Registered prompts, rules, approved policies and generated exercises are not parameter training. The Basebook itself distinguishes deterministic local RIWI from an LLM. |
| Did engineering tests pass? | 3353 backend tests and 36 subtests passed; 2 real TCP/WebSocket tests failed because the host denies socket binding. Frontend: 1270 passed, 11 original-fixture skips. Build and the PostgreSQL probes passed. Overall backend exit is 1. |
| Can it perform every requested task at the requested quality? | **Not established, and two direct semantic counterexamples fail.** Mechanical answer matching, schema/policy enforcement and prompt plumbing must not be promoted into evidence of semantic assessment ability. |

## Fixes made during this request

- Current-main Writing categories now select the actual task contract even when the new optional `task_category` column is null. Grade My Work, normal submission and assignment-linked Writing use canonical stored metadata. Learner essays never select their rubric.
- Grammar activity and productive Vocabulary actions pass their server-derived task identity. Reading/Listening explanation responses identify the contract from the exact stored question revision; official correctness is unchanged.
- Writing feedback with null bands still requires four distinct canonical criteria. Speaking cannot hide missing or duplicate criteria behind a null pronunciation slot. General Training pattern feedback retains four explicitly limited criteria.
- Owner example-count and illustration limits are enforced in the machine validator.
- The Basebook's global teaching text is copied exactly. Source-linked prompt versions advance to v3; other registry entries advance to v2. Historical evaluations are untouched.
- The existing Coach now persists the task-specific rubric version as well as the prompt version. A real SQL/HTTP probe verifies this together with the approved Owner policy scope/version and truthful null bands in independent mode.
- OpenAI, Anthropic and compatible Coach transports are checked against one identical composed contract. No provider call was made.

The before-work checkpoint is `131afaf59c534031d9b8d9fb26b3d395ffd45d17`; the branch remains `feature/riwi-current-main-integration-20261101` / PR #111. No migration was added during this request. Current schema tests use 80 backend/platform migration executions and 154 typed tables. The existing 0075–0079 RIWI suffix and current-main migration history remain intact.

## Actual capability failures

1. **Writing relevance:** an original public-transport response receives the same four heuristic criterion values when the question is changed to online schooling: 5.5 / 6.0 / 5.0 / 5.5. The current local signals do not establish whether the response answers the question.
2. **Vocabulary sense:** with the canonical financial definition of `bank`, the local evaluator accepts “The bank is covered with grass beside the river.” as `correct`. Target-word presence and sentence structure do not verify the intended sense.

These are original diagnostic fixtures, not invented examiner band references. [CAPABILITY_AUDIT.json](CAPABILITY_AUDIT.json) reproduces them and exits 1 while the required capability is absent. The complete registry/version/overlay inventory is in [REGISTRY.json](REGISTRY.json).

## Dataset and training status

The original exercise generator was run again: 336 authored cases, split into training/calibration/validation/final holdout with 84 cases each and no exact or source-family overlap. All 288 mechanical answer-key checks pass, including 72 final-holdout checks. The 48 Writing/Speaking exercises have no fabricated band labels. Templates are shared, so this is **not** an independently validated language benchmark. See [EXERCISE_ACCEPTANCE.json](EXERCISE_ACCEPTANCE.json).

No training result, hyperparameter optimization, calibrated language-model accuracy or parameter count is claimed. NumPy and ONNX Runtime are available for numerical work, but the candidate does not contain a pretrained semantic language model or language-model fine-tuning stack. The older supplied ONNX branch uses synthetic rubric references; its existence does not establish general language understanding or validated IELTS accuracy. It has not been copied in as a shortcut to a passing acceptance claim.

Completing the semantic tasks requires an actual reasoning engine/model and an appropriate independently reviewed evaluation benchmark. Exercise/reference generation can continue within this project; asking the Owner to author all training data is not the proposed solution. A usable local base model and execution resources, or a configured permitted external engine, are absent from this test environment. No external API keys are configured here, and no live inference or paid training was attempted.

Transcript-only pronunciation correctly remains **Not assessed**. This is a permitted Basebook boundary, not a requirement to fabricate a pronunciation score or automatically provision an acoustic model.

## Validation and merge decision

[VALIDATION.json](VALIDATION.json) records commands/results/log hashes. The new real SQL probe passes 14 store checks and 2 HTTP checks; existing domain and Owner-policy probes pass 32+7 and 14+5 checks respectively. No shared database or object store was touched.

The broader [previous release gates](../current-main-integration-20261101/README.md) remain open where applicable: native execution, 271 endpoint provenance differences, unresolved Owner retention/storage/restore decisions and real environment acceptance. The latest merge instruction supplies conditional merge authorization; it does not make failed capability tests pass or select unspecified destructive-data policies.

**Merge recommendation: NO-GO.** The requested training/full-capability threshold has not been reached. The concrete fixes and reproducible failure evidence are kept in the draft PR.
