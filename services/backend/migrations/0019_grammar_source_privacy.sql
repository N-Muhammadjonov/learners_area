ALTER TABLE "grammar_exercises" ADD COLUMN "source_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "grammar_exercises" ADD CONSTRAINT "grammar_exercises_source_owner_user_id_users_id_fk" FOREIGN KEY ("source_owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grammar_exercises_source_owner_idx" ON "grammar_exercises" USING btree ("source_owner_user_id","topic_id");--> statement-breakpoint
-- Recover ownership while the source still exists; source expiry must never
-- turn a student's private sentence into public centre content.
UPDATE grammar_exercises g SET source_owner_user_id = s.user_id
FROM writing_submissions s WHERE g.source_submission_id = s.id;
--> statement-breakpoint
CREATE FUNCTION preserve_grammar_source_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_submission_id IS NOT NULL THEN
    SELECT user_id INTO NEW.source_owner_user_id FROM writing_submissions WHERE id = NEW.source_submission_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.source_owner_user_id IS NOT NULL THEN
    NEW.source_owner_user_id := OLD.source_owner_user_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER grammar_source_owner
BEFORE INSERT OR UPDATE ON grammar_exercises
FOR EACH ROW EXECUTE FUNCTION preserve_grammar_source_owner();
