CREATE TABLE "lexical_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lexeme_id" uuid NOT NULL,
	"passage_id" uuid NOT NULL,
	"segment_key" varchar(40),
	"surface_form" varchar(120) NOT NULL,
	"start_char" integer NOT NULL,
	"end_char" integer NOT NULL,
	"sentence_text" text,
	"occurrence_type" varchar(24),
	"is_target_vocabulary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_passage_paragraphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passage_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" varchar(8),
	"text" text NOT NULL,
	"is_footnote" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_question_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passage_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type_code" varchar(16) NOT NULL,
	"display_title" varchar(120),
	"instructions_text" text,
	"from_question_no" integer,
	"to_question_no" integer,
	"shared_choices" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lexemes" ADD COLUMN "provenance" varchar(20);--> statement-breakpoint
ALTER TABLE "lexemes" ADD COLUMN "verification_status" varchar(24);--> statement-breakpoint
ALTER TABLE "lexemes" ADD COLUMN "import_batch" varchar(80);--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "external_id" varchar(160);--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "test_no" integer;--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "passage_no" integer;--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "topic_code" varchar(40);--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "source_word_count" integer;--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "source_question_count" integer;--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "source_checksum" varchar(64);--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "source_ref" varchar(80);--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "question_no" integer;--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "type_code" varchar(16);--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "answer_slots" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "accepted_answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "answer_constraint" jsonb;--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "render_mode" varchar(32);--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "evidence_start_char" integer;--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "evidence_end_char" integer;--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "evidence_type" varchar(24);--> statement-breakpoint
ALTER TABLE "reading_questions" ADD COLUMN "source_key" varchar(40);--> statement-breakpoint
ALTER TABLE "lexical_occurrences" ADD CONSTRAINT "lexical_occurrences_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexical_occurrences" ADD CONSTRAINT "lexical_occurrences_passage_id_reading_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."reading_passages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_passage_paragraphs" ADD CONSTRAINT "reading_passage_paragraphs_passage_id_reading_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."reading_passages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_question_groups" ADD CONSTRAINT "reading_question_groups_passage_id_reading_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."reading_passages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lexical_occurrences_passage_offset_idx" ON "lexical_occurrences" USING btree ("passage_id","start_char","end_char");--> statement-breakpoint
CREATE INDEX "lexical_occurrences_lexeme_idx" ON "lexical_occurrences" USING btree ("lexeme_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_question_groups_passage_position_idx" ON "reading_question_groups" USING btree ("passage_id","position");--> statement-breakpoint
ALTER TABLE "reading_questions" ADD CONSTRAINT "reading_questions_group_id_reading_question_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."reading_question_groups"("id") ON DELETE cascade ON UPDATE no action;