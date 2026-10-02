import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  jsonb,
  real,
  index,
  uniqueIndex,
  smallint,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Application roles, highest first: owner > admin > teacher > student.
 *
 * OWNER is a real role, not a boolean flag next to "admin": it is the only role
 * that may transfer ownership, and it is the only one that may grant the admin
 * role. `users.isOwner` is kept only as a historical column — authorization
 * never reads it.
 */
export const roleEnum = pgEnum("role", ["student", "teacher", "admin", "owner"]);

/**
 * Private learning centre admission state. Every private page, API route and
 * object download is gated on this server-side value: hiding a menu item is not
 * authorization (see src/lib/auth/session.ts).
 */
export const accountStatusEnum = pgEnum("account_status", [
  "pending",
  "active",
  "rejected",
  "suspended",
]);

/** Explicit registration choice; nullable for legacy and provider-created users. */
export const genderEnum = pgEnum("gender", ["male", "female"]);

export const accessRequestStatusEnum = pgEnum("access_request_status", [
  "pending",
  "approved",
  "rejected",
]);

/**
 * How authored content reaches students.
 *
 * `draft` and `archived` are invisible to students, `scheduled` becomes visible
 * at `publish_at`, `published` is visible now. The rule itself lives in
 * `src/lib/services/cms/publication.ts` — this enum only stores it.
 */
export const publicationStateEnum = pgEnum("publication_state", [
  "draft",
  "scheduled",
  "published",
  "archived",
]);

export const contentStateEnum = pgEnum("content_state", [
  "locked",
  "available",
  "assigned",
  "in_progress",
  "completed",
]);

export const writingTaskTypeEnum = pgEnum("writing_task_type", ["task1", "task2"]);

export const writingStatusEnum = pgEnum("writing_status", [
  "draft",
  "submitted",
  "evaluated",
]);

export const readingQuestionTypeEnum = pgEnum("reading_question_type", [
  "true_false_not_given",
  "yes_no_not_given",
  "multiple_choice",
  "short_answer",
]);

export const attemptStatusEnum = pgEnum("attempt_status", ["in_progress", "completed"]);

export const feedbackSourceEnum = pgEnum("feedback_source", ["demo_ai", "teacher"]);

export const vocabStateEnum = pgEnum("vocab_state", [
  "new",
  "learning",
  "review",
  "known",
  "mastered",
  "activated",
]);

export const assignmentStatusEnum = pgEnum("assignment_status", [
  "not_started",
  "in_progress",
  "completed",
  "overdue",
]);

export const grammarSkillAreaEnum = pgEnum("grammar_skill_area", ["writing", "speaking"]);

export const speakingCategoryEnum = pgEnum("speaking_category", [
  "part1",
  "part2",
  "part3",
  "general",
  "shadowing",
  "top_structures",
]);

export const listeningQuestionTypeEnum = pgEnum("listening_question_type", [
  "multiple_choice",
  "short_answer",
]);

export const materialTypeEnum = pgEnum("material_type", ["video", "audio", "file", "link"]);

export const contentBlockTypeEnum = pgEnum("content_block_type", ["text", "link", "file", "image", "audio"]);

// --- Upload intents ---------------------------------------------------------
// Every object that reaches storage goes through one of these first. It is the
// server's record that a specific authenticated user was authorized to write
// one specific, unpredictable object key — which is what makes a direct
// browser→R2 PUT safe to accept later, and what stops a client registering an
// arbitrary bucket key as its own resource.
export const uploadPurposeEnum = pgEnum("upload_purpose", [
  "material_primary",
  "material_block",
  "speaking_recording",
]);

export const uploadBlockKindEnum = pgEnum("upload_block_kind", ["image", "audio", "file"]);

export const uploadStatusEnum = pgEnum("upload_status", [
  "pending", // intent issued, bytes not yet confirmed in storage
  "finalized", // HEAD-verified in storage, not yet attached to a resource
  "attached", // referenced by a material primary or block
  "aborted", // cancelled by the user, or expired before finalizing
]);

export const uploadIntents = pgTable("upload_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Set when the object belongs to an already-existing material (edit flows),
  // so its key can live under resources/<materialId>/. Null while creating.
  materialId: uuid("material_id").references(() => speakingMaterials.id, { onDelete: "cascade" }),
  // Same idea for a Speaking attempt's recording, so its key can live under
  // speaking/attempts/<attemptId>/. Null for everything else.
  speakingAttemptId: uuid("speaking_attempt_id"),
  purpose: uploadPurposeEnum("purpose").notNull(),
  blockKind: uploadBlockKindEnum("block_kind"), // required when purpose = material_block
  objectKey: text("object_key").notNull().unique(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  size: integer("size").notNull(), // bytes declared by the client, re-checked on finalize
  status: uploadStatusEnum("status").notNull().default("pending"),
  directToStorage: boolean("direct_to_storage").notNull().default(true),
  error: text("error"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }), // set when claimed by a resource
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const liveClassStatusEnum = pgEnum("live_class_status", [
  "upcoming",
  "live",
  "completed",
  "recorded",
  "cancelled",
]);

// ---------------------------------------------------------------------------
// Identity & onboarding — WIRED (real auth + onboarding flow in Phase 1)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: text("password_hash"), // null for Telegram-only accounts
  telegramId: varchar("telegram_id", { length: 64 }).unique(),
  /** Google OIDC `sub` (stable account id). Never matched by email; see providers/google.ts. */
  googleSub: varchar("google_sub", { length: 255 }).unique(),
  name: varchar("name", { length: 200 }).notNull(),
  gender: genderEnum("gender"),
  role: roleEnum("role").notNull().default("student"),
  /** Historical column. Authorization reads `role`, never this flag. */
  isOwner: boolean("is_owner").notNull().default(false),
  /** Server-side admission gate for every private page, route and object. */
  accountStatus: accountStatusEnum("account_status").notNull().default("pending"),
  statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).defaultNow().notNull(),
  statusReason: text("status_reason"),
  /** Drives the inactivity half of the retention policy (see retention.ts). */
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
  /**
   * Last time the student did real learning work — submitted an attempt, had an
   * evaluation recorded, finished a lesson. Signing in and browsing does not
   * touch it, because "has not studied for six months" is a study question, not
   * a login question. Nullable: rows that predate the column have no answer, and
   * the retention rule falls back to the registration date rather than guessing.
   */
  lastMeaningfulActivityAt: timestamp("last_meaningful_activity_at", { withTimezone: true }),
  locale: varchar("locale", { length: 5 }).notNull().default("uz"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  statusIdx: index("users_account_status_idx").on(table.accountStatus),
}));

// ---------------------------------------------------------------------------
// Private-centre admission: a visitor asks to join, the centre decides.
// Every decision is a row here, so the history of who was approved, by whom and
// when survives even if the applicant re-applies after a rejection.
// ---------------------------------------------------------------------------

export const accessRequests = pgTable("access_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: accessRequestStatusEnum("status").notNull().default("pending"),
  /** Optional note the applicant writes when asking for access. */
  message: text("message"),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdx: index("access_requests_user_idx").on(table.userId),
  statusIdx: index("access_requests_status_idx").on(table.status),
}));

// ---------------------------------------------------------------------------
// In-app notifications + audit trail
// ---------------------------------------------------------------------------

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 60 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body"),
  href: varchar("href", { length: 300 }),
  payload: jsonb("payload"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdx: index("notifications_user_idx").on(table.userId, table.createdAt),
}));

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 80 }).notNull(),
  targetType: varchar("target_type", { length: 40 }),
  targetId: varchar("target_id", { length: 80 }),
  /** Never contains a secret: only ids, roles, counts and reasons. */
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  actionIdx: index("audit_log_action_idx").on(table.action, table.createdAt),
}));

export const ownershipTransfers = pgTable("ownership_transfers", {
  id: uuid("id").defaultRandom().primaryKey(),
  fromUserId: uuid("from_user_id").notNull().references(() => users.id),
  toUserId: uuid("to_user_id").notNull().references(() => users.id),
  /** Role the previous owner keeps after the transfer. */
  previousOwnerRole: roleEnum("previous_owner_role").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const onboardingProfiles = pgTable("onboarding_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  currentLevel: varchar("current_level", { length: 40 }),
  currentBand: real("current_band"),
  targetBand: real("target_band"),
  examDate: timestamp("exam_date", { withTimezone: true }),
  dailyStudyMinutes: integer("daily_study_minutes"),
  strongestSkill: varchar("strongest_skill", { length: 40 }),
  weakestSkill: varchar("weakest_skill", { length: 40 }),
});

// ---------------------------------------------------------------------------
// Course structure — WIRED for read (roadmap) in Phase 1; content authoring
// tools (full CMS) are NOT built yet, seed data populates these tables directly
// ---------------------------------------------------------------------------

export const courses = pgTable("courses", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 60 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Publication state and the moment a scheduled item opens. Visibility is
   * decided by `isLive()` in `src/lib/services/cms/publication.ts`; the older
   * `is_active` flag stays as a hint but is no longer what a student-facing
   * query trusts.
   */
  publicationState: publicationStateEnum("publication_state").notNull().default("published"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
});

export const courseModules = pgTable("course_modules", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 60 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  order: integer("order").notNull(),
});

export const units = pgTable("units", {
  id: uuid("id").defaultRandom().primaryKey(),
  moduleId: uuid("module_id").notNull().references(() => courseModules.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 60 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  order: integer("order").notNull(),
});

export const lessons = pgTable("lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  unitId: uuid("unit_id").notNull().references(() => units.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 60 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  summary: text("summary"),
  defaultState: contentStateEnum("default_state").notNull().default("locked"),
  order: integer("order").notNull(),
  /**
   * Recorded-lesson shell: the recording of the session this lesson covers, when
   * the centre has one. Nullable — a lesson without a recording shows its notes
   * and materials instead of an empty player.
   */
  recordingUrl: text("recording_url"),
});

