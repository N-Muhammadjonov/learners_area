import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * LEGACY CONTENT INVENTORY (§93, §94).
 *
 * Every piece of content that lives in the repository rather than in canonical
 * storage is listed here, with its classification and the reason for it. Nothing
 * is deleted by this tool: it reports, and where a safe conversion exists it can
 * run that conversion through the standard authoring path (§95).
 *
 * Classifications:
 *   KEEP                        – not content; infrastructure or genuinely native code
 *   MIGRATE                     – real content that must become canonical
 *   COMPATIBILITY ONLY          – reads stay because stored or historical rows depend
 *                                 on them, but nothing new may be authored into it
 *   REMOVE AFTER MIGRATION      – superseded once its content is canonical and the
 *                                 dependency check below is clean
 *   MANUAL REVIEW REQUIRED      – cannot be classified mechanically (ambiguous scope,
 *                                 external provider, copyright question)
 *
 * Run with `--json` for machine use, `--migrate` to convert the items whose
 * conversion is implemented and safe.
 */

const ITEMS = [
  {
    path: "src/lib/content/*",
    what: "canonical content layer (taxonomy, question types, versions, score policy, mocks, authoring, blocks, lessons, vocabulary packs, assignments, identity)",
    classification: "KEEP",
    reason: "this IS the canonical system; keep the module free of IELTS-only assumptions",
  },
  {
    path: "src/lib/services/vocabulary/packs.ts",
    what: "hard-coded built-in topical vocabulary packs (topics → words)",
    classification: "COMPATIBILITY ONLY",
    reason:
      "learners must see a pack before any pack is authored, and stored rows reference pack ids. The DB becomes the source of truth the moment a pack is published; this list must not gain new words (§31).",
    successor: "src/lib/content/vocabulary-packs.ts",
    convertedBy: "scripts/content-backfill-vocabulary-packs.ts",
  },
  {
    path: "src/lib/services/writing/topic-vocabulary.ts",
    what: "the Writing topic-vocabulary read: words + phrases + saved state for one learner",
    classification: "KEEP",
    reason:
      "MIGRATED (§76). The words it used to hold are gone: it now projects the canonical topic packs through `listTopicPacksForLearner`, whose words ARE `lexemes` rows, and falls back to the built-in list only while no pack is published — the same compatibility rule every other consumer of the packs follows. Its phrases are published `writing_language_patterns`, and saved state is the learner's real `user_vocabulary` / pattern bank. It is a read projection, not a content store.",
    successor: "vocabulary_topic_packs (+ lexemes) via listTopicPacksForLearner",
    convertedBy: "scripts/content-backfill-vocabulary-packs.ts",
  },
  {
    path: "src/lib/services/writing/typing-corpus.ts",
    what: "the 30 owner-supplied B1/B2 typing passages, bundled in server code",
    classification: "COMPATIBILITY ONLY",
    reason:
      "the trainer must work on a database that has not applied migration 0048 yet, and the browser must never " +
      "receive a client-trusted target, so the server keeps the same 30 passages as a fallback. The database " +
      "becomes the source of truth the moment 0048 is applied (the migration seeds exactly these rows, and " +
      "`listTypingTexts` prefers published rows); this list must not gain new passages.",
    successor: "typing_texts (drizzle/0048_typing_trainer.sql)",
    convertedBy: "drizzle/0048_typing_trainer.sql",
  },
  {
    path: "src/lib/data/reading-library.ts",
    what: "legacy reading library view over reading attempts/passages",
    classification: "COMPATIBILITY ONLY",
    reason:
      "historical attempts were recorded against these rows and must stay readable; new reading content is authored/imported as canonical reading sets (§94).",
    successor: "reading canonical sets in content_versions",
  },
  {
    path: "src/lib/import/listening/legacy.ts",
    what: "legacy listening conversion path",
    classification: "COMPATIBILITY ONLY",
    reason: "exists precisely to convert old shapes; keep it as the reading half of the migration story, and do not add new formats here.",
    successor: "src/lib/import/listening/canonical.ts",
  },
  {
    path:
      "src/components/listening/AuthoredListeningFrame.tsx + src/app/api/listening/full/[id]/authored, sandbox + src/lib/listening/authored-sandbox.ts",
    what: "legacy HTML runtime: an imported Listening package's own HTML/JS/CSS, executed for a learner inside an opaque-origin iframe (`authoredRuntime`)",
    classification: "COMPATIBILITY ONLY",
    reason:
      "packages imported before the canonical Listening contract carry their own runtime, and a learner mid-attempt must keep the test they were given. Nothing new may be authored into it: `listeningCanonicalContentSchema` refuses a payload that carries `authoredRuntime`, so every new import is canonical. The execution surface stays an opaque-origin sandbox (`allow-scripts` only, no same-origin), a per-session token, origin-checked postMessage, inert blob media, and never credentials — asserted by `listening-authored-sandbox`.",
    successor: "canonical Listening packages (src/lib/import/listening/canonical.ts) + typed lesson blocks",
  },
  {
    path: "src/lib/import/reading/*",
    what: "reading import + conversion (source, canonical)",
    classification: "KEEP",
    reason: "working import foundation; it feeds the canonical store through the standard path",
  },
  {
    path: "src/lib/import/listening/*",
    what: "listening import + conversion (canonical, importer, index)",
    classification: "KEEP",
    reason: "working import foundation; canonical outputs, version-bound attempts",
  },
  {
    path: "src/lib/reading/lexical-policy.ts, src/lib/listening/lexical-policy.ts",
    what: "per-skill lexical policies",
    classification: "KEEP",
    reason: "policy, not content: they decide which words a learner is asked about",
  },
  {
    path: "src/db/seed.ts",
    what: "development seed data",
    classification: "COMPATIBILITY ONLY",
    reason: "local fixtures only — never a production content source (§96 synthetic data)",
  },
  {
    path: "src/lib/data/listening-attempt-write.ts",
    what: "listening attempt write path",
    classification: "KEEP",
    reason: "attempt plumbing, not content",
  },
  {
    path: "src/lib/content/mocks.ts / score-policy.ts",
    what: "mock orchestration + score policy versions",
    classification: "KEEP",
    reason: "canonical orchestration objects; mocks compose content by reference",
  },
  {
    path: "src/app/api/speaking/materials + src/components/speaking/NewMaterialForm.tsx",
    what: "upload-backed Speaking material writer (a file or link primary plus description blocks)",
    classification: "COMPATIBILITY ONLY",
    reason:
      "an existing material's attachment may only arrive through the verified pipeline (upload-intent → upload → finalize → claim), so this route stays as the file door and now pins the SAME canonical identity as authoring (`speaking:material`, targetType `speaking_material`) — asserted by `speaking-canonical-identity`. New link/descriptive materials are authored through `saveContentDraft`, which is why nothing new should be written here beyond the file claim itself.",
    successor: "src/lib/content/authors.ts (speaking:material) + src/lib/services/speaking/materials.ts",
  },
  {
    path: "src/components/speaking/ShadowingStudio.tsx + src/app/app/(shell)/speaking/shadowing",
    what: "shadowing studio: a source recording plus the learner's own local take",
    classification: "RETIRED",
    reason:
      "RETIRED BY OWNER DECISION — Shadowing is not part of the Learners Area product. The component is deleted and the route is a redirect issued from middleware (308 → /app/speaking/lessons) so the status is honest in front of the (shell) Suspense boundary. Nothing is destructively removed underneath it: the `shadowing` database enum value and every historical `speaking_materials` row are preserved, and `scripts/verify-shadowing.mjs` is now an ABSENCE suite that fails if any of this regresses. Previously classified KEEP, which was wrong the moment the feature was retired.",
  },
  {
    path: "src/lib/speaking/manage-topic.ts (+ src/lib/speaking/topic-draft.ts)",
    what: "the `topic` grouping over the Speaking bank (the thing `topic_set` used to name)",
    classification: "KEEP",
    reason:
      "a topic set is a GROUPING of canonical `speaking_prompts`, not a content type: it creates, edits, removes and restores bank rows atomically and archives rather than deletes. `topic_set` was removed from the taxonomy because declaring it invited a second store for prompts that already have one.",
    successor: "src/lib/content/authors.ts (speaking:part1_question | speaking:cue_card | speaking:part3_question)",
  },
  {
    path: "src/lib/data/attempt-timeline.ts (+ src/app/api/history)",
    what: "cross-skill attempt timeline (Reading, Listening, Writing, Speaking, Grammar, Mock, Assignment)",
    classification: "KEEP",
    reason:
      "a READ projection over the real domain attempts: it owns no table, copies nothing, and names the row it represents by (table, id) — the opposite of a parallel content store (§AD).",
  },
  {
    path: "src/lib/services/speaking/attempts.ts",
    what: "canonical identity for Speaking attempts (which revision a recording answered)",
    classification: "KEEP",
    reason:
      "identity plumbing, not content: it refuses a non-live prompt and pins the newest PUBLISHED revision, leaving legacy prompts honestly unbound. The bank, attempt history, audio retention and RIWI boundary are untouched.",
  },
  {
    path: "external provider material (TED programmes, podcast episodes, published test papers)",
    what: "media referenced by external id, or material whose copyright status is unknown",
    classification: "MANUAL REVIEW REQUIRED",
    reason:
      "an external id is a reference and is safe; any stored transcript, question text or audio that came from a copyrighted paper must be reviewed by a human before it is stored, and no copyrighted question may be re-created here (§75, §96).",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* TABLE COVERAGE — the mechanical half of "no unclassified runtime remains"  */
/* -------------------------------------------------------------------------- */

/**
 * Every content-bearing table in the schema, in exactly one group. Declaring the groups
 * is what makes the claim checkable rather than asserted: a NEW table that is not
 * covered by a group, the inventory, or the dictionary rule below fails the check, so a
 * parallel content store cannot be added quietly.
 *
 * The dictionary tables are not in `src/db/schema.ts` at all (that subsystem owns its own
 * SQL under `drizzle/0038…`), which is why it needs the prefix rule instead of a list.
 */
export const TABLE_GROUPS: { group: string; reason: string; tables: readonly string[] }[] = [
  {
    group: "Telegram authentication and bot operations",
    reason: "private identity, one-time proofs, permissions and delivery state; never authored learning content",
    tables: ["telegram_bot_admins", "telegram_broadcast_deliveries", "telegram_broadcasts", "telegram_contacts", "telegram_login_intents", "telegram_support_messages", "telegram_support_threads", "telegram_bot_settings", "telegram_deletion_intents", "telegram_direct_messages", "telegram_notifications", "telegram_processed_updates", "telegram_flow_drafts", "ownership_transfer_challenges", "telegram_owner_handovers"],
  },
  {
    group: "canonical content (authored or imported, versioned in content_versions)",
    reason:
      "the tables an author or an importer writes; identity, revisions and publication live here. " +
      "`typing_texts` is the one member here that is NOT yet revisioned through content_versions: it carries " +
      "its own identity (`external_id`), provenance and publication state, and its owner corpus is seeded by " +
      "migration 0048 while the code keeps a bundled fallback. That gap is named, not hidden — see LEGACY-MIGRATION.md.",
    tables: [
      "lessons", "lesson_blocks", "video_lessons", "video_lesson_questions",
      "reading_passages", "reading_passage_paragraphs", "reading_question_groups", "reading_questions",
      "listening_tests", "listening_questions", "listening_packages",
      "general_reading_sets", "general_reading_passages",
      "writing_prompts", "writing_lessons", "writing_model_texts", "writing_language_patterns",
      "writing_translation_sets", "writing_translation_sentences", "writing_exam_papers",
      "writing_exam_paper_entries", "writing_pattern_bank", "typing_texts", "typing_run_texts",
      "speaking_prompts", "speaking_materials",
      "grammar_topics", "grammar_exercises",
      "vocabulary_topic_packs", "vocabulary_topic_pack_words",
      "retention_texts", "retention_text_versions",
      "content_versions", "content_imports",
    ],
  },
  {
    group: "composition (orchestration objects that reference canonical content)",
    reason: "a composition names content by identity and never copies it into itself",
    tables: ["courses", "course_modules", "units", "mock_tests", "mock_sections", "assignments", "assignment_targets", "retention_rotation_state"],
  },
  {
    group: "attempts and learner state (never a content source)",
    reason: "what a learner did: attempts, answers, drafts, progress, grades and vocabulary state",
    tables: [
      // Learner-private study text: readable by its own author only, never enumerated by a
      // progress read, a staff screen or the content pipeline (PHASE C, "Xulosangiz").
      "lesson_notes",
      "reading_attempts", "reading_answers", "listening_attempts", "listening_answers", "listening_mcq_sessions",
      "listening_activity_runs", "listening_drafts", "listening_authored_checkpoints", "grammar_attempts", "speaking_attempts",
      "writing_submissions", "writing_feedback", "writing_lesson_progress", "writing_translation_attempts",
      "writing_translation_answers", "writing_exam_sessions", "writing_grade_requests", "writing_stealing_sessions",
      "typing_runs", "mock_attempts", "lesson_progress", "lesson_block_responses", "assignment_responses",
      "general_reading_progress", "video_lesson_progress", "enrollments", "activity_events", "vocab_point_events",
      "user_vocabulary", "user_vocabulary_contexts", "vocabulary_usages", "evaluations", "coach_weaknesses",
      "teacher_student_links", "retention_attempts", "retention_rotation_completions",
    ],
  },
  {
    group: "lexical subsystem (one lexeme → sense → occurrence model)",
    reason: "the shared lexical store every module resolves vocabulary through; not per-module content",
    tables: ["lexemes", "lexical_occurrences", "lexical_units", "lexical_unit_forms", "lexical_unit_pronunciations", "vocab_folders"],
  },
  {
    group: "infrastructure, ownership, billing and media plumbing",
    reason: "not content: accounts, upload intents, attached-material blocks, ops and payment rows",
    tables: [
      "upload_intents", "users", "access_requests", "notifications", "audit_log", "ownership_transfers",
      "password_reset_tokens", "auth_session_revocations", "onboarding_profiles", "resource_blocks", "material_blocks", "user_profile_photos",
      "problem_reports", "products", "plans", "prices", "subscriptions", "payments", "access_entitlements",
    ],
  },
  {
    group: "live/interaction runtime",
    reason: "rooms, presence, invites and blocks — interaction state, never authored content",
    tables: ["live_classes", "live_class_attendance", "live_partner_presence", "live_partner_invites", "live_partner_sessions", "live_partner_blocks"],
  },
];

const DICTIONARY_PREFIX = "dictionary_";

/** Every table the schema declares. */
export function declaredTables(schemaSource: string = readFileSync(fileURLToPath(new URL("../src/db/schema.ts", import.meta.url)), "utf8")): string[] {
  return [...schemaSource.matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)].map((match) => match[1]!).sort();
}

/**
 * Coverage problems, in both directions: a table nothing classifies, and a class that
 * names a table the schema no longer has (that is how a list like this rots into a lie).
 */
export function inventoryCoverageProblems(schemaSource?: string): string[] {
  const tables = new Set(declaredTables(schemaSource));
  const problems: string[] = [];
  const classified = new Set<string>();
  for (const group of TABLE_GROUPS) {
    for (const table of group.tables) {
      if (classified.has(table)) problems.push(`${table}: classified twice (${group.group})`);
      classified.add(table);
      if (!tables.has(table)) problems.push(`${table}: classified in "${group.group}" but the schema has no such table`);
    }
  }
  for (const table of tables) {
    if (classified.has(table) || table.startsWith(DICTIONARY_PREFIX)) continue;
    problems.push(`${table}: UNCLASSIFIED — no group, no dictionary rule, and not named by the inventory`);
  }
  return problems;
}

/**
 * "RETIRED" is distinct from "REMOVE AFTER MIGRATION" on purpose: the latter means the
 * code is still live and must be converted before it can go, the former means an owner
 * decision already took the feature out of the product. A retired item keeps its entry
 * here so the inventory still accounts for the historical data underneath it, and its
 * reason must say what was preserved rather than only what was deleted.
 */
export type LegacyClassification = "KEEP" | "MIGRATE" | "COMPATIBILITY ONLY" | "REMOVE AFTER MIGRATION" | "MANUAL REVIEW REQUIRED" | "RETIRED";

export type LegacyItem = {
  path: string;
  what: string;
  classification: LegacyClassification;
  reason: string;
  successor?: string;
  convertedBy?: string;
  needsMigration?: boolean;
};

export function legacyInventory(): LegacyItem[] {
  return ITEMS.map((item) => ({ ...item })) as LegacyItem[];
}

export function inventorySummary(items: readonly LegacyItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.classification] = (counts[item.classification] ?? 0) + 1;
  return counts;
}

