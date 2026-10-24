-- Vocabulary topic packs as canonical content (Phase 2, §31, §76, §100).
--
-- Topic packs existed only as a TypeScript constant, so adding one required a
-- deployment. They now live in the database — WITHOUT becoming a second word
-- store:
--
--   * every word in a pack IS a `lexemes` row (the one canonical sense table the
--     whole vocabulary system already uses: the same table Reading, Listening and
--     TED/Podcast occurrences resolve into);
--   * a pack is a relational MEMBERSHIP list over those senses, with a stable
--     identity, a publication lifecycle and revision history like every other
--     content type;
--   * nothing here duplicates a definition. The glosses stay on the lexeme.
--
-- Additive only. Existing installs keep working from the built-in packs until the
-- migration tool seeds them (see scripts/content-backfill-vocabulary-packs.ts),
-- and `vocabulary_topic_pack_words.lexeme_id` is what makes the two impossible to
-- drift apart.

CREATE TABLE IF NOT EXISTS "vocabulary_topic_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_ref" varchar(80) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"label_en" varchar(120) NOT NULL,
	"label_uz" varchar(120),
	"topic_code" varchar(40),
	"position" integer DEFAULT 0 NOT NULL,
	"level" varchar(10),
	"publication_state" "publication_state" DEFAULT 'draft' NOT NULL,
	"publish_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "vocabulary_topic_packs" ADD CONSTRAINT "vocabulary_topic_packs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vocabulary_topic_packs_source_ref_idx" ON "vocabulary_topic_packs" USING btree ("source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vocabulary_topic_packs_slug_idx" ON "vocabulary_topic_packs" USING btree ("slug");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vocabulary_topic_pack_words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"lexeme_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "vocabulary_topic_pack_words" ADD CONSTRAINT "vocabulary_topic_pack_words_pack_id_vocabulary_topic_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."vocabulary_topic_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_topic_pack_words" ADD CONSTRAINT "vocabulary_topic_pack_words_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vocabulary_topic_pack_words_position_idx" ON "vocabulary_topic_pack_words" USING btree ("pack_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vocabulary_topic_pack_words_lexeme_idx" ON "vocabulary_topic_pack_words" USING btree ("pack_id","lexeme_id");
