begin transaction read only; set local statement_timeout='30s';
with protected as (select active_release_id id from dictionary_channels where name='stable' union select previous_release_id from dictionary_channels where name='stable'),
entries as (select e.* from dictionary_entries e join protected p on p.id=e.release_id),
e as (select release_id,count(*) entries,encode(sha256(convert_to(string_agg(lexeme_id::text||':'||content_sha,E'\n' order by lexeme_id),'UTF8')),'hex') entry_inventory_sha256 from entries group by release_id),
s as (select release_id,count(*) senses,count(distinct x) distinct_senses,encode(sha256(convert_to('['||string_agg('"'||x::text||'"',',' order by x)||']','UTF8')),'hex') sense_set_sha256 from entries cross join lateral unnest(sense_ids) x group by release_id),
a as (select release_id,count(*) examples,count(distinct x) distinct_examples,encode(sha256(convert_to('['||string_agg('"'||x::text||'"',',' order by x)||']','UTF8')),'hex') example_set_sha256 from entries cross join lateral unnest(example_ids) x group by release_id)
select now() captured_at,e.*,s.senses,s.distinct_senses,s.sense_set_sha256,a.examples,a.distinct_examples,a.example_set_sha256,r.manifest_sha,
r.manifest->>'entry_inventory_sha256'=e.entry_inventory_sha256 entry_inventory_matches,
r.manifest->>'sense_set_sha256'=s.sense_set_sha256 sense_inventory_matches,
r.manifest->>'example_set_sha256'=a.example_set_sha256 example_inventory_matches
from e join s using(release_id) join a using(release_id) join dictionary_releases r on r.id=e.release_id; rollback;
