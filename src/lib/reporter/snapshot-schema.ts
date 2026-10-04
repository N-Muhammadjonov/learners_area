import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTimestamp = z.string().datetime({ offset: true });

export const reportScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owner") }).strict(),
  z.object({ kind: z.literal("teacher"), teacherId: z.string().uuid().nullable() }).strict(),
  z.object({ kind: z.literal("student"), subjectId: z.string().uuid(), subjectName: z.string().max(120) }).strict(),
]);

const reportMetricSchema = z.object({
  key: z.string().min(1).max(100),
  section: z.enum(["learning", "results", "people", "operations"]),
  label: z.object({ en: z.string().max(200), uz: z.string().max(200) }).strict(),
  unit: z.enum(["count", "ratio", "band", "score"]),
  value: z.number().finite().nullable(),
  source: z.object({
    queryId: z.string().min(1).max(100),
    sql: z.string().min(1).max(10_000),
    parameters: z.record(z.string().max(80), z.string().max(120)),
  }).strict(),
  window: z.object({ from: isoTimestamp, to: isoTimestamp, basis: z.enum(["window", "as_of_end"]) }).strict(),
  scope: z.string().min(1).max(200),
  generatedAt: isoTimestamp,
}).strict();

/** Runtime contract for the immutable Reporter snapshot passed through RIWI. */
export const reportSnapshotSchema = z.object({
  schemaVersion: z.literal("riwi-report/1"),
  reportId: z.string().uuid(),
  generatedAt: isoTimestamp,
  generatedBy: z.object({ userId: z.string().uuid(), role: z.enum(["student", "teacher", "admin", "owner"]) }).strict(),
  timezone: z.string().min(1).max(80),
  period: z.object({
    kind: z.enum(["on_demand", "weekly", "monthly", "yearly", "custom"]),
    timezone: z.string().min(1).max(80),
    from: isoTimestamp,
    to: isoTimestamp,
    fromDate: isoDate,
    toDate: isoDate,
  }).strict(),
  scope: reportScopeSchema,
  metrics: z.array(reportMetricSchema).max(100),
  narrative: z.object({
    source: z.literal("deterministic"),
    en: z.array(z.string().max(500)).max(30),
    uz: z.array(z.string().max(500)).max(30),
  }).strict(),
}).strict();

export type ValidatedReportSnapshot = z.infer<typeof reportSnapshotSchema>;
