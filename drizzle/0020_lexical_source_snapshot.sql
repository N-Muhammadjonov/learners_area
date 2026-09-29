ALTER TABLE "user_vocabulary" DROP CONSTRAINT "user_vocabulary_lexeme_id_lexemes_id_fk";
--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD COLUMN "source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD CONSTRAINT "user_vocabulary_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE restrict ON UPDATE no action;