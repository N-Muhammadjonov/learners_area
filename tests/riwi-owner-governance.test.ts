import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { auditLog, riwiKnowledgeConflicts, riwiKnowledgeSources, users } from "../src/db/schema";
import { createTestDatabase } from "./support/pglite";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";
import { breadcrumbsFor, parentFor } from "../src/lib/nav/routes";
import { knowledgeErrorResponse } from "../src/lib/services/riwi/owner-route";
import {
  KnowledgeServiceError,
  approveKnowledgeCandidate,
  createKnowledgeCandidate,
  listKnowledgeConflicts,
  promoteKnowledgeSource,
  rejectKnowledgeCandidate,
  resolveKnowledgeConflict,
} from "../src/lib/services/riwi/knowledge";

const ownerActor = (id: string) => ({ id, role: "owner" as const, accountStatus: "active" as const });

test("knowledge owner route maps overlap-scan overflow to a safe HTTP 409 response", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("src/app/api/riwi/owner/knowledge/route.ts", "utf8");
  assert.match(route, /error instanceof KnowledgeServiceError\) return knowledgeErrorResponse\(error\)/,
    "the actual owner route delegates knowledge-service failures to the tested HTTP mapper");

  const response = knowledgeErrorResponse(new KnowledgeServiceError("analysis_capacity_exceeded"));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: { code: "riwi_knowledge_analysis_capacity_exceeded" },
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

async function source(database: Awaited<ReturnType<typeof createTestDatabase>>, actor: ReturnType<typeof ownerActor>, title: string, content: string) {
  return createKnowledgeCandidate({
    actor, sourceType: "grammar_material", title, provenance: "Owner-authored governance test",
    rightsClass: "owner_authored", scope: { kind: "global" }, content,
  }, database.db);
}

test("owner rejection closes every open conflict, is audited, and never changes the active source", async () => {
  const database = await createTestDatabase();
  const ownerId = randomUUID();
  await database.db.insert(users).values({ id: ownerId, name: "Governance owner", role: "owner", accountStatus: "active" });
  const actor = ownerActor(ownerId);
  try {
    const active = await source(database, actor, "Present perfect active", "## Form\n\nThe present perfect uses have or has with a past participle.\n\n## Meaning\n\nThe present perfect expresses a past experience connected to the present.");
    await approveKnowledgeCandidate({ actor, sourceId: active.id }, database.db);
    await promoteKnowledgeSource({ actor, sourceId: active.id, regressionFixtureId: "retrieval-active-scope-only-v1" }, database.db);

    const candidate = await source(database, actor, "Present perfect candidate", "## Form\n\nThe present perfect uses have or has with a past participle form.\n\n## Meaning\n\nThe present perfect describes a past experience connected to the present.");
    const conflicts = await listKnowledgeConflicts(actor, candidate.id, database.db);
    assert.ok(conflicts.length > 1, "fixture creates multiple independent overlap rows");
    await rejectKnowledgeCandidate({ actor, sourceId: candidate.id, reason: "Owner reviewed; contact learner@example.test only if the old source is missing." }, database.db);

    const storedCandidate = await database.db.query.riwiKnowledgeSources.findFirst({ where: eq(riwiKnowledgeSources.id, candidate.id) });
    const storedActive = await database.db.query.riwiKnowledgeSources.findFirst({ where: eq(riwiKnowledgeSources.id, active.id) });
    assert.equal(storedCandidate?.state, "rejected");
    assert.equal(storedActive?.state, "active");
    const storedConflicts = await database.db.select().from(riwiKnowledgeConflicts).where(eq(riwiKnowledgeConflicts.candidateSourceId, candidate.id));
    assert.ok(storedConflicts.length > 1);
    assert.ok(storedConflicts.every((conflict) => conflict.state === "rejected"), "no dangling open conflicts remain");
    assert.ok(storedConflicts.every((conflict) => !conflict.resolutionNote?.includes("learner@example.test")), "audit notes redact contact data");

    const rejection = await database.db.select().from(auditLog).where(eq(auditLog.action, "riwi.knowledge.rejected"));
    assert.equal(rejection.length, 1);
    assert.equal(rejection[0]?.targetId, candidate.id);
    assert.equal((rejection[0]?.metadata as Record<string, unknown>).status, "rejected");
    assert.ok(!JSON.stringify(rejection[0]?.metadata).includes("learner@example.test"));
  } finally {
    await database.close();
  }
});

