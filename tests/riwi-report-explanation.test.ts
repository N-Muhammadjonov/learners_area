import test from "node:test";
import assert from "node:assert/strict";
import { explainReportMetric, reportExplanationBoundary } from "../src/lib/services/riwi/report-explanation";
import { formatMetricValue, type ReportMetric } from "../src/lib/reporter/snapshot";

function metric(unit: ReportMetric["unit"], value: number | null, basis: "window" | "as_of_end" = "window"): ReportMetric {
  return { key: "test", section: "results", unit, value, label: { en: "Canonical metric", uz: "Kanonik ko'rsatkich" },
    source: { queryId: "test", sql: "select 1", parameters: {} }, window: { from: "2026-10-01T00:00:00Z", to: "2026-10-09T00:00:00Z", basis },
    scope: "self", generatedAt: "2026-10-09T00:00:00Z" };
}

test("report explanation preserves canonical display for all units; missing values never become zero", () => {
  for (const unit of ["count", "ratio", "band", "score"] as const) for (const language of ["en", "uz"] as const) {
    const row = metric(unit, unit === "ratio" ? 0.375 : 4.5);
    assert.ok(explainReportMetric(row, language).startsWith(`${row.label[language]}: ${formatMetricValue(row)}`));
    const missing = explainReportMetric(metric(unit, null), language);
    assert.ok(missing.startsWith(`${row.label[language]}: ${language === "uz" ? "Mavjud emas" : "Unavailable"}`));
    assert.ok(!missing.includes(": 0"));
    assert.equal(row.value, unit === "ratio" ? 0.375 : 4.5);
  }
});

test("historical snapshot basis is distinct from activity windows and no unsupported growth is claimed", () => {
  assert.ok(explainReportMetric(metric("count", 3, "as_of_end"), "en").includes("snapshot at the end"));
  assert.ok(explainReportMetric(metric("count", 3), "en").includes("within the stated period"));
  const boundary = reportExplanationBoundary("en");
  assert.ok(boundary[0].includes("cannot be confirmed"));
  assert.ok(boundary[1].includes("within your scope"));
  assert.ok(!boundary.join(" ").includes("http"));
});
