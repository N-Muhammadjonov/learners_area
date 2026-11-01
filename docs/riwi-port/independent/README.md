# RIWI continuation from Checkpoint 5

Baseline: `bf7319a3418e918a84d50fd2c451e32e4b687015`.

This work starts directly from that commit. It does not import a bundle, repeat
the recovery cherry-pick, merge into main, or deploy to production.

## Branch history observed

The connected GitHub API reported integration branch
`feature/riwi-fastapi-integration-20261029` at
`b6434d1afa9ff3cfa8d53598f83b2cc34576f65c`, ten commits after the requested
baseline. Those commits advertise Phases B–J, an ONNX evaluator and synthetic
benchmark results. They were **not adopted or independently certified here**.
This continuation uses a separate branch rooted at the requested SHA and leaves
that newer integration history intact.

## Phase B: architecture and provenance

The imported FastAPI app registers 304 `/api/` method/path pairs, including 31
RIWI pairs. Registration establishes the presence of routes, not business parity.

The baseline Writing evaluator computes surface heuristics and does not use the
task prompt to establish relevance. Speaking evaluates transcript patterns and
optional duration, without pronunciation inference. The existing gateway, role
checks, broker and provider router remain the application authorization layer.

`ENDPOINT_PROVENANCE_REVIEW.json` retains all 271 shared endpoint metadata
differences as unresolved. It links each previous source/status and imported
claim, with a runtime registration check. No live database or differential
business-behavior evidence was produced for those endpoints. The original
Checkpoint 5 evidence and `PORT_STATUS.json` are unchanged.

## Phase C: independent evaluation feasibility

`FEASIBILITY_PHASE_C.json` records the actual host and available dependencies.
Host RAM measurement was unavailable under the sandbox permissions. Host
measurements do not establish deployment resource limits.

Objective answer-key checks, bounded pattern feedback and PCM energy telemetry
work locally without new dependencies. Independent IELTS band quality, semantic
relevance, local neural model weights and phoneme analysis are not established.
No model was trained and no subjective band-accuracy number is claimed.

## Phase D: Owner Basebook integration framework

The Owner Basebook remains `awaiting_owner_basebook`.

Intake preserves an exact source copy and SHA-256, version, requirement IDs,
source line ranges, contract links and implementation/test receipts. Explicit
`[RIWI-REQ-<id>]` paragraphs can link `[contract:<key>]`. Unstructured text and
unlinked requirements remain unmapped and require review. Unknown contracts,
duplicate IDs, missing receipts and invalid UTF-8 are rejected.

Evidence links cannot activate a requirement or replace the existing Owner
approval workflow. File references alone are not proof of completed acceptance.

## Phase E: original exercises and datasets

`EXERCISES_AND_EVALUATION_DATASET.jsonl` contains 336 original synthetic cases
across Reading, Listening, Grammar capitalization, Vocabulary contextual
retrieval, Writing and Speaking. Twenty-four source families are assigned to
four splits before expanding answer variants, with 84 cases per split.

Writing and Speaking are unlabelled practice prompts. Objective labels follow
the authored facts and accepted answers. Listening examples contain scripts,
not human speech recordings. Shared templates are disclosed, so this dataset
does not establish independent language competence or IELTS scoring accuracy.

Handwritten reference and adversarial tests live separately from the generator.

## Phase F: local implementation

`app/riwi_evaluation/independent.py` implements bounded objective matching and
subjective pattern feedback with no numeric band estimate. It handles General
Training letters through an explicit library argument without Academic Task 1
overview/data penalties. Semantic quality and calibrated confidence remain
unverified. The library objective matcher requires a trusted server-side key;
it is not an API that accepts a learner-supplied answer key.

The existing Coach evaluation path can opt in through the server variable
`RIWI_EVALUATION_MODE=independent-v1`. This branch does not set the variable on
any host. In that mode the resolver bypasses external provider configuration and
transport for every evaluation kind, validates the existing response schema, and
stores null Writing/Speaking bands with explicit unvalidated-pattern provenance.
Grammar/Vocabulary retain their existing pattern-based verdicts. Default behavior remains the
existing path. Existing records are not rewritten.

`audio.py` measures bounded 16-bit PCM WAV energy and inactive intervals. Noise
and silence can affect it. It does not identify speech, transcribe audio or
score pronunciation. Audio telemetry is an offline library and has not been
connected to the upload path.

## Phase G: external comparison framework

Training/calibration cases can produce allowlisted, redacted comparison payloads
through the existing outbound guard. Candidate receipts retain provider/model,
input and response hashes, and an unverified-label status. Validation and final
holdout cases are rejected from this path.

The selection gate uses validation metrics on the same dataset and sample
count, rejects regressions and safety failures, and requires Basebook review.
Subjective candidates also require independent reference validation. Final
holdout is not used for repeated candidate selection. No candidate automatically
activates. No external provider calls or training runs were performed here.

## Phases H–J: checks and remaining gates

The offline runner checked 72 generated objective holdout cases under a scoped
Python socket guard. It matched 72 references. That checks the answer matcher
on synthetic examples, not general IELTS accuracy. The guard is not a claim of
OS-level network isolation. Subjective MAE, RMSE and agreement remain null.

The relevant RIWI and Coach regression suites passed 83 tests, including 23 new
independent tests. `TEST_RESULTS.xml` contains the machine-readable receipt.
Tests verify existing role/gateway behavior, split integrity, input limits,
Basebook traceability, redaction, no provider fallback in Mode B, PCM bounds and
absence of invented subjective or pronunciation bands.

Remaining gates: per-endpoint behavior/DB evidence for 271 metadata changes,
actual Owner Basebook mapping and review, independent subjective reference data,
target-host resource measurements and live provider comparison if later
authorized/configured. This is not a production-readiness certification.

## Reproduce

Use a Python environment containing the repository's backend development
dependencies. From the repository root:

```sh
python scripts/riwi_independent_audit.py
python -m unittest discover -s services/backend/tests -p test_riwi_independent_evidence.py -v
python -m pytest services/backend/tests/test_riwi_independent_coach.py -q
```

When the Owner supplies the Basebook, use a new output directory to keep this
checkpoint's reports intact:

```sh
python scripts/riwi_independent_audit.py \
  --basebook /absolute/path/owner-basebook.txt \
  --basebook-version owner-v1 \
  --output /absolute/path/new-review-directory
```
