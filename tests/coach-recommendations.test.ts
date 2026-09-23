import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  notAssessedPronunciationCriterion,
  resolvePronunciationAssessment,
} from "../src/lib/services/coach/pronunciation";
import {
  buildStudyRecommendations,
  type WeaknessSignal,
} from "../src/lib/services/coach/recommendations";
import { providerRegistry } from "../src/lib/services/coach/registry";

const signal = (over: Partial<WeaknessSignal> & { category: string }): WeaknessSignal => ({
  occurrenceCount: 1,
  recentSeverity: "medium",
  status: "open",
  lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
  ...over,
});

describe("PronunciationEvaluationService", () => {
  it("reports pronunciation as not assessed when nothing declares audio analysis", () => {
    const availability = resolvePronunciationAssessment([]);
    assert.equal(availability.assessed, false);
    assert.equal(availability.reason, "no_audio_capable_provider");
  });

  it("uses the registered provider that really declares the capability", () => {
    const availability = resolvePronunciationAssessment(["vendor-with-audio", "vendor-text"]);
    assert.equal(availability.assessed, true);
    assert.equal(availability.assessed ? availability.providerId : null, "vendor-with-audio");
  });

  it("ignores blank ids instead of treating them as a provider", () => {
    const availability = resolvePronunciationAssessment(["", "   "]);
    assert.equal(availability.assessed, false);
  });

  it("never invents a pronunciation band", () => {
    const criterion = notAssessedPronunciationCriterion();
    assert.equal(criterion.key, "pronunciation");
    assert.equal(criterion.band, null);
    assert.equal(criterion.limited, true);
    assert.match(criterion.note ?? "", /Not assessed/);
  });

  it("agrees with the live registry: RIWI alone cannot judge pronunciation", () => {
    assert.deepEqual(providerRegistry.idsWithCapability("pronunciation"), []);
    assert.equal(resolvePronunciationAssessment(providerRegistry.idsWithCapability("pronunciation")).assessed, false);
  });
});

describe("StudyRecommendationService", () => {
  it("recommends nothing when there is no evidence", async () => {
    assert.deepEqual(buildStudyRecommendations([]), []);
  });

  it("ranks the most severe and most repeated weakness first", () => {
    const recommendations = buildStudyRecommendations([
      signal({ category: "WRITING_LENGTH", occurrenceCount: 1, recentSeverity: "low" }),
      signal({ category: "GRAMMAR_ARTICLE", occurrenceCount: 4, recentSeverity: "high" }),
    ]);
    assert.equal(recommendations[0]?.area, "grammar");
    assert.equal(recommendations[0]?.categories[0], "GRAMMAR_ARTICLE");
    assert.equal(recommendations[0]?.reason.length > 0, true);
  });

  it("gives one action per practice area and names the other signals in it", () => {
    const recommendations = buildStudyRecommendations([
      signal({ category: "GRAMMAR_ARTICLE", occurrenceCount: 3, recentSeverity: "high" }),
      signal({ category: "GRAMMAR_TENSE", occurrenceCount: 2, recentSeverity: "medium" }),
      signal({ category: "VOCAB_NOT_USED", occurrenceCount: 2, recentSeverity: "medium" }),
    ]);
    assert.equal(recommendations.length, 2);
    const grammar = recommendations.find((r) => r.area === "grammar");
    assert.deepEqual(grammar?.categories, ["GRAMMAR_ARTICLE", "GRAMMAR_TENSE"]);
    assert.equal(recommendations.filter((r) => r.area === "grammar").length, 1);
  });

  it("never recommends a pattern the learner already resolved", () => {
    assert.deepEqual(
      buildStudyRecommendations([signal({ category: "GRAMMAR_SVA", status: "resolved" })]),
      []
    );
  });

  it("caps the list and ignores unknown categories", () => {
    const recommendations = buildStudyRecommendations(
      [
        signal({ category: "GRAMMAR_ARTICLE", recentSeverity: "high" }),
        signal({ category: "WRITING_COHERENCE", recentSeverity: "high" }),
        signal({ category: "SPEAKING_FLUENCY", recentSeverity: "high" }),
        signal({ category: "VOCAB_NOT_USED", recentSeverity: "high" }),
        signal({ category: "NOT_A_REAL_CATEGORY", recentSeverity: "high" }),
      ],
      3
    );
    assert.equal(recommendations.length, 3);
    assert.ok(recommendations.every((r) => r.categories.every((c) => c !== "NOT_A_REAL_CATEGORY")));
  });

  it("carries a real destination for every recommendation", () => {
    const recommendations = buildStudyRecommendations([
      signal({ category: "GRAMMAR_ARTICLE" }),
      signal({ category: "WRITING_LENGTH" }),
      signal({ category: "SPEAKING_FLUENCY" }),
      signal({ category: "VOCAB_NOT_USED" }),
    ]);
    for (const recommendation of recommendations) {
      assert.match(recommendation.href, /^\/[a-z-]+(\/[a-z-]+)*$/);
      assert.equal(recommendation.occurrenceCount > 0, true);
    }
  });
});