export const lessonProgress = pgTable("lesson_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
  state: contentStateEnum("state").notNull().default("available"),
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const enrollments = pgTable("enrollments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Writing — WIRED end-to-end (prompt -> draft -> autosave -> submit -> demo
// evaluation -> feedback -> history), the deep vertical slice for Phase 1
// ---------------------------------------------------------------------------

export const writingPrompts = pgTable("writing_prompts", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskType: writingTaskTypeEnum("task_type").notNull(),
  category: varchar("category", { length: 60 }).notNull(),
  prompt: text("prompt").notNull(),
  targetWordCount: integer("target_word_count").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Publication state and the moment a scheduled item opens. Visibility is
   * decided by `isLive()` in `src/lib/services/cms/publication.ts`; the older
   * `is_active` flag stays as a hint but is no longer what a student-facing
   * query trusts.
   */
  publicationState: publicationStateEnum("publication_state").notNull().default("published"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * One timed typing run.
 *
 * Only aggregates are stored: the trainer's value is the number, and keeping a
 * student's raw mistyped text around would be a privacy cost with no teaching
 * benefit. `wpm` and `accuracy` are recomputed server-side on submit.
 */
export const typingRuns = pgTable("typing_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetChars: integer("target_chars").notNull(),
  typedChars: integer("typed_chars").notNull(),
  durationMs: integer("duration_ms").notNull(),
  wpm: numeric("wpm", { precision: 6, scale: 1 }).notNull(),
  accuracy: numeric("accuracy", { precision: 5, scale: 1 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const writingSubmissions = pgTable("writing_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  promptId: uuid("prompt_id").notNull().references(() => writingPrompts.id),
  content: text("content").notNull().default(""),
  wordCount: integer("word_count").notNull().default(0),
  status: writingStatusEnum("status").notNull().default("draft"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const writingFeedback = pgTable("writing_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id").notNull().references(() => writingSubmissions.id, { onDelete: "cascade" }),
  source: feedbackSourceEnum("source").notNull(),
  taskResponseBand: real("task_response_band"),
  coherenceBand: real("coherence_band"),
  lexicalBand: real("lexical_band"),
  grammarBand: real("grammar_band"),
  overallBand: real("overall_band"),
  strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
  weaknesses: jsonb("weaknesses").$type<string[]>().notNull().default([]),
  suggestions: jsonb("suggestions").$type<string[]>().notNull().default([]),
  comment: text("comment"),
  teacherId: uuid("teacher_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Reading — WIRED end-to-end (passage -> timed attempt -> auto-grading ->
// analysis with evidence), second deep vertical slice.
// ---------------------------------------------------------------------------

export const readingPassages = pgTable("reading_passages", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  bodyText: text("body_text").notNull(),
  difficultyLevel: varchar("difficulty_level", { length: 10 }).notNull().default("B2"),
  suggestedMinutes: integer("suggested_minutes").notNull().default(20),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Publication state and the moment a scheduled item opens. Visibility is
   * decided by `isLive()` in `src/lib/services/cms/publication.ts`; the older
   * `is_active` flag stays as a hint but is no longer what a student-facing
   * query trusts.
   */
  publicationState: publicationStateEnum("publication_state").notNull().default("published"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),

  /*
   * Import identity and provenance (migration 0017, the 105-passage library).
   *
   * These columns exist so the importer can be run twice without creating a
   * second copy of a passage, and so an imported passage can always be traced
   * back to the source package it came from. They are internal: nothing here is
   * shown to a student, and the learner-facing brand stays "Learners Area".
   */
  externalId: varchar("external_id", { length: 160 }),
  /** Test number in the source (1–33); null for a standalone passage. */
  testNo: integer("test_no"),
  /** Passage position inside its test (1–3); null when the source has none. */
  passageNo: integer("passage_no"),
  /** Source topic code (health, nature, tech, …) — used for library filters. */
  topicCode: varchar("topic_code", { length: 40 }),
  /** The "You should spend about 20 minutes…" instruction, kept verbatim. */
  instructions: text("instructions"),
  sourceWordCount: integer("source_word_count"),
  sourceQuestionCount: integer("source_question_count"),
  /** sha256 of the source document — the one thing that proves which text this is. */
  sourceChecksum: varchar("source_checksum", { length: 64 }),
  /** Source package identifier (internal only). */
  sourceRef: varchar("source_ref", { length: 80 }),
});

/**
 * A labelled paragraph of a passage.
 *
 * Paragraph letters are not decoration: "Which paragraph contains…" and
 * "Choose the correct heading for paragraph C" questions are unanswerable
 * without them, and a student reading the review needs to see the same letters
 * the question refers to. The passage's flat `body_text` is still written (older
 * code reads it, and Retention quotes from it); these rows are the structured
 * copy.
 */
export const readingPassageParagraphs = pgTable("reading_passage_paragraphs", {
  id: uuid("id").defaultRandom().primaryKey(),
  passageId: uuid("passage_id")
    .notNull()
    .references(() => readingPassages.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  /** "A" … "G" where the source labels paragraphs, otherwise null. */
  label: varchar("label", { length: 8 }),
  text: text("text").notNull(),
  isFootnote: boolean("is_footnote").notNull().default(false),
});

/**
 * A group of questions that share one instruction block ("Questions 1 – 8",
 * numbered headings, shared option lists).
 *
 * IELTS question groups are not a presentation detail: the instructions differ
 * per group ("Choose ONE WORD ONLY", "Choose TWO letters", "NB You may use any
 * letter more than once"), and a student practising by question type needs the
 * group to make sense of the question. `reading_questions.type_code` keeps the
 * source's own code (TFNG, NOTE, MH …) for that filtering.
 */
export const readingQuestionGroups = pgTable(
  "reading_question_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    passageId: uuid("passage_id")
      .notNull()
      .references(() => readingPassages.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    /** Source type code: TFNG, YNNG, MCQ, NOTE, MH, MI, SC, SAQ, FLOW, … */
    typeCode: varchar("type_code", { length: 16 }).notNull(),
    /** "Questions 1 – 8" */
    displayTitle: varchar("display_title", { length: 120 }),
    instructionsText: text("instructions_text"),
    fromQuestionNo: integer("from_question_no"),
    toQuestionNo: integer("to_question_no"),
    /** Shared options for heading/matching groups, as text. */
    sharedChoices: jsonb("shared_choices").$type<string[]>().notNull().default([]),
  },
  (table) => ({
    passagePositionIdx: uniqueIndex("reading_question_groups_passage_position_idx").on(
      table.passageId,
      table.position
    ),
  })
);

export const readingQuestions = pgTable("reading_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  passageId: uuid("passage_id").notNull().references(() => readingPassages.id, { onDelete: "cascade" }),
  order: integer("order").notNull(),
  type: readingQuestionTypeEnum("type").notNull(),
  questionText: text("question_text").notNull(),
  options: jsonb("options").$type<string[]>(), // multiple_choice only
  correctAnswer: text("correct_answer").notNull(),
  evidenceQuote: text("evidence_quote"),
  explanation: text("explanation").notNull(),

  /*
   * Imported detail (migration 0017).
   *
   * `type_code` keeps the source's own question type next to the four-value
   * enum the rest of the app grades with, so "practise Matching Headings" is
   * answerable without a second table. `accepted_answers` holds the alternatives
   * the source itself lists — real IELTS answers accept "12,000 francs" and
   * "12000 francs" alike, and marking one of those wrong because the string
   * differs would teach the student something false.
   */
  groupId: uuid("group_id").references(() => readingQuestionGroups.id, { onDelete: "cascade" }),
  /** Question number as printed in the paper (1–40 within a test). */
  questionNo: integer("question_no"),
  typeCode: varchar("type_code", { length: 16 }),
  /** Where the blank/selection sits in the prompt: {{q1}} → an input box. */
  answerSlots: jsonb("answer_slots")
    .$type<{ slotKey: string; token: string; control: string }[]>()
    .notNull()
    .default([]),
  /** Every string the source accepts, canonical answer first. */
  acceptedAnswers: jsonb("accepted_answers").$type<string[]>().notNull().default([]),
  /** {"maxWords": 1} — the source's own constraint, shown to the student. */
  answerConstraint: jsonb("answer_constraint").$type<Record<string, unknown>>(),
  renderMode: varchar("render_mode", { length: 32 }),
  /** Character offsets of the evidence inside the passage text (may be null). */
  evidenceStartChar: integer("evidence_start_char"),
  evidenceEndChar: integer("evidence_end_char"),
  /** source_marker | missing_source — where the evidence came from. */
  evidenceType: varchar("evidence_type", { length: 24 }),
  /** Source key ("q1"), kept for traceability. */
  sourceKey: varchar("source_key", { length: 40 }),
});

export const readingAttempts = pgTable("reading_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  passageId: uuid("passage_id").notNull().references(() => readingPassages.id),
  status: attemptStatusEnum("status").notNull().default("in_progress"),
  score: integer("score"),
  totalQuestions: integer("total_questions"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

export const readingAnswers = pgTable("reading_answers", {
  id: uuid("id").defaultRandom().primaryKey(),
  attemptId: uuid("attempt_id").notNull().references(() => readingAttempts.id, { onDelete: "cascade" }),
  questionId: uuid("question_id").notNull().references(() => readingQuestions.id, { onDelete: "cascade" }),
  userAnswer: text("user_answer").notNull().default(""),
  isCorrect: boolean("is_correct"),
});

// ---------------------------------------------------------------------------
// Listening — WIRED end-to-end, same exam -> auto-grade -> analysis pattern
// as Reading, with audio in place of a passage (reuses the Speaking upload/
// embed pipeline — see src/lib/embed.ts, /api/uploads).
// ---------------------------------------------------------------------------

/**
 * MCQ Mastery is a *staged* drill: the options must not exist on the student's
 * screen (or in their network tab) before they have committed to their own
 * answer. The stage is therefore persisted server-side and the API withholds
 * `options` until `revealed` — hiding them with CSS would be decoration, not
 * discipline.
 */
export const mcqMasteryStageEnum = pgEnum("mcq_mastery_stage", [
  "listen",
  "notes",
  "committed",
  "revealed",
  "chosen",
  "reasoned",
]);

export const listeningTests = pgTable("listening_tests", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  title: varchar("title", { length: 200 }).notNull(),
  audioType: materialTypeEnum("audio_type").notNull(),
  /** Nullable for the same reason as speaking_materials.primaryUrl. */
  audioUrl: text("audio_url"),
  transcript: text("transcript"), // optional, shown only in the post-attempt analysis
  difficultyLevel: varchar("difficulty_level", { length: 10 }).notNull().default("B2"),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Publication state and the moment a scheduled item opens. Visibility is
   * decided by `isLive()` in `src/lib/services/cms/publication.ts`; the older
   * `is_active` flag stays as a hint but is no longer what a student-facing
   * query trusts.
   */
  publicationState: publicationStateEnum("publication_state").notNull().default("published"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const listeningQuestions = pgTable("listening_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  testId: uuid("test_id").notNull().references(() => listeningTests.id, { onDelete: "cascade" }),
  order: integer("order").notNull(),
  type: listeningQuestionTypeEnum("type").notNull(),
  questionText: text("question_text").notNull(),
  options: jsonb("options").$type<string[]>(),
  correctAnswer: text("correct_answer").notNull(),
  explanation: text("explanation").notNull(),
  /**
   * Authored keywords, separated by "·". These are what the listener has to
   * catch to answer — they belong to the question, not to the audio, so they
   * are written by whoever writes the question. Empty means "not authored
   * yet", and is shown as nothing rather than guessed.
   */
  keywords: text("keywords"),
  /**
   * Audio → question paraphrase pairs. The gap between what is *said* and what
   * is *asked* is where most listening marks are lost, so the pair is stored
   * explicitly instead of being described in prose.
   */
  paraphrases: jsonb("paraphrases").$type<{ heard: string; asked: string }[]>(),
});

export const listeningAttempts = pgTable("listening_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  testId: uuid("test_id").notNull().references(() => listeningTests.id),
  status: attemptStatusEnum("status").notNull().default("in_progress"),
  score: integer("score"),
  totalQuestions: integer("total_questions"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

export const listeningAnswers = pgTable("listening_answers", {
  id: uuid("id").defaultRandom().primaryKey(),
  attemptId: uuid("attempt_id").notNull().references(() => listeningAttempts.id, { onDelete: "cascade" }),
  questionId: uuid("question_id").notNull().references(() => listeningQuestions.id, { onDelete: "cascade" }),
  userAnswer: text("user_answer").notNull().default(""),
  isCorrect: boolean("is_correct"),
});

/**
 * One student's staged run at one multiple-choice question.
 *
 * A practice drill, not an exam: nothing here feeds reading/listening scores or
 * the vocabulary SRS. It exists so a student can hear a question, write what
 * they understood, commit to an answer, and only then see the options.
 */
export const listeningMcqSessions = pgTable(
  "listening_mcq_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    testId: uuid("test_id").notNull().references(() => listeningTests.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => listeningQuestions.id, { onDelete: "cascade" }),
    stage: mcqMasteryStageEnum("stage").notNull().default("listen"),
    notes: text("notes"),
    ownAnswer: text("own_answer"),
    chosenAnswer: text("chosen_answer"),
    reasoning: text("reasoning"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userQuestion: uniqueIndex("listening_mcq_sessions_user_question_key").on(t.userId, t.questionId),
  })
);

// ---------------------------------------------------------------------------
// Grammar — WIRED end-to-end. Error-correction, multiple-choice for
// objective grading. Exercises can point back at one of the student's own
// writing submissions for context ("from your essay"); the sentence pairs
// themselves are authored content, not auto-extracted — a real
// grammar-error-extraction pass needs real NLP/AI, out of scope for the
// demo provider this phase uses (see REAL_AI_ENABLED).
// ---------------------------------------------------------------------------

export const grammarTopics = pgTable("grammar_topics", {
  id: uuid("id").defaultRandom().primaryKey(),
  skillArea: grammarSkillAreaEnum("skill_area").notNull().default("writing"),
  title: varchar("title", { length: 200 }).notNull(),
  explanation: text("explanation").notNull(),
  order: integer("order").notNull(),
});

export const grammarExercises = pgTable("grammar_exercises", {
  id: uuid("id").defaultRandom().primaryKey(),
  topicId: uuid("topic_id").notNull().references(() => grammarTopics.id, { onDelete: "cascade" }),
  order: integer("order").notNull(),
  promptText: text("prompt_text").notNull(), // the sentence to correct, with an error
  options: jsonb("options").$type<string[]>().notNull(),
  correctOption: text("correct_option").notNull(),
  explanation: text("explanation").notNull(),
  sourceSubmissionId: uuid("source_submission_id").references(() => writingSubmissions.id, {
    onDelete: "set null",
  }),
  /** Private essay-derived work stays owned after the source expires. Set by DB trigger. */
  sourceOwnerUserId: uuid("source_owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  /**
   * "Translate With It": a sentence in the student's own language that can only
   * be rendered correctly with the target structure. Authored content — the
   * engine never machine-translates anything.
   */
  translatePromptUz: text("translate_prompt_uz"),
  /**
   * The structures the translation must actually use. These are what the answer
   * is checked against — never the whole sentence, because two different correct
   * translations can share almost no words.
   */
  targetStructures: jsonb("target_structures").$type<string[]>(),
  /** "Activate It": a short task that forces the structure into free writing. */
  activationPrompt: text("activation_prompt"),
}, (table) => ({
  sourceOwnerIdx: index("grammar_exercises_source_owner_idx").on(table.sourceOwnerUserId, table.topicId),
}));

export const grammarActivityEnum = pgEnum("grammar_activity", [
  "correct_it",
  "translate_it",
  "activate_it",
]);

export const grammarAttempts = pgTable("grammar_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id").notNull().references(() => grammarExercises.id, { onDelete: "cascade" }),
  /** Which of the three activities produced this attempt. */
  activity: grammarActivityEnum("activity").notNull().default("correct_it"),
  /** Empty for the written activities; their text lives in `responseText`. */
  selectedOption: text("selected_option").notNull().default(""),
  /** The student's own sentence, for translate/activate. Null for multiple choice. */
  responseText: text("response_text"),
  isCorrect: boolean("is_correct").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Speaking materials — WIRED. Teacher/admin-posted content (Telegram-style:
// caption + a primary link + an optional second link), ownership-gated:
// any teacher/admin can post; only the poster or an isOwner=true account can
// edit/deactivate someone else's post. See src/lib/auth/ownership.ts.
// ---------------------------------------------------------------------------

export const speakingMaterials = pgTable("speaking_materials", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: speakingCategoryEnum("category").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  primaryType: materialTypeEnum("primary_type").notNull(),
  /**
   * Where the primary file is served from. Nullable on purpose: a resource can
   * be created in the CMS before its file is uploaded, and a demo/QA row can
   * honestly have no file at all. The UI shows an empty state instead of a
   * player pointing at a host that does not exist.
   */
  primaryUrl: text("primary_url"),
  primaryObjectKey: text("primary_object_key"), // storage key, for cleanup; null for link-type primaries
  primaryOriginalName: varchar("primary_original_name", { length: 255 }),
  primaryMimeType: varchar("primary_mime_type", { length: 120 }),
  primarySize: integer("primary_size"), // bytes
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Publication state and the moment a scheduled item opens. Visibility is
   * decided by `isLive()` in `src/lib/services/cms/publication.ts`; the older
   * `is_active` flag stays as a hint but is no longer what a student-facing
   * query trusts.
   */
  publicationState: publicationStateEnum("publication_state").notNull().default("published"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// A resource's description is an ordered list of mixed content blocks —
// not one textarea. See src/lib/services/storage for where block file/image/
// audio objects actually live; this table holds the block's own text/link
// data plus a reference to that object where relevant.
// ---------------------------------------------------------------------------
// Attached materials — WIRED (migration 0018)
//
// One description composer for every kind of content, instead of an uploader
// per module. A block belongs to an owner by (owner_type, owner_id); the owner
// is any of the eight content kinds the product has (see
// src/lib/services/resources/owners.ts, which is the only place that decides
// what an owner is and whether it may be read).
//
// There is deliberately no foreign key on owner_id: it points at eight different
// tables. The registry validates it on every write, and `authorizeResourceRead`
// validates it on every read, so an orphan row cannot be delivered to anyone.
// ---------------------------------------------------------------------------

export const resourceOwnerTypeEnum = pgEnum("resource_owner_type", [
  "lesson",
  "reading",
  "listening",
  "writing",
  "speaking",
  "grammar",
  "assignment",
  "live_class",
]);

export const resourceBlocks = pgTable(
  "resource_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerType: resourceOwnerTypeEnum("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    position: integer("position").notNull(),
    type: contentBlockTypeEnum("type").notNull(),
    textContent: text("text_content"), // type=text
    linkUrl: text("link_url"), // type=link
    objectKey: text("object_key"), // type=file|image|audio — private storage key
    originalName: varchar("original_name", { length: 255 }),
    mimeType: varchar("mime_type", { length: 120 }),
    size: integer("size"), // bytes, from the finalized upload intent
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerPositionIdx: uniqueIndex("resource_blocks_owner_position_idx").on(
      table.ownerType,
      table.ownerId,
      table.position
    ),
    ownerIdx: index("resource_blocks_owner_idx").on(table.ownerType, table.ownerId),
  })
);

export const materialBlocks = pgTable("material_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  materialId: uuid("material_id").notNull().references(() => speakingMaterials.id, { onDelete: "cascade" }),
  type: contentBlockTypeEnum("type").notNull(),
  position: integer("position").notNull(),
  textContent: text("text_content"), // type=text
  linkUrl: text("link_url"), // type=link
  objectUrl: text("object_url"), // type=file|image|audio — resolved, publicly reachable
  objectKey: text("object_key"), // type=file|image|audio — storage key, for cleanup
  originalName: varchar("original_name", { length: 255 }),
  mimeType: varchar("mime_type", { length: 120 }),
  size: integer("size"), // bytes
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Speaking practice — WIRED (prompt → record → upload to R2 → submit → history).
// Recordings are ordinary stored objects, so they go through the same
// upload-intent pipeline as every other file (see src/lib/data/uploads.ts) and
// are delivered through the same private /api/resources route.
//
// There is deliberately NO transcript or band-score column being faked here.
// `transcript` and `transcriptProvider` stay null unless a real
// SpeechToTextService is configured; the UI says so plainly rather than
// inventing analysis.
// ---------------------------------------------------------------------------

export const speakingPartEnum = pgEnum("speaking_part", ["part1", "part2", "part3", "general"]);

export const speakingAttemptStatusEnum = pgEnum("speaking_attempt_status", [
  "recording",
  "submitted",
  "reviewed",
]);

export const speakingPrompts = pgTable("speaking_prompts", {
  id: uuid("id").defaultRandom().primaryKey(),
  part: speakingPartEnum("part").notNull(),
  category: speakingCategoryEnum("category").notNull(),
  promptText: text("prompt_text").notNull(),
  cueCard: text("cue_card"), // Part 2 style notes shown during preparation
  prepSeconds: integer("prep_seconds").notNull().default(30),
  answerSeconds: integer("answer_seconds").notNull().default(90),
  followUps: jsonb("follow_ups").$type<string[]>().notNull().default([]),
  /**
   * Stable identity of a row imported from the canonical speaking master bank
   * (e.g. "P3-001-2"). NULL for hand-authored prompts. Partial unique index
   * makes the importer idempotent without touching the uuid primary key.
   */
  externalId: varchar("external_id", { length: 40 }),
  topic: varchar("topic", { length: 200 }),
  sourceClass: varchar("source_class", { length: 60 }),
  availableIn: jsonb("available_in").$type<string[]>().notNull().default(["practice_alone"]),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Publication state and the moment a scheduled item opens. Visibility is
   * decided by `isLive()` in `src/lib/services/cms/publication.ts`; the older
   * `is_active` flag stays as a hint but is no longer what a student-facing
   * query trusts.
   */
  publicationState: publicationStateEnum("publication_state").notNull().default("published"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  externalIdIdx: uniqueIndex("speaking_prompts_external_id_idx").on(table.externalId).where(sql`${table.externalId} is not null`),
}));

export const speakingAttempts = pgTable("speaking_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  promptId: uuid("prompt_id").references(() => speakingPrompts.id, { onDelete: "set null" }),
  part: speakingPartEnum("part").notNull(),
  status: speakingAttemptStatusEnum("status").notNull().default("recording"),
  // The recording object itself. Same private-by-default rules as any file.
  recordingObjectKey: text("recording_object_key"),
  recordingOriginalName: varchar("recording_original_name", { length: 255 }),
  recordingMimeType: varchar("recording_mime_type", { length: 120 }),
  recordingSize: integer("recording_size"), // bytes
  recordingDurationMs: integer("recording_duration_ms"),
  // Null until a transcript exists. Never a guess.
  transcript: text("transcript"),
  transcriptProvider: varchar("transcript_provider", { length: 60 }),
  /**
   * "stt"    — produced by the configured SpeechToTextService
   * "manual" — typed by the student, and labelled as such everywhere it shows
   *
   * Recording this is what keeps the UI honest: a typed transcript is never
   * presented as machine transcription, and an evaluation of it says so.
   */
  transcriptOrigin: varchar("transcript_origin", { length: 10 }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Vocabulary engine — WIRED (add, review, mastery state) in Phase 1
// ---------------------------------------------------------------------------

export const lexemes = pgTable(
  "lexemes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    term: varchar("term", { length: 120 }).notNull(),
    partOfSpeech: varchar("part_of_speech", { length: 30 }),
    definitionEn: text("definition_en").notNull(),
    translationUz: text("translation_uz"),
    exampleSentence: text("example_sentence"),
    /**
     * Collocations ("ease congestion · traffic congestion"), separated by "·".
     * A word is only really learned with the words it keeps company with, so the
     * flashcard shows them next to the example — but they are optional, and an
     * empty value is shown as nothing rather than as an invented phrase.
     */
    collocations: text("collocations"),
    /**
     * Spelling + part of speech + English meaning — the identity of a *sense*.
     *
     * The spelling alone is not an identity: "resilient (able to recover)" and
     * "resilient (springing back into shape)" are two different words, and a
     * catalogue unique on the spelling alone would force one of them to borrow
     * the other's definition. This index is what lets both exist with their own
     * meaning, while the same sense added twice still resolves to one row.
     */
    senseKey: varchar("sense_key", { length: 200 }).notNull().default(""),
    /**
     * Every answer the centre accepts for this word's translation challenge
     * (`["congestion", "traffic congestion"]`). Authored, never generated — an
     * empty list simply means the term itself is the only accepted answer.
     */
    acceptedTranslations: jsonb("accepted_translations").$type<string[]>().notNull().default([]),

    /*
     * Where this entry came from and how far it can be trusted (0017).
     *
     * The shared lexicon is fed from more than one place now, and the two are
     * not equally certain: a word typed in by a teacher is authored, while a
     * definition that was derived mechanically during the reading import is a
     * proposal. Recording which is which keeps the honesty of the word card
     * possible — an unverified meaning is marked as one instead of being
     * presented as centre-approved.
     */
    provenance: varchar("provenance", { length: 20 }),
    verificationStatus: varchar("verification_status", { length: 24 }),
    importBatch: varchar("import_batch", { length: 80 }),
    /**
     * The LEXEME (lexical unit) this sense belongs to (0029). This row's own id
     * stays the sense identity: nothing that references `lexemes.id` changed.
     */
    lexicalUnitId: uuid("lexical_unit_id").references((): AnyPgColumn => lexicalUnits.id, { onDelete: "restrict" }),
  },
  (table) => ({
    termIdx: index("lexemes_term_idx").on(table.term),
    unitIdx: index("lexemes_lexical_unit_idx").on(table.lexicalUnitId),
    senseKeyIdx: uniqueIndex("lexemes_sense_key_idx").on(table.senseKey),
  })
);

/**
 * One place a word actually appears in a reading passage.
 *
 * This is what makes "Save to Vocabulary" honest: the student keeps the word
 * *and the sentence it was met in*, and the flashcard can show that sentence
 * instead of an invented example. The lexeme row is the shared global lexicon —
 * the same word met in a second passage reuses it and simply gains another
 * occurrence.
 *
 * Offsets are character positions inside the passage's paragraph text, which is
 * how the reader knows which word was tapped without sending the whole passage
 * back to the server.
 */
export const lexicalOccurrences = pgTable(
  "lexical_occurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The exact SENSE. Null only while `resolution_status` is not "resolved" (DB CHECK). */
    lexemeId: uuid("lexeme_id").references(() => lexemes.id, { onDelete: "cascade" }),
    /** reading | listening | video — exactly one matching source column is set (DB CHECK). */
    sourceType: varchar("source_type", { length: 16 }).notNull().default("reading"),
    passageId: uuid("passage_id").references(() => readingPassages.id, { onDelete: "cascade" }),
    listeningTestId: uuid("listening_test_id").references(() => listeningTests.id, { onDelete: "cascade" }),
    videoLessonId: uuid("video_lesson_id").references((): AnyPgColumn => videoLessons.id, { onDelete: "cascade" }),
    /** Listening section (1–4); offsets are then relative to that section's transcript. */
    sectionNumber: smallint("section_number"),
    /** Audio time of the span when the source has word timing; null = not available, never estimated. */
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    /** Candidate lexeme for an unresolved span (no sense chosen). */
    lexicalUnitId: uuid("lexical_unit_id").references((): AnyPgColumn => lexicalUnits.id, { onDelete: "set null" }),
    /** resolved | unresolved | review */
    resolutionStatus: varchar("resolution_status", { length: 16 }).notNull().default("resolved"),
    /** Who linked the sense: e.g. "reading_import", "listening_package". */
    resolutionSource: varchar("resolution_source", { length: 24 }),
    /** Segment key inside the source package ("p1") — internal traceability. */
    segmentKey: varchar("segment_key", { length: 40 }),
    surfaceForm: varchar("surface_form", { length: 120 }).notNull(),
    startChar: integer("start_char").notNull(),
    endChar: integer("end_char").notNull(),
    /** The whole sentence, verbatim — the context the student met the word in. */
    sentenceText: text("sentence_text"),
    occurrenceType: varchar("occurrence_type", { length: 24 }),
    /** The import marked this as worth learning; false = incidental match. */
    isTargetVocabulary: boolean("is_target_vocabulary").notNull().default(false),
  },
  (table) => ({
    passageOffsetIdx: uniqueIndex("lexical_occurrences_passage_offset_idx").on(
      table.passageId,
      table.startChar,
      table.endChar
    ),
    lexemeIdx: index("lexical_occurrences_lexeme_idx").on(table.lexemeId),
    listeningOffsetIdx: uniqueIndex("lexical_occurrences_listening_offset_idx")
      .on(table.listeningTestId, table.sectionNumber, table.startChar, table.endChar)
      .where(sql`listening_test_id IS NOT NULL`),
    unitIdx: index("lexical_occurrences_unit_idx").on(table.lexicalUnitId),
  })
);

/**
 * A student's word library entry — the ONE shared vocabulary engine.
 *
 * Every module (reading, listening, writing, speaking, grammar, the Coach) adds
 * words here; nothing keeps its own private word list. Two columns carry the
 * scheduling:
 *
 *   srs_stage  index into SRS_INTERVALS (1 / 3 / 7 / 16 / 35 days); -1 means
 *              "new, never scheduled", which is what a freshly added word is.
 *   mastery    the human-visible ladder NEW -> LEARNING -> KNOWN -> ACTIVE ->
 *              MASTERED. It is derived from real recall plus real use, never
 *              from a game score.
 *
 * `sense_key` is the deduplication identity: the same spelling can legitimately
 * exist twice with different meanings ("bank" of a river / "bank" of money), so
 * a word is a duplicate only when spelling AND sense agree.
 */
export const userVocabulary = pgTable(
  "user_vocabulary",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    lexemeId: uuid("lexeme_id").notNull().references(() => lexemes.id, { onDelete: "restrict" }),
    state: vocabStateEnum("state").notNull().default("new"),
    sourceType: varchar("source_type", { length: 40 }), // e.g. "reading", "writing_feedback", "manual"
    sourceId: uuid("source_id"),
    /** Small immutable encounter snapshot; survives source deletion, follows user retention. */
    sourceSnapshot: jsonb("source_snapshot").$type<import("@/lib/services/lexical/context").VocabularySourceSnapshot>(),
    /** Folder in the personal library; null means "unfiled". */
    folderId: uuid("folder_id").references(() => vocabFolders.id, { onDelete: "set null" }),
    /** Topic pack a word arrived from ("health_medicine", "work_career", …). */
    topicPack: varchar("topic_pack", { length: 60 }),
    /** Spelling + sense, lowercased — the dedup identity within one library. */
    senseKey: varchar("sense_key", { length: 200 }),
    /** Index into SRS_INTERVALS; -1 = not scheduled yet. */
    srsStage: integer("srs_stage").notNull().default(-1),
    /** NEW | LEARNING | KNOWN | ACTIVE | MASTERED (see lib/services/vocabulary). */
    mastery: varchar("mastery", { length: 20 }).notNull().default("new"),
    correctCount: integer("correct_count").notNull().default(0),
    incorrectCount: integer("incorrect_count").notNull().default(0),
    activeUseCount: integer("active_use_count").notNull().default(0),
    intervalDays: integer("interval_days").notNull().default(0),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }).defaultNow().notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    masteredAt: timestamp("mastered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** Exposure (0029): first/last time this learner met this sense in a source, and how often. */
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    seenCount: integer("seen_count").notNull().default(1),
  },
  (table) => ({
    libraryIdx: index("user_vocabulary_user_idx").on(table.userId, table.nextReviewAt),
    senseIdx: index("user_vocabulary_sense_idx").on(table.userId, table.senseKey),
  })
);

/**
 * The LEXEME layer (0029): one canonical lexical unit — language + normalized
 * lemma + part of speech + lexical type. Its senses are `lexemes` rows.
 */
export const lexicalUnits = pgTable(
  "lexical_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    language: varchar("language", { length: 8 }).notNull().default("en"),
    lemma: varchar("lemma", { length: 120 }).notNull(),
    lemmaNorm: varchar("lemma_norm", { length: 120 }).notNull(),
    partOfSpeech: varchar("part_of_speech", { length: 30 }).notNull().default(""),
    lexicalType: varchar("lexical_type", { length: 24 }).notNull().default("word"),
    isFunctionWord: boolean("is_function_word").notNull().default(false),
    provenance: varchar("provenance", { length: 24 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    identityIdx: uniqueIndex("lexical_units_identity_idx").on(table.language, table.lemmaNorm, table.partOfSpeech, table.lexicalType),
  })
);

/** Surface forms of a unit (lemma, regular/irregular inflections, authored variants). */
export const lexicalUnitForms = pgTable(
  "lexical_unit_forms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lexicalUnitId: uuid("lexical_unit_id").notNull().references(() => lexicalUnits.id, { onDelete: "cascade" }),
    form: varchar("form", { length: 160 }).notNull(),
    formNorm: varchar("form_norm", { length: 160 }).notNull(),
    formType: varchar("form_type", { length: 16 }).notNull(),
  },
  (table) => ({
    unitFormIdx: uniqueIndex("lexical_unit_forms_unit_form_idx").on(table.lexicalUnitId, table.formNorm),
    formIdx: index("lexical_unit_forms_form_idx").on(table.formNorm),
  })
);

/** Pronunciation of a unit. No row = not known; a pronunciation is never fabricated. */
export const lexicalUnitPronunciations = pgTable(
  "lexical_unit_pronunciations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lexicalUnitId: uuid("lexical_unit_id").notNull().references(() => lexicalUnits.id, { onDelete: "cascade" }),
    ipa: varchar("ipa", { length: 120 }).notNull(),
    variant: varchar("variant", { length: 8 }).notNull().default(""),
    audioObjectKey: text("audio_object_key"),
    provenance: varchar("provenance", { length: 24 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    unitVariantIdx: uniqueIndex("lexical_unit_pronunciations_unit_variant_idx").on(table.lexicalUnitId, table.variant),
  })
);

/**
 * Every place THIS learner met a saved sense (0029). Many per student item;
 * the snapshot survives source deletion (occurrence_id then becomes null).
 */
export const userVocabularyContexts = pgTable(
  "user_vocabulary_contexts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userVocabularyId: uuid("user_vocabulary_id").notNull().references(() => userVocabulary.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    occurrenceId: uuid("occurrence_id").references(() => lexicalOccurrences.id, { onDelete: "set null" }),
    sourceType: varchar("source_type", { length: 16 }).notNull(),
    sourceId: uuid("source_id"),
    snapshot: jsonb("snapshot").$type<import("@/lib/services/lexical/context").VocabularySourceSnapshot>().notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    itemOccurrenceIdx: uniqueIndex("user_vocabulary_contexts_item_occurrence_idx").on(table.userVocabularyId, table.occurrenceId),
    userIdx: index("user_vocabulary_contexts_user_idx").on(table.userId, table.userVocabularyId),
    occurrenceIdx: index("user_vocabulary_contexts_occurrence_idx").on(table.occurrenceId),
  })
);

/** A folder in the personal library ("IELTS Writing", "Medicine", …). */
export const vocabFolders = pgTable(
  "vocab_folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerNameIdx: uniqueIndex("vocab_folders_owner_name_idx").on(table.userId, table.name),
  })
);

/**
 * The points ledger behind the private leaderboard and the streak.
 *
 * Scoring is server-side and idempotent: every award carries a `dedupe_key`
 * built from the thing that earned it (a word id, a review event, a game
 * answer, a sentence). Replaying a request therefore adds nothing, which is what
 * makes "points = 999999" from a client impossible rather than merely rude.
 */
export const vocabPointEvents = pgTable(
  "vocab_point_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** new_word | revision | game_answer | sentence */
    kind: varchar("kind", { length: 30 }).notNull(),
    refType: varchar("ref_type", { length: 40 }),
    refId: varchar("ref_id", { length: 80 }),
    points: integer("points").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    dedupeIdx: uniqueIndex("vocab_point_events_dedupe_idx").on(table.dedupeKey),
    userIdx: index("vocab_point_events_user_idx").on(table.userId, table.createdAt),
  })
);

// ---------------------------------------------------------------------------
// Assignments & teacher feedback loop — WIRED (minimal) in Phase 1
// ---------------------------------------------------------------------------

export const assignments = pgTable("assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  targetUserId: uuid("target_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  relatedWritingPromptId: uuid("related_writing_prompt_id").references(() => writingPrompts.id),
  status: assignmentStatusEnum("status").notNull().default("not_started"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 60 }).notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// SCHEMA-ONLY / not wired to UI yet — modeled now so nothing needs a rewrite
// when these phases start. Listed in the delivery report as REMAINING.
// ---------------------------------------------------------------------------

export const liveClasses = pgTable("live_classes", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  teacherUserId: uuid("teacher_user_id").references(() => users.id),
  title: varchar("title", { length: 200 }).notNull(),
  topic: text("topic"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  meetingUrl: text("meeting_url"),
  recordingUrl: text("recording_url"),
  status: liveClassStatusEnum("status").notNull().default("upcoming"),
});

export const liveClassAttendance = pgTable("live_class_attendance", {
  id: uuid("id").defaultRandom().primaryKey(),
  liveClassId: uuid("live_class_id").notNull().references(() => liveClasses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * "Report a problem" — what the student saw, attached to the page they were on.
 *
 * The context column holds only values the server will accept back (route,
 * module, viewport, build, last error code). It deliberately has no field for
 * anything a browser might volunteer, so a report can never smuggle a token, a
 * password or a private text into the support inbox.
 */
export const problemReports = pgTable("problem_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  route: varchar("route", { length: 200 }).notNull(),
  module: varchar("module", { length: 60 }).notNull(),
  message: text("message").notNull(),
  viewport: varchar("viewport", { length: 20 }),
  build: varchar("build", { length: 60 }),
  lastErrorCode: varchar("last_error_code", { length: 120 }),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const mockTests = pgTable("mock_tests", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  skill: varchar("skill", { length: 20 }).notNull(), // listening | reading | writing | speaking | full
});

export const mockAttempts = pgTable("mock_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mockTestId: uuid("mock_test_id").notNull().references(() => mockTests.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  rawScore: real("raw_score"),
  estimatedBand: real("estimated_band"),
  skillBreakdown: jsonb("skill_breakdown"),
});

// Future billing — schema exists, BILLING_ENABLED flag keeps it dark
export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
});

export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
});

export const prices = pgTable("prices", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("UZS"),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  status: varchar("status", { length: 30 }).notNull().default("inactive"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
});

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 40 }), // click | payme | stripe | ...
  amountCents: integer("amount_cents").notNull(),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accessEntitlements = pgTable("access_entitlements", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  grantedVia: varchar("granted_via", { length: 40 }).notNull().default("demo"), // demo | purchase | teacher_grant
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Coach evaluations — the persistent record of WHO evaluated WHAT, and the
// shared learner weakness memory every evaluator feeds.
//
// Provider identity is stored per row, not read from configuration at display
// time: if AI_PRIMARY_PROVIDER changes tomorrow, yesterday's evaluation must
// still say which evaluator produced it, and `fallback_used` /
// `fallback_from` must still say that RIWI took over after a failure.
// ---------------------------------------------------------------------------

export const evaluationTypeEnum = pgEnum("evaluation_type", [
  "writing",
  "speaking",
  "grammar",
  "vocabulary",
  "assignment",
]);

export const providerTypeEnum = pgEnum("provider_type", ["internal", "external"]);

export const weaknessStatusEnum = pgEnum("weakness_status", ["open", "improving", "resolved"]);

export const verdictEnum = pgEnum("evaluation_verdict", [
  "correct",
  "mostly_correct",
  "needs_correction",
]);

export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    evaluationType: evaluationTypeEnum("evaluation_type").notNull(),
    // "writing_submission" | "speaking_attempt" | "grammar_exercise" | ...
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceId: uuid("source_id").notNull(),

    providerId: varchar("provider_id", { length: 60 }).notNull(),
    providerDisplayName: varchar("provider_display_name", { length: 80 }).notNull(),
    providerType: providerTypeEnum("provider_type").notNull(),
    providerVersion: varchar("provider_version", { length: 40 }).notNull(),
    model: varchar("model", { length: 120 }),
    promptVersion: varchar("prompt_version", { length: 40 }).notNull(),
    rubricVersion: varchar("rubric_version", { length: 40 }).notNull(),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    fallbackFrom: varchar("fallback_from", { length: 60 }),
    /**
     * Denormalised display label of the evaluator that produced this row, so the
     * "Checked by …" label keeps working even if that provider is later removed
     * from the registry.
     */
    checkedByName: varchar("checked_by_name", { length: 80 }).notNull(),

    overallEstimate: real("overall_estimate"),
    confidence: real("confidence").notNull().default(0),
    verdict: verdictEnum("verdict"),
    criteria: jsonb("criteria").$type<
      {
        key: string;
        label: string;
        band: number | null;
        limited?: boolean;
        note?: string | null;
      }[]
    >()
      .notNull()
      .default([]),
    strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
    weaknesses: jsonb("weaknesses").$type<string[]>().notNull().default([]),
    issues: jsonb("issues").$type<
      {
        category: string;
        message: string;
        excerpt?: string | null;
        suggestion?: string | null;
        severity: string;
      }[]
    >()
      .notNull()
      .default([]),
    nextActions: jsonb("next_actions").$type<string[]>().notNull().default([]),
    recommendedExercises: jsonb("recommended_exercises").$type<
      { kind: string; label: string; href?: string | null; reason?: string | null }[]
    >()
      .notNull()
      .default([]),
    processedInMs: integer("processed_in_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Exactly one authoritative evaluation per submission. A retry, a double
    // click or a second request for the same submission reuses this row instead
    // of paying a provider twice or producing two competing verdicts.
    oneEvaluationPerSource: uniqueIndex("evaluations_source_unique").on(
      table.sourceType,
      table.sourceId
    ),
  })
);

export const coachWeaknesses = pgTable(
  "coach_weaknesses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Canonical category from src/lib/services/coach/schema.ts — one vocabulary for every provider. */
    category: varchar("category", { length: 40 }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    occurrenceCount: integer("occurrence_count").notNull().default(0),
    /** low | medium | high — recency-weighted, so old noise cannot dominate. */
    recentSeverity: varchar("recent_severity", { length: 10 }).notNull().default("low"),
    status: weaknessStatusEnum("status").notNull().default("open"),
  },
  (table) => ({
    oneRowPerCategory: uniqueIndex("coach_weaknesses_unique").on(table.userId, table.category),
  })
);

// ---------------------------------------------------------------------------
// Coach input artifacts: the work a student produced that gets evaluated.
// An evaluation points at one of these rows, and the row keeps the original
// text so feedback can never be shown without the work it refers to.
// ---------------------------------------------------------------------------

/**
 * Sentence Bank: a student's own sentences using their own words.
 *
 * A sentence that the RIWI evaluator accepted earns the highest vocabulary
 * award (5 points); a sentence the student wrote but that was not evaluated
 * stays visible with its honest origin and earns nothing. The bank never claims
 * an evaluation that did not happen.
 */
export const vocabularyUsages = pgTable("vocabulary_usages", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userVocabularyId: uuid("user_vocabulary_id")
    .notNull()
    .references(() => userVocabulary.id, { onDelete: "cascade" }),
  sentence: text("sentence").notNull(),
  /** manual | riwi — who judged the sentence, if anybody did. */
  origin: varchar("origin", { length: 20 }).notNull().default("manual"),
  riwiAccepted: boolean("riwi_accepted").notNull().default(false),
  evaluationId: uuid("evaluation_id"),
  pointsAwarded: integer("points_awarded").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const assignmentResponses = pgTable("assignment_responses", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignmentId: uuid("assignment_id")
    .notNull()
    .references(() => assignments.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Public video lessons — YouTube/TED-scale video as a LESSON, not an iframe.
//
// The centre stores a structured reference (provider + video id) rather than an
// arbitrary embed snippet: the id is validated server-side and the only origin
// the Content-Security-Policy allows to be framed is the video provider (see
// src/lib/services/video/provider.ts and src/lib/http/security-headers.ts).
//
// The transcript is authored/licensed/attributed data — never scraped from a
// third party just because the video is publicly embeddable (see
// `transcriptSource` and `transcriptAttribution`).
// ---------------------------------------------------------------------------

export const videoLessonStageEnum = pgEnum("video_lesson_stage", ["comprehension", "gap_fill"]);

export const videoLessonStateEnum = pgEnum("video_lesson_state", [
  "not_started",
  "in_progress",
  "completed",
]);

export const videoLessons = pgTable(
  "video_lessons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /**
     * The roadmap lesson this video belongs to (legacy, one video per lesson),
     * or NULL for a standalone TED / Podcast item authored in Management with
     * its own native URL (/video-lessons/:id). Nullable since 0024.
     */
    lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
    /** Provider id, e.g. "youtube". Kept generic so another host can be added. */
    provider: varchar("provider", { length: 30 }).notNull().default("youtube"),
    /** The provider's own video id — validated, never a raw URL or embed HTML. */
    videoId: varchar("video_id", { length: 40 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    /** "Before you watch": a prediction prompt and the focus of the video. */
    beforeYouWatch: text("before_you_watch"),
    /** Duration in seconds when known; drives the honest completion rule. */
    durationSeconds: integer("duration_seconds"),
    /**
     * Authored transcript lines: `[{ startSeconds, text }]`. Empty when the
     * centre has no legitimate transcript — the video still works, the
     * transcript-dependent tabs simply do not exist.
     */
    transcript: jsonb("transcript").$type<{ startSeconds: number; text: string }[]>(),
    /** authored | licensed | permitted — where the transcript came from. */
    transcriptSource: varchar("transcript_source", { length: 20 }),
    transcriptAttribution: varchar("transcript_attribution", { length: 200 }),
    /**
     * Optional owner-authored PLAIN transcript (paragraphs, no timestamps). Used
     * when no timed `transcript` lines exist; provenance fields apply to both.
     */
    transcriptText: text("transcript_text"),
    /**
     * Centre-authored study notes for the video (PART 1: TED / PODCAST is a
     * standalone module managed from Management). Optional like the transcript:
     * null means there is nothing to reveal, and the learner surface then shows
     * no notes control at all rather than an empty one.
     */
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * Publication state and the moment a scheduled item opens. Visibility is
     * decided by `isLive()` in `src/lib/services/cms/publication.ts`; the older
     * `is_active` flag stays as a hint but is no longer what a student-facing
     * query trusts.
     */
    publicationState: publicationStateEnum("publication_state").notNull().default("published"),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    lessonIdx: uniqueIndex("video_lessons_lesson_idx").on(table.lessonId),
    videoIdx: uniqueIndex("video_lessons_video_idx").on(table.provider, table.videoId),
  })
);

export const videoLessonQuestions = pgTable(
  "video_lesson_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoLessonId: uuid("video_lesson_id")
      .notNull()
      .references(() => videoLessons.id, { onDelete: "cascade" }),
    stage: videoLessonStageEnum("stage").notNull(),
    position: integer("position").notNull(),
    prompt: text("prompt").notNull(),
    /** Every answer the centre accepts; deterministic, authored, never invented. */
    acceptedAnswers: jsonb("accepted_answers").$type<string[]>().notNull(),
    /** Seconds into the video this question refers to, when authored. */
    atSeconds: integer("at_seconds"),
  },
  (table) => ({
    lessonStageIdx: index("video_lesson_questions_lesson_idx").on(table.videoLessonId, table.stage, table.position),
  })
);

export const videoLessonProgress = pgTable(
  "video_lesson_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    videoLessonId: uuid("video_lesson_id")
      .notNull()
      .references(() => videoLessons.id, { onDelete: "cascade" }),
    state: videoLessonStateEnum("state").notNull().default("not_started"),
    /**
     * Furthest point the player reported, in seconds. Monotonic: a reload or a
     * seek backwards never lowers it, and the server clamps it to the authored
     * duration so a client cannot claim more than the video has.
     */
    watchedSeconds: integer("watched_seconds").notNull().default(0),
    /** Graded authored answers: `{ [questionId]: { answer, correct } }`. */
    answers: jsonb("answers").$type<Record<string, { answer: string; correct: boolean }>>(),
    /** "Your opinion" — the student's own response, kept for teacher feedback. */
    responseText: text("response_text"),
    /** "Summary" — written recall of the video. */
    summaryText: text("summary_text"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userLessonIdx: uniqueIndex("video_lesson_progress_user_idx").on(table.userId, table.videoLessonId),
  })
);

// ---------------------------------------------------------------------------
// Retention — the memory system (learner) and its content bank (owner)
// ---------------------------------------------------------------------------
//
// Deliberately NOT reading passages. The old learner "Retention" drill borrowed
// a Reading passage, hid it with CSS and scored nothing; it is replaced by a
// dedicated bank of versioned memory texts whose meaning is graded against an
// author-supplied Measurement Structure.
//
// Four tables, and the reason each exists:
//
//   retention_texts            the LOGICAL text ("B1-007"). Stable identity:
//                              rotation is by this id, so re-versioning a text can
//                              never make a learner see it twice in one cycle.
//   retention_text_versions    the IMMUTABLE content of that text: body, word
//                              count, Measurement Structure. An attempt points at
//                              one of these, so editing the bank never rewrites
//                              a historical result.
//   retention_attempts         one learner's run: deadlines, draft, score,
//                              breakdown, evaluator version.
//   retention_rotation_state   the learner's cycle per level, plus which texts
//                              that cycle has already used.
//
// Deleting a logical text is an ARCHIVE (`active = false`): nothing that a
// learner's history points at is ever removed, and the archive/restore actions
// never create or destroy a version.

export const retentionLevelEnum = pgEnum("retention_level", ["A2", "B1", "B2", "C1", "C2"]);

/**
 * `reading` and `recall` are the two live states; `completed` and `timed_out` are
 * terminal. The phase a learner is in is derived from the persisted deadlines,
 * never stored twice — but the terminal outcome IS stored, so a finished attempt
 * can never be re-scored or re-timed.
 */
export const retentionAttemptStatusEnum = pgEnum("retention_attempt_status", [
  "reading",
  "recall",
  "completed",
  "timed_out",
]);

export const retentionTexts = pgTable(
  "retention_texts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    level: retentionLevelEnum("level").notNull(),
    /** Auto-generated stable label: `B1-007`. Never derived from row position. */
    internalLabel: varchar("internal_label", { length: 20 }).notNull(),
    /** Monotonic per level; the label's numeric half, allocated under a lock. */
    sequence: integer("sequence").notNull(),
    /** FALSE = archived: out of future rotation, history untouched. */
    active: boolean("active").notNull().default(true),
    /**
     * The version new attempts receive. The composite foreign key added in
     * migration 0022 makes it impossible for this column to point at a version
     * belonging to a different text.
     */
    currentVersionId: uuid("current_version_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    labelIdx: uniqueIndex("retention_texts_label_idx").on(table.internalLabel),
    levelSequenceIdx: uniqueIndex("retention_texts_level_sequence_idx").on(table.level, table.sequence),
    levelActiveIdx: index("retention_texts_level_active_idx").on(table.level, table.active),
  })
);

export const retentionTextVersions = pgTable(
  "retention_text_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    retentionTextId: uuid("retention_text_id")
      .notNull()
      .references(() => retentionTexts.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    bodyText: text("body_text").notNull(),
    wordCount: integer("word_count").notNull(),
    /** Validated Measurement Structure V1. Data, never code. */
    scoringStructure: jsonb("scoring_structure").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: uniqueIndex("retention_text_versions_text_version_idx").on(table.retentionTextId, table.versionNumber),
    /** Target of the composite FK from `retention_texts.current_version_id`. */
    identityIdx: uniqueIndex("retention_text_versions_identity_idx").on(table.id, table.retentionTextId),
  })
);

export const retentionAttempts = pgTable(
  "retention_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * RESTRICT, not CASCADE: archiving a text must never delete the attempts
     * that reference it, and a version a learner was graded against must stay
     * exactly where it is. Content is archived, history is kept.
     */
    retentionTextId: uuid("retention_text_id")
      .notNull()
      .references(() => retentionTexts.id, { onDelete: "restrict" }),
    retentionTextVersionId: uuid("retention_text_version_id")
      .notNull()
      .references(() => retentionTextVersions.id, { onDelete: "restrict" }),
    level: retentionLevelEnum("level").notNull(),
    /** Which rotation cycle this attempt belongs to. */
    rotationCycle: integer("rotation_cycle").notNull().default(1),
    status: retentionAttemptStatusEnum("status").notNull().default("reading"),
    readStartedAt: timestamp("read_started_at", { withTimezone: true }).notNull(),
    readEndsAt: timestamp("read_ends_at", { withTimezone: true }).notNull(),
    writeStartedAt: timestamp("write_started_at", { withTimezone: true }).notNull(),
    writeEndsAt: timestamp("write_ends_at", { withTimezone: true }).notNull(),
    /** The latest persisted draft. Survives refresh, remount and connection loss. */
    recallText: text("recall_text").notNull().default(""),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    score: integer("score"),
    scoreBreakdown: jsonb("score_breakdown"),
    evaluatorVersion: varchar("evaluator_version", { length: 60 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userHistoryIdx: index("retention_attempts_user_history_idx").on(table.userId, table.createdAt),
    userLevelIdx: index("retention_attempts_user_level_idx").on(table.userId, table.level, table.status),
    versionUsageIdx: index("retention_attempts_version_usage_idx").on(table.retentionTextVersionId),
    textUsageIdx: index("retention_attempts_text_usage_idx").on(table.retentionTextId),
    cycleIdx: index("retention_attempts_cycle_idx").on(table.userId, table.level, table.rotationCycle),
  })
);

export const retentionRotationState = pgTable(
  "retention_rotation_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    level: retentionLevelEnum("level").notNull(),
    cycleNumber: integer("cycle_number").notNull().default(1),
    /** The last text this learner finished, so a new cycle cannot repeat it. */
    lastCompletedTextId: uuid("last_completed_text_id").references(() => retentionTexts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userLevelIdx: uniqueIndex("retention_rotation_state_user_level_idx").on(table.userId, table.level),
  })
);

