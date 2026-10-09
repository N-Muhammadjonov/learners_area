import "server-only";
import { z } from "zod";
import { verifyManifest } from "./archive";
import type { PortableManifest } from "./types";
import type { RiwiSiteAdapter } from "@/lib/services/riwi/site-adapter";
import type { RiwiActor } from "@/lib/services/riwi/capabilities";
import { RiwiToolBroker, type RiwiToolContract } from "@/lib/services/riwi/tool-broker";
import { runRiwiRegressionSuite } from "@/lib/services/riwi/golden/fixtures";
import { createHash } from "node:crypto";

/** Post-import regression prerequisite only. It neither imports rows nor
 * activates rollout. The trusted destination adapter must read its real state
 * identity before/after; a supplied SHA or pass flag is never an input.
 */
export async function verifyRiwiPostImport(input: {
  manifest: PortableManifest; adapter: RiwiSiteAdapter; actor: RiwiActor;
  readDestinationFingerprint(): Promise<string>;
}) {
  verifyManifest(input.manifest);
  if (input.manifest.scope === "learners-area") throw new Error("portable_site_only_cannot_activate_riwi");
  const stateBefore = await input.readDestinationFingerprint();
  if (!/^[a-f0-9]{64}$/.test(stateBefore)) throw new Error("portable_destination_identity_required");
  const broker = new RiwiToolBroker(async () => {}, input.adapter);
  const contract: RiwiToolContract = {
    name: "migration.readiness", version: "1", description: "Content-free post-import authority check", capability: "riwi.dictionary.lookup", riskClass: "read-only",
    inputSchema: z.object({}).strict(), outputSchema: z.object({ compatible: z.literal(true) }).strict(), timeoutMs: 1000,
    idempotencyMode: "none", auditMode: "required", externalDataClass: "none", allowedRoles: ["student", "teacher", "admin", "owner"],
    rowScopeResolver: async actor => ({ allowed: true, kind: "self", userIds: [actor.id] }), confirmationRequired: false,
  };
  broker.register(contract, async () => ({ compatible: true }));
  let forbiddenInvoked = false;
  broker.register({ ...contract, name: "migration.denied", allowedRoles: [input.actor.role === "owner" ? "student" : "owner"] }, async () => { forbiddenInvoked = true; return { compatible: true }; });
  const context = { actor: input.actor, correlationId: "portable-post-import" };
  const allowed = await broker.call(contract.name, {}, context);
  const denied = await broker.call("migration.denied", {}, context);
  const unknown = await broker.call("migration.unregistered", {}, context);
  const target = createHash("sha256").update(JSON.stringify([input.manifest.manifestSha256, stateBefore])).digest("hex");
  const regression = runRiwiRegressionSuite(target);
  const stateAfter = await input.readDestinationFingerprint();
  if (stateAfter !== stateBefore || !allowed.ok || denied.ok || denied.code !== "riwi_permission_denied" || unknown.ok || forbiddenInvoked || !regression.passed) {
    throw new Error("portable_post_import_regression_failed");
  }
  return { passed: true as const, destinationFingerprint: stateBefore, manifestSha256: input.manifest.manifestSha256,
    regressionEvidenceHash: regression.evidenceHash, checks: regression.checks, activationPerformed: false as const };
}
