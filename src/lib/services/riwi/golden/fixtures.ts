import "server-only";
import { createHash } from "node:crypto";
import { ROLE_CAPABILITIES, authorizeCapability } from "../capabilities";
import { canonicalDictionaryStatus } from "../dictionary-status";
import { knowledgeScopeMatches } from "../knowledge-policy";
import { guardExternalPayload } from "../outbound-guard";
import { riwiAnswerSchema } from "@/lib/services/coach/schema";
import type { Role } from "@/lib/auth/roles";

/** Versioned, content-free regression anchors. No learner work or copyrighted test prompts. */
export const RIWI_GOLDEN_FIXTURES = [
  { id: "policy-deny-default-v1", area: "authorization", version: 1 },
  { id: "dictionary-unknown-is-unknown-v1", area: "dictionary", version: 1 },
  { id: "external-payload-redaction-v1", area: "privacy", version: 1 },
  { id: "retrieval-active-scope-only-v1", area: "knowledge", version: 1 },
  { id: "provider-output-schema-v1", area: "provider", version: 1 },
] as const;

export type RiwiFixtureId = (typeof RIWI_GOLDEN_FIXTURES)[number]["id"];
export type RiwiRegressionResult = {
  passed: boolean;
  evidenceHash: string;
  checks: Array<{ fixtureId: RiwiFixtureId; passed: boolean }>;
};

export function isRiwiRegressionFixture(value: string, area?: (typeof RIWI_GOLDEN_FIXTURES)[number]["area"]): value is RiwiFixtureId {
  return RIWI_GOLDEN_FIXTURES.some((fixture) => fixture.id === value && (!area || fixture.area === area));
}

/** Execute deterministic acceptance checks in-process; caller-supplied pass flags are never trusted. */
export function runRiwiRegressionSuite(targetDigest: string): RiwiRegressionResult {
  const student = { id: "aaaaaaaa-0000-4000-8000-000000000001", role: "student" as Role };
  const teacher = { id: "aaaaaaaa-0000-4000-8000-000000000002", role: "teacher" as Role };
  const checks: Array<{ fixtureId: RiwiFixtureId; passed: boolean }> = [
    {
      fixtureId: "policy-deny-default-v1",
      passed: authorizeCapability({ ...student, accountStatus: "active" }, "riwi.dictionary.lookup").allowed
        && !authorizeCapability({ ...student, accountStatus: "suspended" }, "riwi.chat.self").allowed
        && !authorizeCapability({ ...student, accountStatus: "active" }, "riwi.arbitrary.shell").allowed
        && !ROLE_CAPABILITIES.admin.includes("riwi.provider.configure"),
    },
    {
      fixtureId: "dictionary-unknown-is-unknown-v1",
      passed: canonicalDictionaryStatus(null) === "unresolved" && canonicalDictionaryStatus({ term: "verified" }) === "resolved",
    },
    {
      fixtureId: "external-payload-redaction-v1",
      passed: (() => {
        const result = guardExternalPayload("chat", { language: "en", message: "Contact learner@example.test", history: [], knowledge: [] });
        return result.ok && !result.payload.message.includes("learner@example.test")
          && !guardExternalPayload("chat", { language: "en", message: "hello", history: [], knowledge: [], userId: student.id }).ok;
      })(),
    },
    {
      fixtureId: "retrieval-active-scope-only-v1",
      passed: knowledgeScopeMatches({ kind: "global" }, student)
        && knowledgeScopeMatches({ kind: "role", role: "student" }, student)
        && !knowledgeScopeMatches({ kind: "role", role: "student" }, teacher)
        && knowledgeScopeMatches({ kind: "user", userId: student.id }, student)
        && !knowledgeScopeMatches({ kind: "user", userId: student.id }, teacher),
    },
    {
      fixtureId: "provider-output-schema-v1",
      passed: riwiAnswerSchema.safeParse({ answer: "Short explanation.", uncertainty: null, citations: [] }).success
        && !riwiAnswerSchema.safeParse({ answer: "Short explanation.", uncertainty: null, citations: [], toolCall: "shell" }).success,
    },
  ];
  const evidenceHash = createHash("sha256").update(JSON.stringify({
    targetDigest,
    fixtures: RIWI_GOLDEN_FIXTURES.map(({ id, version }) => ({ id, version })),
    checks,
  })).digest("hex");
  return { passed: checks.every((check) => check.passed), evidenceHash, checks };
}