/**
 * What the learner has already been given in the current cycle.
 *
 * Terminal outcomes only — a completed attempt and a legitimately timed-out one
 * both count as "used" (rotation is about exposure, not success), while an
 * abandoned-but-live attempt is still the learner's active attempt and is not a
 * repeat at all. Version changes are not recorded here: rotation identity is the
 * logical text.
 */
export const retentionRotationCompletions = pgTable(
  "retention_rotation_completions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    level: retentionLevelEnum("level").notNull(),
    cycleNumber: integer("cycle_number").notNull(),
    retentionTextId: uuid("retention_text_id")
      .notNull()
      .references(() => retentionTexts.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueCompletion: uniqueIndex("retention_rotation_completions_unique_idx").on(
      table.userId,
      table.level,
      table.cycleNumber,
      table.retentionTextId
    ),
  })
);

// ---------------------------------------------------------------------------
// Live Partner (N10). Server-authoritative presence/invite/session metadata.
// No audio, transcript or signalling history is ever stored here.
// ---------------------------------------------------------------------------
export const livePartnerStateEnum = pgEnum("live_partner_state", [
  "offline", "available", "outgoing_invite", "incoming_invite", "connecting", "in_call", "reconnecting",
]);
export const livePartnerInviteStatusEnum = pgEnum("live_partner_invite_status", ["pending", "accepted", "declined", "cancelled", "expired"]);

