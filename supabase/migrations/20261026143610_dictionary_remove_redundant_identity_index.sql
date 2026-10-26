DO $check$
DECLARE covering text;
BEGIN
 SELECT pg_get_indexdef(indexrelid) INTO covering FROM pg_index
 WHERE indexrelid='public.dictionary_entries_release_id_lemma_norm_part_of_speech_lex_key'::regclass
 AND indisvalid AND indisunique;
 IF covering IS NULL OR covering NOT LIKE '%(release_id, lemma_norm, part_of_speech, lexical_type, lexeme_id)%' THEN
 RAISE EXCEPTION 'Required covering identity index is absent'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conindid=to_regclass('public.dictionary_entries_identity_idx')) THEN
 RAISE EXCEPTION 'Redundant index unexpectedly backs a constraint'; END IF;
END $check$;
DROP INDEX IF EXISTS public.dictionary_entries_identity_idx;
