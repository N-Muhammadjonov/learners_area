import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { AUTHORITATIVE_SOURCES, sha256, verifySource, snapshotSource, parseTestReceipt, assertNewEvidenceOutput } from "./lib/riwi-current-evidence.mjs";

const directory = process.argv[2], output = process.argv[3];
if (!directory || !output) throw new Error("explicit_source_and_output_required");
assertNewEvidenceOutput(output);
const sources = AUTHORITATIVE_SOURCES.map(source => {
  const text = readFileSync(join(directory, `RIWI_SOURCE_${source.id}.txt`), "utf8");
  verifySource(source, text); return { ...source, text };
});
// These narrowly mapped real source requirements have explicit local fixtures.
// The mappings are reviewable declarations, not keyword-based acceptance.
const profiles = [
  { source: "A", exact: "- No owner/admin/provider configuration.", tests: ["tests/riwi-security.test.ts"], implementation: ["src/lib/services/riwi/capabilities.ts", "src/lib/services/riwi/tool-broker.ts"], limit: "Local capability/DTO denial; deployed role sessions and live provider remain unverified." },
  { source: "B", exact: "Raw owner message must NOT immediately become active instruction.", tests: ["tests/assessment-owner-policy.test.ts", "tests/assessment-policy-rollback.test.ts"], implementation: ["src/lib/services/coach/contracts/owner-policy.ts", "src/lib/services/coach/contracts/compose.ts"], limit: "Persisted isolated database lifecycle; production/native concurrent owners and live browser remain unverified." },
  { source: "B", exact: "- owner overlay cannot override hard core;", tests: ["tests/assessment-owner-policy.test.ts", "tests/assessment-policy-rollback.test.ts"], implementation: ["src/lib/services/coach/contracts/owner-policy.ts", "src/lib/services/coach/contracts/core.ts"], limit: "Explicit immutable schema/score/provenance/answer-key fixtures. No acceptance of all book task routes." },
  { source: "C", exact: "10. Do NOT claim pronunciation assessment from transcript-only evidence.", tests: ["tests/speaking-contract-boundaries.test.ts", "tests/speaking-summary-evidence.test.ts"], implementation: ["src/lib/services/coach/contracts/coaching.ts", "src/lib/data/speaking-session-summary.ts"], limit: "Synthetic transcript/evaluation fixtures; no microphone, vendor STT or acoustic-provider proof." },
  { source: "D", exact: "WHAT: Prove MODE C does not contain RIWI intelligence.", tests: ["tests/riwi-portability-v2.test.ts", "tests/riwi-portable-manifest-scope.test.ts"], implementation: ["src/lib/portability/classification.ts", "src/lib/portability/archive.ts"], limit: "Mode-specific manifest/table/privacy canaries; native full-data destination and real object store remain unverified." },
];
for (const p of profiles) {
  const matches = sources.find(s => s.id === p.source).text.split("\n").filter(line => line.trim() === p.exact);
  if (matches.length !== 1) throw new Error(`requirement_mapping_ambiguous:${p.source}:${p.exact}`);
  for (const path of p.implementation) readFileSync(path);
}
const state = snapshotSource(process.cwd());
const receipts = new Map();
for (const p of profiles) {
  const key = p.tests.join("|"); if (receipts.has(key)) continue;
  const args = ["--conditions=react-server", "--import", "tsx", "--test", "--test-reporter=tap", ...p.tests];
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const transcript = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const observed = parseTestReceipt(result.stdout ?? "", result.status);
  const id = sha256(key).slice(0, 12), path = join(dirname(output), `RIWI-BATCH-15-EVIDENCE-${id}.txt`);
  writeFileSync(path, transcript);
  receipts.set(key, { id, command: ["node", ...args].join(" "), artifact: path, artifact_sha256: sha256(transcript), source_state_sha256: state.sha256, ...observed });
}
if (snapshotSource(process.cwd()).sha256 !== state.sha256) throw new Error("source_changed_during_verification");
const rows = [];
for (const source of sources) source.text.split("\n").forEach((text, index) => {
  if (!text.trim()) return;
  const p = profiles.find(p => p.source === source.id && p.exact === text.trim());
  const receipt = p ? receipts.get(p.tests.join("|")) : null;
  rows.push({ id: `${source.id}:${index + 1}:${sha256(text).slice(0, 12)}`, source_file: source.filename, source_line: index + 1, exact_requirement: text, source_sha256: source.sha256, status: receipt?.verified ? "LOCALLY_VERIFIED_SCOPED" : p ? "LOCAL_VERIFICATION_FAILED" : "REVIEW_REQUIRED", implementation: p?.implementation.map(path => ({ path, sha256: sha256(readFileSync(path)) })) ?? [], command: receipt?.command ?? null, observed_result: receipt ? { exit_code: receipt.exit_code, counts: receipt.counts, artifact: receipt.artifact, artifact_sha256: receipt.artifact_sha256 } : null, source_state_sha256: state.sha256, last_verified_git_sha: null, external_evidence: null, limit: p?.limit ?? "Source coverage only; no semantic acceptance inferred. Historical/default/source requirements must be reconciled with latest explicit owner instructions." });
});
writeFileSync(output, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
writeFileSync(join(dirname(output), "RIWI-BATCH-15-EVIDENCE-MANIFEST.json"), JSON.stringify({ input_ref: "arena/riwi-security-final-v2-input", input_commit: "5133e1c48b22fba8460831ae9456b167db53985e", sources: sources.map(({ text, ...source }) => ({ ...source, bytes: Buffer.byteLength(text) })), source_state: state, receipts: [...receipts.values()], counts: { covered_nonempty_lines: rows.length, explicitly_mapped_local_requirements: profiles.length, locally_verified: rows.filter(row => row.status === "LOCALLY_VERIFIED_SCOPED").length, review_required: rows.filter(row => row.status === "REVIEW_REQUIRED").length }, owner_overrides: { authority: "Latest explicit owner instructions in the remaining execution prompt and visible continuation", remaining_prompt_sha256: "daf36b256a990b7fa5379fd121810991bad552f638c776e8d9b55dcb22847979", chat: "All rolling last-30-day messages; no 60-message storage cap; strictly more than seven authenticated offline days", speaking_retention: "Separate, no destructive duration selected", publication: "Six fully accepted original groups minimum; no partial credit", build: "Do not rebuild" }, legacy_ledger: { path: "docs/RIWI-FINAL-REQUIREMENT-LEDGER.jsonl", archival_blob: "8324b9dbfea5f8b98e839a012ab77380ce7ccc52", usable_as_current_acceptance: false }, progress: "Line counts and local mappings give no group completion credit. Git state is the content snapshot, not the old preserved workspace HEAD or a caller-supplied SHA.", deployment: "UNVERIFIED" }, null, 2) + "\n");
console.log(JSON.stringify({ output, rows: rows.length, verified: rows.filter(r => r.status === "LOCALLY_VERIFIED_SCOPED").length, failed: [...receipts.values()].filter(r => !r.verified).length }));
if ([...receipts.values()].some(r => !r.verified)) process.exitCode = 1;