export const livePartnerPresence = pgTable("live_partner_presence", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  state: livePartnerStateEnum("state").notNull().default("offline"),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  sessionId: uuid("session_id"),
  rulesVersion: integer("rules_version"),
  rulesAcceptedAt: timestamp("rules_accepted_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  stateIdx: index("live_partner_presence_state_idx").on(table.state, table.heartbeatAt),
}));

export const livePartnerInvites = pgTable("live_partner_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  fromUserId: uuid("from_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  toUserId: uuid("to_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: livePartnerInviteStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
}, (table) => ({
  onePendingFrom: uniqueIndex("live_partner_invites_one_pending_from_idx").on(table.fromUserId).where(sql`${table.status} = 'pending'`),
  toIdx: index("live_partner_invites_to_idx").on(table.toUserId, table.status),
}));

export const livePartnerSessions = pgTable("live_partner_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull().unique().references(() => livePartnerInvites.id, { onDelete: "cascade" }),
  userA: uuid("user_a").notNull().references(() => users.id, { onDelete: "cascade" }),
  userB: uuid("user_b").notNull().references(() => users.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endReason: varchar("end_reason", { length: 40 }),
  connectionOutcome: varchar("connection_outcome", { length: 40 }),
});

export const livePartnerBlocks = pgTable("live_partner_blocks", {
  blockerId: uuid("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  blockedId: uuid("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: uniqueIndex("live_partner_blocks_pair_idx").on(table.blockerId, table.blockedId),
}));