/**
 * The one rule that keeps this file honest: content that must move is never
 * "resolved" by pointing at itself, and the items classified as removable must
 * name the successor that replaces them. A missing successor is a real finding,
 * so the check fails rather than printing a tidy table.
 */
export function inventoryProblems(items: readonly LegacyItem[] = legacyInventory()): string[] {
  const problems: string[] = [...inventoryCoverageProblems()];
  for (const item of items) {
    const mustMove = item.classification === "REMOVE AFTER MIGRATION" || item.classification === "MIGRATE";
    if (mustMove && !item.successor) problems.push(`${item.path}: classified ${item.classification} but names no successor`);
    if (item.classification === "REMOVE AFTER MIGRATION" && !item.convertedBy && !item.successor)
      problems.push(`${item.path}: removal claimed with no conversion path`);
    if (item.classification === "MANUAL REVIEW REQUIRED" && item.convertedBy)
      problems.push(`${item.path}: cannot be both automatically converted and awaiting review`);
  }
  return problems;
}

export function formatInventory(items: readonly LegacyItem[]): string {
  const lines = ["LEGACY CONTENT INVENTORY (§93)", ""];
  for (const item of items) {
    lines.push(`• ${item.path}`);
    lines.push(`    ${item.what}`);
    lines.push(`    ${item.classification} — ${item.reason}`);
    if (item.successor) lines.push(`    successor: ${item.successor}`);
    if (item.convertedBy) lines.push(`    conversion: ${item.convertedBy}`);
    lines.push("");
  }
  const summary = inventorySummary(items);
  lines.push(`TOTAL ${items.length} — ` + Object.entries(summary).map(([key, value]) => `${key}: ${value}`).join(", "));
  const problems = inventoryProblems(items);
  lines.push(problems.length === 0 ? "no problems found" : `PROBLEMS: ${problems.length}`);
  for (const problem of problems) lines.push(`  - ${problem}`);
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ items: legacyInventory(), summary: inventorySummary(legacyInventory()), problems: inventoryProblems() }, null, 2));
    return;
  }
  console.log(formatInventory(legacyInventory()));
  if (inventoryProblems().length > 0) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("content-legacy-inventory.ts")) {
  void main();
}
