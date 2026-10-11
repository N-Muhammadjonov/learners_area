import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { planSpeakingRetention } from "../src/lib/speaking/retention-plan";

const { values } = parseArgs({ options: {
  snapshot: { type: "string" }, proposal: { type: "string" }, at: { type: "string" }, out: { type: "string" },
}, strict: true, allowPositionals: false });
if (!values.snapshot || !values.proposal || !values.at || !values.out) throw new Error("snapshot, proposal, at and new out path required");
const plan = planSpeakingRetention(JSON.parse(await readFile(values.snapshot, "utf8")),
  JSON.parse(await readFile(values.proposal, "utf8")), new Date(values.at));
await writeFile(values.out, JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ mode: plan.mode, enabled: plan.enabled, ownerPolicyApproved: plan.ownerPolicyApproved,
  attempts: plan.attempts, blocked: plan.blocked, counts: plan.counts, proposalSha256: plan.proposalSha256, snapshotSha256: plan.snapshotSha256 }));