test("owner governance conflict resolution binds the displayed candidate and exact active source", async () => {
  const database = await createTestDatabase();
  const ownerId = randomUUID();
  await database.db.insert(users).values({ id: ownerId, name: "Governance owner", role: "owner", accountStatus: "active" });
  const actor = ownerActor(ownerId);
  try {
    const active = await source(database, actor, "Past tense active", "Past simple regular verbs use an ed ending in standard written English.");
    await approveKnowledgeCandidate({ actor, sourceId: active.id }, database.db);
    await promoteKnowledgeSource({ actor, sourceId: active.id, regressionFixtureId: "retrieval-active-scope-only-v1" }, database.db);
    const candidate = await source(database, actor, "Past tense candidate", "Regular verbs in past simple often use the ed ending in standard written English.");
    const conflict = (await listKnowledgeConflicts(actor, candidate.id, database.db))[0]!;
    await assert.rejects(resolveKnowledgeConflict({
      actor, conflictId: conflict.id, expectedSourceId: randomUUID(), decision: "accept_candidate", reason: "Wrong parent source.",
    }, database.db), (error: unknown) => error instanceof KnowledgeServiceError && error.code === "not_found");
    await resolveKnowledgeConflict({
      actor, conflictId: conflict.id, expectedSourceId: candidate.id, decision: "accept_candidate", reason: "Owner review; exact active source identified.",
    }, database.db);
    const stored = await database.db.query.riwiKnowledgeConflicts.findFirst({ where: eq(riwiKnowledgeConflicts.id, conflict.id) });
    assert.equal(stored?.state, "accepted");
    assert.equal(stored?.candidateSourceId, candidate.id);
  } finally {
    await database.close();
  }
});

test("owner governance lifecycle routes bind strict actions to the server-side owner", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(path, "utf8");
  const approval = read("src/app/api/riwi/owner/knowledge/[sourceId]/approve/route.ts");
  const rejection = read("src/app/api/riwi/owner/knowledge/[sourceId]/reject/route.ts");
  const promotion = read("src/app/api/riwi/owner/knowledge/[sourceId]/promote/route.ts");
  const conflict = read("src/app/api/riwi/owner/knowledge/[sourceId]/conflicts/[conflictId]/route.ts");
  for (const route of [approval, rejection, promotion, conflict]) {
    assert.match(route, /requireRiwiOwner\(\)/);
    assert.match(route, /checkRequestOrigin\(request\)/);
    assert.match(route, /readRiwiBoundedJson\(/);
    assert.match(route, /\.strict\(\)/);
  }
  assert.match(approval, /approveKnowledgeCandidate\(/);
  assert.match(rejection, /rejectKnowledgeCandidate\(/);
  assert.match(conflict, /resolveKnowledgeConflict\(/);
  assert.match(promotion, /regressionFixtureId: z\.literal\("retrieval-active-scope-only-v1"\)/);
  assert.match(promotion, /expectedVersion: z\.number\(\)\.int\(\)\.positive\(\)/);
  assert.match(promotion, /expectedSupersedesVersion/);
  assert.match(promotion, /promoteKnowledgeSource\(/);
});

test("owner history endpoints reauthorize current owner identity and keep diagnostics independent of pages", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(path, "utf8");
  const knowledgeRoute = read("src/app/api/riwi/owner/knowledge/route.ts");
  const signalRoute = read("src/app/api/riwi/learning-signals/route.ts");
  const auditRoute = read("src/app/api/riwi/owner/audit/route.ts");
  const providerRoute = read("src/app/api/riwi/owner/provider-lab/route.ts");
  const diagnosticsRoute = read("src/app/api/riwi/owner/diagnostics/route.ts");
  assert.match(knowledgeRoute, /requireRiwiOwner\(\)/);
  assert.match(knowledgeRoute, /listKnowledgeSourcePage\(/);
  assert.match(knowledgeRoute, /getAll\("state"\)/);
  assert.match(knowledgeRoute, /RIWI_KNOWLEDGE_HISTORY_STATES/);
  assert.match(signalRoute, /requireActiveUser\(\)/);
  assert.match(signalRoute, /user\.role !== "owner"/);
  assert.match(signalRoute, /listLearningSignalPage\(/);
  assert.match(signalRoute, /getAll\("state"\)/);
  assert.match(signalRoute, /RIWI_LEARNING_SIGNAL_HISTORY_STATES/);
  assert.match(auditRoute, /requireRiwiOwner\(\)/);
  assert.match(auditRoute, /listRiwiGovernanceAuditPage\(/);
  assert.match(providerRoute, /ownerActor\(\)/);
  assert.match(providerRoute, /listRiwiProviderExperimentPage\(/);
  assert.match(diagnosticsRoute, /countKnowledgeSourcesForOwner\(/);
  assert.match(diagnosticsRoute, /countLearningSignalsForOwner\(/);
  assert.match(diagnosticsRoute, /countRiwiGovernanceAuditForOwner\(/);
  assert.match(diagnosticsRoute, /countRiwiProviderExperiments\(/);
  assert.doesNotMatch(diagnosticsRoute, /listKnowledgeSources\(|listLearningSignals\(/,
    "diagnostics totals are independent aggregate queries, not the displayed history page");
});

test("owner RIWI has a localized breadcrumb and a real parent route", () => {
  assert.deepEqual(breadcrumbsFor("/owner/riwi", en).map((crumb) => crumb.href), ["/owner", "/owner/riwi"]);
  assert.deepEqual(breadcrumbsFor("/owner/riwi", uz).map((crumb) => crumb.href), ["/owner", "/owner/riwi"]);
  assert.equal(parentFor("/owner/riwi", en)?.href, "/owner");
  assert.equal(parentFor("/owner/riwi", uz)?.href, "/owner");
});
