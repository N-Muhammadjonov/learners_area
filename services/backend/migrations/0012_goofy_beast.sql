-- A resource can exist before its file does.
--
-- `speaking_materials.primary_url` and `listening_tests.audio_url` were NOT NULL,
-- which forced the demo data (and any CMS row created before the upload) to point
-- at a URL that had to exist. That is how placeholder hosts ended up in the seed.
-- Both columns become nullable so "no file yet" is a real, displayable state
-- instead of an invented address.
ALTER TABLE "speaking_materials" ALTER COLUMN "primary_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listening_tests" ALTER COLUMN "audio_url" DROP NOT NULL;
