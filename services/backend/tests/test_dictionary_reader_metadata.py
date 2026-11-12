"""Canonical previews and exact source relations without any release mutation."""
import asyncio,copy,gzip,json
from pathlib import Path
from unittest.mock import AsyncMock,patch
from app import dictionary_reader_metadata as reader
from app import dictionary_presentation as presentation
from app import vocabulary_flashcard_batches as cards
from app.step21_vocab_batch import sense_key

ROOT=Path(__file__).resolve().parents[1]
HAPPY='9eae6a37-2750-5469-9403-8073c95d0a24'

def fixture():
    # Minimal canonical identity; tests below patch only the local display metadata.
    senses=[{'sense_id':'service','definition_en':'ready to help','translations':[{'text':'tayyor'}],'cefr':'A2','examples':[]},
            {'sense_id':'joy','definition_en':'feeling pleasure','translations':[{'text':'xursand'}],'cefr':'A1','examples':[]}]
    return {'lexeme_id':HAPPY,'display_lemma':'happy','part_of_speech':'a','lexical_type':'word',
            'senses':senses,'relations':[{'relation_type':'antonym','display_lemma':'unhappy','target_lexeme_id':'target','target_sense_id':'sad'}],
            'collocations':[{'text':'happy ending'}],'forms':[]}

def test_source_order_and_antonyms_are_hash_bound_and_do_not_change_entry(monkeypatch):
    e=fixture();original=copy.deepcopy(e)
    value=[reader.digest(e),[[1,[0]],[0,[]]],'xursand','A1']
    monkeypatch.setattr(reader,'stored',lambda _:value)
    view=reader.details(e)
    assert view['primarySenseId']=='joy' and view['primaryTranslation']=='xursand'
    assert view['antonyms']['joy']==[{'text':'unhappy','lexemeId':'target','senseId':'sad'}]
    assert view['antonyms']['service']==[]
    assert e==original
    e['relations']=[]
    assert reader.details(e)['antonyms']=={}  # stale relation indices never apply

def test_preview_enrichment_keeps_worker_order_matches_and_uz_translation(monkeypatch):
    hits=[{'lexeme_id':HAPPY,'display_lemma':'happy','translation_uz':'tayyor','match_type':'exact_lemma'}]
    monkeypatch.setattr(reader,'stored',lambda _ : ['hash',[],'xursand','A1'])
    con=type('Conn',(),{'fetch':AsyncMock(return_value=[{'lexeme_id':HAPPY,'content_sha':'hash'}])})()
    en=asyncio.run(reader.enrich_search(con,'release',hits,'EN'))
    uz=asyncio.run(reader.enrich_search(con,'release',hits,'UZ'))
    assert en[0]['cefr']=='A1' and en[0]['translation_uz']=='xursand'
    assert uz[0]['translation_uz']=='tayyor' and uz[0]['primary_translation_uz']=='xursand'
    assert en[0]['lexeme_id']==HAPPY and en[0]['match_type']=='exact_lemma'
    assert hits[0]['translation_uz']=='tayyor'

def test_changed_preview_uses_current_release_entry_instead_of_old_text(monkeypatch):
    e=fixture();monkeypatch.setattr(reader,'stored',lambda _:['old',[],'OLD','C2'])
    con=type('Conn',(),{'fetch':AsyncMock(return_value=[{'lexeme_id':HAPPY,'content_sha':'new'}])})()
    from app import step17_dictionary_read_port as port
    with patch.object(port,'entry',AsyncMock(return_value=e)) as fetch:
        result=asyncio.run(reader.enrich_search(con,'pinned',[{'lexeme_id':HAPPY}],'EN'))
    assert result[0]['translation_uz']=='xursand' and result[0]['cefr']=='A1'
    fetch.assert_awaited_once_with(con,HAPPY,'pinned')

def test_all_scoped_synonyms_antonyms_and_all_entry_collocations_are_returned(monkeypatch):
    e=fixture();e['relations']=[]
    for kind in ['synonym','antonym']:
        e['relations'] += [{'relation_type':kind,'source_sense_id':'joy','display_lemma':kind+str(i),
                           'target_lexeme_id':kind+str(i),'target_sense_id':str(i)} for i in range(9)]
    monkeypatch.setattr(presentation,'shard',lambda _: {})
    monkeypatch.setattr(reader,'stored',lambda _:None)
    p=presentation.present(e)
    assert len(p['senses']['joy']['synonyms'])==9 and len(p['senses']['joy']['antonyms'])==9
    assert p['senses']['service']['synonyms']==[] and p['senses']['service']['antonyms']==[]
    assert {'text':'happy ending'} in p['collocations']

def test_original_named_source_groups_keep_all_words_and_private_assessments():
    packs=json.loads((ROOT/'app/vocabulary_builtin_packs.json').read_text())
    for pack in packs:
        rows=[{'id':str(i),'topic_pack':pack['id'],'sense_key':sense_key(w)} for i,w in enumerate(pack['words'])]
        parts=cards.named_parts(list(reversed(rows)))
        ids=[id for _,part in parts for id in part]
        assert len(ids)==len(rows) and len(set(ids))==len(rows)
        if pack['id'] not in ('food','media'):assert all(label for label,_ in parts)
        plan=cards.batch_plan(ids,{id:'known' for id in parts[0][1]},parts)
        assert plan[0]['complete'] and plan[1]['unlocked'] and not plan[2]['unlocked']
        assert cards.group_ids(ids,plan,1)==parts[1][1]

