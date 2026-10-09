import { RIWI_CONVERSATION_TTL_DAYS } from "@/lib/services/riwi/contracts";
import type { ExportScope } from "./types";

export type DataClass = "riwi-core" | "site-private" | "site-content" | "governance-private";
export type TableClassification = Readonly<{
  dataClass: DataClass;
  scopes: readonly ExportScope[];
  containsPrivateData: boolean;
  objectClass?: "riwi-knowledge-source" | "speaking-audio";
}>;

const FULL = ["full-system"] as const;
const SITE = ["full-system", "learners-area"] as const;
const RIWI = ["full-system", "riwi"] as const;

/**
 * Closed allowlist. A schema table missing here fails the classification gate.
 * Mode B deliberately excludes conversations, private evaluations, usage rows,
 * user-scoped learning evidence, and every Speaking submission/audio relation.
 */
export const PORTABILITY_TABLES = {
  upload_intents: { dataClass: "site-private", scopes: SITE, containsPrivateData: true, objectClass: "speaking-audio" },
  users: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  access_requests: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  notifications: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  audit_log: { dataClass: "governance-private", scopes: FULL, containsPrivateData: true },
  riwi_knowledge_sources: { dataClass: "riwi-core", scopes: RIWI, containsPrivateData: false, objectClass: "riwi-knowledge-source" },
  riwi_knowledge_units: { dataClass: "riwi-core", scopes: RIWI, containsPrivateData: false },
  riwi_knowledge_conflicts: { dataClass: "riwi-core", scopes: RIWI, containsPrivateData: false },
  riwi_learning_signals: { dataClass: "governance-private", scopes: FULL, containsPrivateData: true },
  riwi_learning_reviews: { dataClass: "governance-private", scopes: FULL, containsPrivateData: true },
  riwi_conversations: { dataClass: "site-private", scopes: FULL, containsPrivateData: true },
  riwi_conversation_messages: { dataClass: "site-private", scopes: FULL, containsPrivateData: true },
  riwi_action_confirmations: { dataClass: "governance-private", scopes: FULL, containsPrivateData: true },
  riwi_provider_experiments: { dataClass: "governance-private", scopes: FULL, containsPrivateData: true },
  riwi_provider_experiment_results: { dataClass: "governance-private", scopes: FULL, containsPrivateData: true },
  riwi_assessment_policies: { dataClass: "riwi-core", scopes: RIWI, containsPrivateData: false },
  riwi_assessment_policy_versions: { dataClass: "riwi-core", scopes: RIWI, containsPrivateData: false },
  riwi_usage_metrics: { dataClass: "governance-private", scopes: FULL, containsPrivateData: true },
  riwi_security_signals: { dataClass: "riwi-core", scopes: RIWI, containsPrivateData: false },
  ownership_transfers: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  // Ephemeral reset capabilities never move, even in Mode A.
  password_reset_tokens: { dataClass: "site-private", scopes: [], containsPrivateData: true },
  onboarding_profiles: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  courses: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  course_modules: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  units: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  lessons: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  lesson_progress: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  enrollments: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_prompts: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  typing_runs: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_submissions: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_feedback: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  reading_passages: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  reading_passage_paragraphs: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  reading_question_groups: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  reading_questions: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  reading_attempts: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  reading_answers: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  listening_tests: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  listening_questions: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  listening_attempts: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  listening_answers: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  listening_mcq_sessions: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  grammar_topics: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  grammar_exercises: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  grammar_attempts: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  speaking_materials: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  resource_blocks: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  material_blocks: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  speaking_prompts: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  speaking_attempts: { dataClass: "site-private", scopes: SITE, containsPrivateData: true, objectClass: "speaking-audio" },
  speaking_ai_sessions: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  speaking_ai_session_items: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  lexemes: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  lexical_occurrences: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  user_vocabulary: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  lexical_units: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  lexical_unit_forms: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  lexical_unit_pronunciations: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  user_vocabulary_contexts: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  vocab_folders: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  vocab_point_events: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  assignments: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  teacher_student_links: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  activity_events: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  live_classes: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  live_class_attendance: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  problem_reports: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  mock_tests: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  mock_attempts: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  products: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  plans: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  prices: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  subscriptions: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  payments: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  access_entitlements: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  evaluations: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  coach_weaknesses: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  vocabulary_usages: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  assignment_responses: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  video_lessons: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  video_lesson_questions: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  video_lesson_progress: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  retention_texts: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  retention_text_versions: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  retention_attempts: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  retention_rotation_state: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  retention_rotation_completions: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  live_partner_presence: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  live_partner_invites: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  live_partner_sessions: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  live_partner_blocks: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  listening_packages: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  listening_activity_runs: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  listening_drafts: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  general_reading_sets: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  general_reading_passages: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  general_reading_progress: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_lessons: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  writing_lesson_progress: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_exam_sessions: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_exam_papers: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  writing_exam_paper_entries: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  writing_grade_requests: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_translation_sets: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  writing_translation_sentences: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  writing_translation_attempts: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_translation_answers: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_model_texts: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  typing_run_texts: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_language_patterns: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
  writing_stealing_sessions: { dataClass: "site-private", scopes: SITE, containsPrivateData: true },
  writing_pattern_bank: { dataClass: "site-content", scopes: SITE, containsPrivateData: false },
} as const satisfies Record<string, TableClassification>;

export type PortableTable = keyof typeof PORTABILITY_TABLES;

// Authentication verifiers (password/token hashes) are site-private records and may
// move only in an encrypted full-system archive. Deployment credentials never do.
export const DEPLOYMENT_SECRET_FIELD_PATTERN = /(?:secret|api_?key|database_url|session_token|credential)/i;

export function tablesForScope(scope: ExportScope): PortableTable[] {
  return (Object.keys(PORTABILITY_TABLES) as PortableTable[]).filter((table) =>
    PORTABILITY_TABLES[table].scopes.includes(scope as never));
}

export function assertPortableFields(table: PortableTable, row: Readonly<Record<string, unknown>>): void {
  for (const [field, value] of Object.entries(row)) {
    if (DEPLOYMENT_SECRET_FIELD_PATTERN.test(field) && value != null) {
      throw new Error(`portable_secret_field:${table}.${field}`);
    }
  }
  if ((table === "riwi_conversations" || table === "riwi_conversation_messages") && "deletedAt" in row && row.deletedAt == null) return;
}

export function shouldExportPrivateRow(row: Readonly<Record<string, unknown>>, now = new Date(), table?: PortableTable): boolean {
  if (row.deletedAt != null || row.retentionState === "deleted" || row.retentionState === "expired") return false;
  if (table === "riwi_conversation_messages") {
    const createdAt = row.createdAt;
    if (!(typeof createdAt === "string" || createdAt instanceof Date)) return false;
    const timestamp = new Date(createdAt).getTime();
    if (!Number.isFinite(timestamp) || timestamp < now.getTime() - RIWI_CONVERSATION_TTL_DAYS * 86_400_000) return false;
  }
  const expiresAt = row.expiresAt;
  return !(typeof expiresAt === "string" || expiresAt instanceof Date) || new Date(expiresAt).getTime() > now.getTime();
}
