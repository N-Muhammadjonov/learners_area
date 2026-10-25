"""Install an explicitly chosen dictionary sense without modifying learner progress."""
from . import main as core
from .dictionary_presentation import present, example_uses_entry
from .step17_dictionary_read_port import normalize_search
from .step30_video_lexical import lexical_type, normalize_pos


async def materialize(con, entry, sense_id):
    sense=next((s for s in entry['senses'] if s['sense_id']==sense_id),None)
    if not sense:raise ValueError('sense_not_found')
    study=present(entry)['senses'][sense_id]
    example=study['examples'][0]['text_en'] if study['examples'] else None
    collocations=' · '.join(row['text'] for row in study['collocations']) or None
    mapped=await con.fetchrow('SELECT app_sense_id FROM dictionary_sense_mappings WHERE sense_id=$1',core.uuid_value(sense_id))
    if mapped:
        current=await con.fetchrow('SELECT example_sentence,collocations FROM lexemes WHERE id=$1',mapped['app_sense_id'])
        if not current:raise ValueError('dictionary_mapping_missing')
        if not current['example_sentence'] or not example_uses_entry(entry,current['example_sentence']):
            await con.execute('UPDATE lexemes SET example_sentence=$2 WHERE id=$1',mapped['app_sense_id'],example)
        if not (current['collocations'] or '').strip() and collocations:
            await con.execute('UPDATE lexemes SET collocations=$2 WHERE id=$1',mapped['app_sense_id'],collocations)
        return mapped['app_sense_id']
    pos={'n':'noun','v':'verb','a':'adjective','r':'adverb'}.get(entry['part_of_speech'],entry['part_of_speech'])
    kind=entry['lexical_type']
    if kind not in ('word','noun_phrase','verb_phrase','collocation','phrasal_verb','idiom','fixed_expression','compound','technical_term','phrase'):
        kind=lexical_type(entry['display_lemma'],normalize_pos(pos))
    unit=await con.fetchval("""INSERT INTO lexical_units(id,lemma,lemma_norm,part_of_speech,lexical_type,provenance)
        VALUES($1,$2,$3,$4,$5,'dictionary_release') ON CONFLICT(language,lemma_norm,part_of_speech,lexical_type)
        DO UPDATE SET lemma=lexical_units.lemma RETURNING id""",core.uuid_value(entry['lexeme_id']),entry['display_lemma'],normalize_search(entry['display_lemma']),pos,kind)
    identifier=core.uuid_value(sense_id)
    await con.execute("""INSERT INTO lexemes(id,term,part_of_speech,definition_en,translation_uz,example_sentence,
        collocations,sense_key,provenance,verification_status,lexical_unit_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'dictionary_release',$9,$10)""",identifier,entry['display_lemma'],pos,
        sense['definition_en'],sense['translations'][0]['text'],example,collocations,'dictionary:'+sense_id,
        'unverified' if sense.get('editorial') and sense['editorial']['translation_status']!='human_reviewed' else 'verified',unit)
    await con.execute("""INSERT INTO dictionary_sense_mappings(sense_id,app_sense_id,app_unit_id,mapping_method)
        VALUES($1,$2,$3,'new_canonical')""",identifier,identifier,unit)
    return identifier
