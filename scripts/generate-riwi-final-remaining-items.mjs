import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ledgerPath = "docs/RIWI-FINAL-REQUIREMENT-LEDGER.jsonl";
const outputPath = "docs/RIWI-FINAL-REMAINING-ITEMS.json";
const baselineRef = process.env.RIWI_BASELINE_REF ?? "a2a0bd0abb4b40ede3c1c0383da46cde4d02a875";
const baseline = execFileSync("git", ["show", `${baselineRef}:${ledgerPath}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const rows = baseline.trim().split("\n").map(JSON.parse);
const open = rows.filter((row) => ["OWNER ACTION REQUIRED", "EXTERNAL REQUIRED"].includes(row.status));

function classify(row) {
  const text = row.requirement_summary.toLowerCase();
  if (text.startsWith("final status:") || text.startsWith("allowed statuses:") || text === "owner action required") return {
    cluster: "L-01", disposition: "LEDGER CLASSIFICATION DEFECT", affected: ["scripts/generate-riwi-final-ledger.mjs"],
    reason: "A status vocabulary/template was classified as an owner decision merely because it contains the label.", codeCanClose: true,
    userDecisionRequired: false, externalInfrastructureRequired: false, evidence: "Regenerated ledger classifies templates as informational/status-schema requirements.",
    closure: "Generator regression test plus exact source mapping; no owner response required.", dependencies: [], risk: "Inflated open count and false claim that hundreds of decisions exist.",
  };
  if (text.includes("30-day") || text.includes("latest-60") || (row.source_prompt === "D" && ["D-00069-2bf33c89d4eb", "D-00074-55a8988e6519", "D-01890-ebe482691268", "D-01892-81fd59b06b5b", "D-01901-2f7aa16a801e", "D-04548-c7147cef98d2", "D-05662-bc41c7bfd3f7"].includes(row.requirement_id))) return {
    cluster: "D-01", disposition: "OWNER DECISION", affected: ["RIWI conversation retention", "docs/RIWI-OWNER-MANUAL.md"], reason: "Destructive conversation retention has no explicit final owner acceptance.",
    codeCanClose: false, userDecisionRequired: true, externalInfrastructureRequired: false, evidence: "Signed/recorded owner selection and boundary tests.", closure: "Owner accepts or replaces the 30-day/latest-60 policy; chosen policy is implemented and tested.", dependencies: [], risk: "Silent deletion policy or unbounded private-data retention.",
  };
  if (text.includes("speaking-data-retention") || text.includes("final retention policy")) return {
    cluster: "D-02", disposition: "OWNER DECISION", affected: ["Speaking audio/transcript retention", "docs/SPEAKING-DATA-RETENTION.md"], reason: "No concrete owner-approved durations and deletion exceptions exist.",
    codeCanClose: false, userDecisionRequired: true, externalInfrastructureRequired: false, evidence: "Recorded owner policy, implementation and expiry/object-cleanup tests.", closure: "Owner selects durations/grace/exceptions; lifecycle is implemented and verified.", dependencies: [], risk: "Private voice/transcript data retained too long or deleted unexpectedly.",
  };
  if (text.includes("listening zip") || text.includes("owner-provided listening")) return {
    cluster: "E-01", disposition: "EXTERNAL ASSET", affected: ["tests/full-listening-package.test.ts", "tests/full-listening-write-db.test.ts"], reason: "The exact original owner Listening package is absent; repository booster.zip is explicitly non-equivalent.",
    codeCanClose: false, userDecisionRequired: false, externalInfrastructureRequired: true, evidence: "Exact source ZIP and two non-skipped passing tests.", closure: "Owner securely supplies the package described by docs/LISTENING-SOURCE-ZIP-CONTRACT.md and both tests pass.", dependencies: ["owner source asset"], risk: "Canonical 40-question source parser/grading remains externally unproven.",
  };
  if (text.includes("no shared preview or production database was contacted")) return {
    cluster: "I-01", disposition: "HISTORICAL FACT", affected: ["prior audit"], reason: "A factual evidence statement was misclassified as an external dependency.", codeCanClose: true,
    userDecisionRequired: false, externalInfrastructureRequired: false, evidence: "Prior forensic report and absence of deployment receipt.", closure: "Classify as historical information, not an open requirement.", dependencies: [], risk: "False open-item count.",
  };
  if (text.includes("replay old owner approval")) return {
    cluster: "T-01", disposition: "LOCAL TEST EVIDENCE", affected: ["owner assessment-policy approval"], reason: "This is an adversarial test requirement, not an owner decision.", codeCanClose: true,
    userDecisionRequired: false, externalInfrastructureRequired: false, evidence: "Stale/modified candidate approval regression passes.", closure: "Focused assessment-policy test proves exact-hash approval and stale rejection.", dependencies: [], risk: "Replayed approval could activate unreviewed policy.",
  };
  if (text.includes("historical evaluations and owner decisions") || text.startsWith("owner action required: a consequential")) return {
    cluster: "L-02", disposition: "SOURCE CONTEXT DEFECT", affected: [row.source_location], reason: "A rationale/status-definition fragment was mistaken for a decision request.", codeCanClose: true,
    userDecisionRequired: false, externalInfrastructureRequired: false, evidence: "Adjacent authoritative lines and implementation/test mapping.", closure: "Regenerate context-aware classification.", dependencies: [], risk: "False owner blocker.",
  };
  if (text.includes("live provider") || text.includes("credentials exist")) return {
    cluster: "E-02", disposition: "EXTERNAL SERVICE", affected: ["RIWI provider adapters", "Preview provider configuration"], reason: "No provider credentials are configured in this workspace.", codeCanClose: false,
    userDecisionRequired: true, externalInfrastructureRequired: true, evidence: "Non-mocked provider receipt from exact deployed SHA, with secret-safe logs.", closure: "Owner authorizes and securely configures a provider; registered fixture succeeds against it.", dependencies: ["Preview deployment", "provider secret configuration"], risk: "Configured adapter may differ from real provider behavior.",
  };
  if (text.includes("preview browser") || text.includes("preview/production") || text.includes("shared preview") || text.includes("preview migrations") || text.includes("preview migration")) return {
    cluster: text.includes("browser") ? "E-03" : "D-03", disposition: text.includes("browser") ? "EXTERNAL ENVIRONMENT" : "OWNER AUTHORIZATION", affected: ["Vercel Preview", "Preview database migration"],
    reason: text.includes("browser") ? "No exact-SHA authenticated Preview browser receipt exists." : "Shared Preview apply is forbidden without explicit owner approval.", codeCanClose: false, userDecisionRequired: true,
    externalInfrastructureRequired: true, evidence: text.includes("browser") ? "Authenticated four-role browser matrix on the exact deployment SHA." : "Explicit approval, pre-state/safety point, migration receipt and post-state checks.",
    closure: text.includes("browser") ? "Deploy exact SHA to isolated Preview and complete role/browser matrix." : "Owner authorizes the precisely identified Preview target and migration operation.", dependencies: ["Preview access", "QA identities"], risk: "Role/UI or deployment-only defects remain unknown; unauthorized shared-environment change.",
  };
  if (text.includes("owner acceptance") || text.includes("owner approval") || text.includes("owner decision") || text.includes("consequential owner") || text.includes("owner input")) return {
    cluster: "D-04", disposition: "OWNER ACCEPTANCE", affected: ["RIWI final acceptance", "assessment-policy workflow"], reason: "The source requires explicit acceptance at a consequential boundary.", codeCanClose: false,
    userDecisionRequired: true, externalInfrastructureRequired: false, evidence: "Owner response tied to exact policy/version and final evidence packet.", closure: "Owner accepts the current policy boundaries and later authorizes or refuses cutover after GO/NO-GO.", dependencies: ["all technical acceptance evidence"], risk: "Policy/cutover represented as accepted without authority.",
  };
  return {
    cluster: "L-02", disposition: "SOURCE FRAGMENT REVIEW", affected: [row.source_location], reason: "Sentence fragmentation removed context and automatic owner-keyword matching overclassified it.", codeCanClose: true,
    userDecisionRequired: false, externalInfrastructureRequired: false, evidence: "Review adjacent authoritative source lines and map to the complete requirement.", closure: "Regenerate requirement units with context-aware classification.", dependencies: [], risk: "Misleading traceability.",
  };
}

const items = open.map((row) => ({
  ledgerId: row.requirement_id, originalSource: row.source_location, exactRequirement: row.requirement_summary, currentClassification: row.status,
  ...classify(row),
}));
const clusters = [...new Set(items.map((item) => item.cluster))].sort().map((id) => ({ id, count: items.filter((item) => item.cluster === id).length, ledgerIds: items.filter((item) => item.cluster === id).map((item) => item.ledgerId) }));
const currentRows = readFileSync(ledgerPath, "utf8").trim().split("\n").map(JSON.parse);
const artifact = { generatedFrom: `${baselineRef}:${ledgerPath}`, ledgerTotal: rows.length, extractedTotal: items.length, statusCounts: Object.fromEntries(["OWNER ACTION REQUIRED", "EXTERNAL REQUIRED"].map((status) => [status, items.filter((item) => item.currentClassification === status).length])), currentReclassificationCounts: currentRows.reduce((all, row) => (all[row.status] = (all[row.status] ?? 0) + 1, all), {}), clusters, items };
writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, extractedTotal: items.length, clusters: clusters.map(({ id, count }) => ({ id, count })) }, null, 2));