/** Native full-listening source; never serialized into an active exam. */
export const listeningPackages = pgTable("listening_packages", {
  testId: uuid("test_id").primaryKey().references(() => listeningTests.id, { onDelete: "cascade" }),
  sourceId: varchar("source_id", { length: 80 }).notNull().unique(),
  payload: jsonb("payload").$type<import("../lib/listening/package").ListeningPackage>().notNull(),
  audioObjectKey: text("audio_object_key").notNull(),
  imageObjectKey: text("image_object_key"),
  sourceHash: varchar("source_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const listeningActivityRuns = pgTable("listening_activity_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  testId: uuid("test_id").notNull().references(() => listeningPackages.testId, { onDelete: "cascade" }),
  activity: integer("activity").notNull(),
  speedRate: real("speed_rate"),
  answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
  score: integer("score"), total: integer("total"), completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ ownerTest: index("listening_activity_owner_test_idx").on(table.userId, table.testId) }));
export const listeningDrafts = pgTable("listening_drafts", {
  attemptId: uuid("attempt_id").primaryKey().references(() => listeningAttempts.id, { onDelete: "cascade" }),
  answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
  audioPosition: real("audio_position").notNull().default(0),
  audioStartedAt: timestamp("audio_started_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ----------------------------------------------------------------------------
 * 0030 General Reading — a LEARNING mode (develop reading), separate from the
 * IELTS Academic assessment (measure reading). The same reading_passages,
 * reading_questions, lexical_occurrences and canonical senses are reused; only the
 * explicit classification below makes a passage GENERAL_PRACTICE. A passage with no
 * row here is Academic. See src/lib/reading/lexical-policy.ts.
 * ------------------------------------------------------------------------- */
export const generalReadingSets = pgTable("general_reading_sets", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  difficultyLevel: varchar("difficulty_level", { length: 10 }),
  publicationState: publicationStateEnum("publication_state").notNull().default("published"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  sourceRef: varchar("source_ref", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const generalReadingPassages = pgTable("general_reading_passages", {
  passageId: uuid("passage_id").primaryKey().references(() => readingPassages.id, { onDelete: "cascade" }),
  setId: uuid("set_id").notNull().references(() => generalReadingSets.id, { onDelete: "cascade" }),
  passageNo: integer("passage_no").notNull(),
  readingMode: varchar("reading_mode", { length: 24 }).notNull().default("general_practice"),
});

export const generalReadingProgress = pgTable("general_reading_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  setId: uuid("set_id").notNull().references(() => generalReadingSets.id, { onDelete: "cascade" }),
  passageId: uuid("passage_id").notNull().references(() => readingPassages.id, { onDelete: "cascade" }),
  answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
  score: integer("score"),
  total: integer("total"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("general_reading_progress_owner_idx").on(table.userId, table.passageId)]);

// ---------------------------------------------------------------------------
// Writing workspace (0031). Additive tables; content starts empty and arrives
// only through the staff import. See drizzle/0031_writing_workspace.sql.
// ---------------------------------------------------------------------------

export const writingLessons = pgTable("writing_lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  category: varchar("category", { length: 40 }).notNull(),
  summary: text("summary"),
  body: text("body").notNull(),
  durationMinutes: smallint("duration_minutes"),
  position: integer("position").notNull().default(0),
  publicationState: publicationStateEnum("publication_state").notNull().default("draft"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  sourceRef: varchar("source_ref", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const writingLessonProgress = pgTable("writing_lesson_progress", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id").notNull().references(() => writingLessons.id, { onDelete: "cascade" }),
  completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.lessonId] })]);

export const writingExamSessions = pgTable("writing_exam_sessions", {
  submissionId: uuid("submission_id").primaryKey().references(() => writingSubmissions.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taskType: writingTaskTypeEnum("task_type").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
});

/** 0032 Real Exam paper: one server deadline shared by its task entries. */
export const writingExamPapers = pgTable("writing_exam_papers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mode: varchar("mode", { length: 8 }).$type<"task1" | "task2" | "full">().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  finalizeReason: varchar("finalize_reason", { length: 12 }).$type<"submitted" | "timeout" | "abandoned">(),
});

export const writingExamPaperEntries = pgTable("writing_exam_paper_entries", {
  paperId: uuid("paper_id").notNull().references(() => writingExamPapers.id, { onDelete: "cascade" }),
  position: smallint("position").notNull(),
  taskType: writingTaskTypeEnum("task_type").notNull(),
  promptId: uuid("prompt_id").notNull().references(() => writingPrompts.id),
  submissionId: uuid("submission_id").notNull().unique().references(() => writingSubmissions.id, { onDelete: "cascade" }),
  draftRevision: integer("draft_revision").notNull().default(0),
  savedAt: timestamp("saved_at", { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.paperId, table.position] })]);

export const writingGradeRequests = pgTable("writing_grade_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taskType: writingTaskTypeEnum("task_type").notNull(),
  questionText: text("question_text").notNull(),
  essayText: text("essay_text").notNull(),
  wordCount: integer("word_count").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  lastError: varchar("last_error", { length: 60 }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  analysis: jsonb("analysis"),
  idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
}, (table) => [uniqueIndex("writing_grade_requests_idem_idx").on(table.userId, table.idempotencyKey)]);

export const writingTranslationSets = pgTable("writing_translation_sets", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  topic: varchar("topic", { length: 120 }).notNull(),
  questionType: varchar("question_type", { length: 30 }).notNull(),
  taskType: writingTaskTypeEnum("task_type").notNull().default("task2"),
  targetBand: smallint("target_band").notNull(),
  promptText: text("prompt_text").notNull(),
  provenance: varchar("provenance", { length: 200 }).notNull(),
  publicationState: publicationStateEnum("publication_state").notNull().default("draft"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  sourceRef: varchar("source_ref", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const writingTranslationSentences = pgTable("writing_translation_sentences", {
  id: uuid("id").defaultRandom().primaryKey(),
  setId: uuid("set_id").notNull().references(() => writingTranslationSets.id, { onDelete: "cascade" }),
  position: smallint("position").notNull(),
  uzbekSource: text("uzbek_source").notNull(),
  modelEnglish: text("model_english").notNull(),
  acceptedAlternatives: jsonb("accepted_alternatives").$type<string[]>().notNull().default([]),
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  targetLexicalItems: jsonb("target_lexical_items").$type<string[]>().notNull().default([]),
});

export const writingTranslationAttempts = pgTable("writing_translation_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  setId: uuid("set_id").notNull().references(() => writingTranslationSets.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("in_progress"),
  elapsedMs: integer("elapsed_ms"),
  overallEstimate: real("overall_estimate"),
  meaningScore: real("meaning_score"),
  grammarBand: real("grammar_band"),
  vocabularyBand: real("vocabulary_band"),
});

export const writingTranslationAnswers = pgTable("writing_translation_answers", {
  id: uuid("id").defaultRandom().primaryKey(),
  attemptId: uuid("attempt_id").notNull().references(() => writingTranslationAttempts.id, { onDelete: "cascade" }),
  sentenceId: uuid("sentence_id").notNull().references(() => writingTranslationSentences.id, { onDelete: "cascade" }),
  answerText: text("answer_text").notNull(),
  evaluationStatus: varchar("evaluation_status", { length: 20 }).notNull(),
  verdict: varchar("verdict", { length: 20 }),
  meaningPreserved: smallint("meaning_preserved"),
  grammarBand: real("grammar_band"),
  vocabularyBand: real("vocabulary_band"),
  feedback: text("feedback"),
  improvedVersion: text("improved_version"),
  tries: smallint("tries").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("writing_translation_answers_attempt_id_sentence_id_key").on(table.attemptId, table.sentenceId)]);

export const writingModelTexts = pgTable("writing_model_texts", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  taskType: writingTaskTypeEnum("task_type").notNull(),
  topic: varchar("topic", { length: 120 }).notNull(),
  targetBand: numeric("target_band", { precision: 2, scale: 1 }).notNull(),
  body: text("body").notNull(),
  wordCount: integer("word_count").notNull(),
  provenance: varchar("provenance", { length: 200 }).notNull(),
  publicationState: publicationStateEnum("publication_state").notNull().default("draft"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  sourceRef: varchar("source_ref", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const typingRunTexts = pgTable("typing_run_texts", {
  runId: uuid("run_id").primaryKey().references(() => typingRuns.id, { onDelete: "cascade" }),
  modelTextId: uuid("model_text_id").notNull().references(() => writingModelTexts.id, { onDelete: "cascade" }),
  mistakes: integer("mistakes").notNull().default(0),
});

export const writingLanguagePatterns = pgTable("writing_language_patterns", {
  id: uuid("id").defaultRandom().primaryKey(),
  pattern: varchar("pattern", { length: 240 }).notNull(),
  function: varchar("function", { length: 30 }).notNull(),
  taskType: writingTaskTypeEnum("task_type").notNull(),
  topic: varchar("topic", { length: 120 }),
  targetBand: smallint("target_band"),
  example: text("example").notNull(),
  usageNote: text("usage_note"),
  provenance: varchar("provenance", { length: 200 }).notNull(),
  publicationState: publicationStateEnum("publication_state").notNull().default("draft"),
  publishAt: timestamp("publish_at", { withTimezone: true }),
  sourceRef: varchar("source_ref", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const writingPatternBank = pgTable("writing_pattern_bank", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  patternId: uuid("pattern_id").notNull().references(() => writingLanguagePatterns.id, { onDelete: "cascade" }),
  savedAt: timestamp("saved_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.patternId] })]);
