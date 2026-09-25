import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

export const accessRequestStatusEnum = pgEnum("access_request_status", [
  "pending",
  "approved",
  "rejected",
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
  name: varchar("name", { length: 200 }).notNull(),
  role: roleEnum("role").notNull().default("student"),
  /** Historical column. Authorization reads `role`, never this flag. */
  isOwner: boolean("is_owner").notNull().default(false),
  /** Server-side admission gate for every private page, route and object. */
  accountStatus: accountStatusEnum("account_status").notNull().default("pending"),
  statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).defaultNow().notNull(),
  statusReason: text("status_reason"),
  /** Drives the inactivity half of the retention policy (see retention.ts). */
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  audioUrl: text("audio_url").notNull(),
  transcript: text("transcript"), // optional, shown only in the post-attempt analysis
  difficultyLevel: varchar("difficulty_level", { length: 10 }).notNull().default("B2"),
  isActive: boolean("is_active").notNull().default(true),
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
});

export const grammarAttempts = pgTable("grammar_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id").notNull().references(() => grammarExercises.id, { onDelete: "cascade" }),
  selectedOption: text("selected_option").notNull(),
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
  primaryUrl: text("primary_url").notNull(), // resolved, publicly reachable
  primaryObjectKey: text("primary_object_key"), // storage key, for cleanup; null for link-type primaries
  primaryOriginalName: varchar("primary_original_name", { length: 255 }),
  primaryMimeType: varchar("primary_mime_type", { length: 120 }),
  primarySize: integer("primary_size"), // bytes
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// A resource's description is an ordered list of mixed content blocks —
// not one textarea. See src/lib/services/storage for where block file/image/
// audio objects actually live; this table holds the block's own text/link
// data plus a reference to that object where relevant.
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
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  },
  (table) => ({
    termIdx: index("lexemes_term_idx").on(table.term),
    senseKeyIdx: uniqueIndex("lexemes_sense_key_idx").on(table.senseKey),
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
    lexemeId: uuid("lexeme_id").notNull().references(() => lexemes.id, { onDelete: "cascade" }),
    state: vocabStateEnum("state").notNull().default("new"),
    sourceType: varchar("source_type", { length: 40 }), // e.g. "reading", "writing_feedback", "manual"
    sourceId: uuid("source_id"),
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
  },
  (table) => ({
    libraryIdx: index("user_vocabulary_user_idx").on(table.userId, table.nextReviewAt),
    senseIdx: index("user_vocabulary_sense_idx").on(table.userId, table.senseKey),
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