def test_historical_food_headings_keep_their_exact_senses_after_pack_replacement():
    groups=json.loads((ROOT/'app/vocabulary_pack_groups.json').read_text())['food']
    rows=[{'id':str(i),'topic_pack':'food','sense_key':key}
          for i,key in enumerate(key for g in groups for key in g['senseKeys'])]
    parts=cards.named_parts(list(reversed(rows)))
    assert [label for label,_ in parts]==['FOOD, ENERGY & NUTRITION','FOOD SAFETY','FOOD LABELLING','ORGANIC FOOD','FOOD PROCESSING & FLAVOUR']
    assert [len(part) for _,part in parts]==[25,20,20,28,51]
    assert [id for _,part in parts for id in part]==[str(i) for i in range(144)]

def test_new_pack_words_do_not_inherit_old_offset_headings_and_unknown_rows_survive():
    packs=json.loads((ROOT/'app/vocabulary_builtin_packs.json').read_text())
    lookup=cards.source_groups()
    for name in ('food','media'):
        pack=next(p for p in packs if p['id']==name)
        rows=[{'id':str(i),'topic_pack':name,'sense_key':sense_key(w)} for i,w in enumerate(pack['words'])]
        unknown={'id':name+'-new-sense','topic_pack':name,'sense_key':'unmapped-new-sense'}
        rows.append(unknown)
        parts=cards.named_parts(list(reversed(rows)))
        flattened=[id for _,part in parts for id in part]
        assert len(flattened)==len(rows) and set(flattened)=={row['id'] for row in rows}
        unheaded=[id for label,part in parts if label is None for id in part]
        assert unheaded==[r['id'] for r in rows if (name,r['sense_key']) not in lookup]
        assert unknown['id'] in unheaded
    assert cards.named_parts([{'id':'unknown','topic_pack':'custom','sense_key':'unmapped'}])==[(None,['unknown'])]

def test_all_bundled_shards_have_verified_checksums_and_legal_cefr():
    count=0
    for prefix,desc in reader.manifest()['shards'].items():
        shard=reader.metadata_shard(prefix);count+=len(shard)
        assert all(id.startswith(prefix) and v[3] in (None,'A1','A2','B1','B2','C1','C2') for id,v in shard.items())
    assert count==reader.manifest()['stats']['entries']
    happy=reader.stored(HAPPY)
    assert happy[2:] == ['xursand / baxtli','A1'] and happy[1][0][0]==1


def test_collocation_homographs_keep_every_exact_target_sense(monkeypatch):
    e=fixture();monkeypatch.setattr(reader,'stored',lambda _:None)
    stored={'senses':{}}
    for index,s in enumerate(e['senses']):
        stored['senses'][s['sense_id']]={'meaningSha':presentation.meaning_hash(e,s),'synonyms':[],
            'collocations':[{'text':'same phrase','lexemeId':'phrase','senseId':str(index)}]}
    monkeypatch.setattr(presentation,'shard',lambda _:{HAPPY:stored})
    p=presentation.present(e)
    assert {c.get('senseId') for c in p['collocations'] if c['text']=='same phrase'}=={'0','1'}


def test_single_sense_unscoped_synonyms_survive_empty_presentation_override(monkeypatch):
    """Existing canonical synonym edges must survive a curated empty list."""
    e = fixture()
    e['senses'] = [e['senses'][0]]
    e['relations'] = [
        {'relation_type': 'synonym', 'display_lemma': 'prepared',
         'target_lexeme_id': 'target-id', 'target_sense_id': 'target-sense'}
    ]
    monkeypatch.setattr(reader, 'stored', lambda _: None)
    row = {'meaningSha': presentation.meaning_hash(e, e['senses'][0]),
           'synonyms': [], 'collocations': [], 'addedExamples': []}
    monkeypatch.setattr(presentation, 'shard', lambda _: {HAPPY: {'senses': {'service': row}}})
    view = presentation.present(e)
    assert view['senses']['service']['synonyms'] == [
        {'text': 'prepared', 'lexemeId': 'target-id', 'senseId': 'target-sense'}
    ]


def test_multiple_sense_unscoped_synonyms_are_not_assigned_indiscriminately(monkeypatch):
    """Do not attach a generic relation to unrelated meanings."""
    e = fixture()
    e['relations'] = [
        {'relation_type': 'synonym', 'display_lemma': 'prepared',
         'target_lexeme_id': 'target-id', 'target_sense_id': 'target-sense'}
    ]
    monkeypatch.setattr(reader, 'stored', lambda _: None)
    monkeypatch.setattr(presentation, 'shard', lambda _: {})
    view = presentation.present(e)
    assert view['senses']['service']['synonyms'] == []
    assert view['senses']['joy']['synonyms'] == []
