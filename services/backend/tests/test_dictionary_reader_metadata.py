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


def test_single_sense_canonical_collocations_survive_curated_empty_override(monkeypatch):
    """A presentation row must not discard legitimate canonical phrases."""
    e = fixture()
    e['senses'] = [e['senses'][0]]
    e['relations'] = []
    e['collocations'] = [{'text': 'happy ending', 'sense_id': 'service'}]
    monkeypatch.setattr(reader, 'stored', lambda _: None)
    row = {'meaningSha': presentation.meaning_hash(e, e['senses'][0]),
           'synonyms': [], 'collocations': [], 'addedExamples': []}
    monkeypatch.setattr(presentation, 'shard',
                        lambda _: {HAPPY: {'senses': {'service': row}}})
    view = presentation.present(e)
    assert view['senses']['service']['collocations'] == [{'text': 'happy ending'}]
    assert view['collocations'] == [{'text': 'happy ending'}]


def test_multi_sense_unscoped_collocations_not_assigned_without_source(monkeypatch):
    """Unscoped collocations are not silently attached to an arbitrary meaning."""
    e = fixture()
    e['relations'] = []
    e['collocations'] = [{'text': 'happy ending'}]
    monkeypatch.setattr(reader, 'stored', lambda _: None)
    monkeypatch.setattr(presentation, 'shard', lambda _: {})
    view = presentation.present(e)
    assert view['senses']['service']['collocations'] == []
    assert view['senses']['joy']['collocations'] == []
    assert view['collocations'] == [{'text': 'happy ending'}]


def test_happy_example_replacements_are_complete_and_sense_specific():
    import re

    corrections = presentation.example_corrections()
    lexeme_id = HAPPY
    senses = corrections["entries"][lexeme_id]
    assert len(senses) == 4
    assert sum(len(s["examples"]) for s in senses.values()) == 8
    expected = [
        "I am happy to help you.",
        "They have a happy marriage.",
        "We spent many happy days on the beach.",
        "She greeted us with a happy smile.",
        "That was a happy choice of words.",
        "The writer used a happy turn of phrase.",
        "The negotiations had a happy outcome.",
        "It was a happy coincidence that we met.",
    ]
    actual = [
        example["text_en"]
        for sense in senses.values()
        for example in sense["examples"].values()
    ]
    assert set(actual) == set(expected)
    assert all(example.endswith(".") for example in actual)
    assert all(re.search(r"\b(?:I|We|They|She|That|The|It)\b", example)
               for example in actual)
    for sense in senses.values():
        assert len(sense["meaning_sha"]) == 64
        for replacement in sense["examples"].values():
            assert replacement["original_en"]
            assert replacement["text_uz"].strip().endswith(".")


def test_example_correction_is_bound_to_release_sense_meaning_and_source():
    corrections = presentation.example_corrections()
    sense_id = "9a8f14f5-ea1c-4af7-afa2-ebeb957a8903"
    source = corrections["entries"][HAPPY][sense_id]
    originals = [
        {"example_id": identifier, "text_en": replacement["original_en"],
         "text_uz": "ORIGINAL"}
        for identifier, replacement in source["examples"].items()
    ]
    entry = {
        "release_id": corrections["source_release"],
        "lexeme_id": HAPPY,
        "display_lemma": "happy",
        "part_of_speech": "a",
    }
    sense = {
        "sense_id": sense_id,
        "definition_en": "enjoying or showing or marked by joy or pleasure",
        "examples": originals,
    }
    original = copy.deepcopy(sense)
    revised = presentation.corrected_examples(entry, sense)
    assert len(revised) == 3
    assert all(item["text_en"].endswith(".") for item in revised)
    assert all(item["text_uz"].endswith(".") for item in revised)
    assert sense == original

    different_release = {**entry, "release_id": "another-release"}
    assert presentation.corrected_examples(different_release, sense) == originals

    different_meaning = {**sense, "definition_en": "another meaning"}
    assert presentation.corrected_examples(entry, different_meaning) == originals

    unmatched = copy.deepcopy(sense)
    unmatched["examples"][0]["text_en"] = "Edited in source."
    fallback = presentation.corrected_examples(entry, unmatched)
    assert fallback[0] == unmatched["examples"][0]
    assert fallback[1]["text_en"] != originals[1]["text_en"]


def test_startup_replacement_removes_unrelated_example():
    corrections = presentation.example_corrections()
    lexeme_id = "65825765-33c0-5e04-8ad9-1cab90be90e5"
    sense_id = "d7525883-85d3-4bd1-90f0-409545b4c051"
    change = corrections["entries"][lexeme_id][sense_id]
    assert len(change["examples"]) == 2
    entry = {
        "lexeme_id": lexeme_id,
        "release_id": corrections["source_release"],
        "display_lemma": "startup",
        "part_of_speech": "n",
    }
    sense = {
        "sense_id": sense_id,
        "definition_en": "the act of starting a new operation or practice",
        "examples": [
            {"example_id": example_id, "text_en": replacement["original_en"],
             "text_uz": "Original translation"}
            for example_id, replacement in change["examples"].items()
        ],
    }
    revised = presentation.corrected_examples(entry, sense)
    assert len(revised) == 2
    assert all("startup" in example["text_en"].lower() for example in revised)
    assert all(example["text_en"].endswith(".") for example in revised)
    assert all(example["text_uz"].endswith(".") for example in revised)
    assert not any("fluoridation" in example["text_en"] for example in revised)


def test_semantic_overrides_are_exact_sense_and_release_scoped(monkeypatch):
    from app import dictionary_presentation as presentation

    data = presentation.sense_corrections()
    assert data["source_release"] == "rel-v1-1fa06d8d41d8ff701632573e"
    from app.dictionary_sense_curation import load_corrections

    # The audited lexeme set grows across batches; match the canonical patch
    # registry rather than a frozen, obsolete count from the initial 31 items.
    assert len(data["entries"]) >= 31
    assert data["entries"] == load_corrections()["entries"]

    itself = {
        "release_id": data["source_release"],
        "lexeme_id": "657d05d9-7940-5fe6-9e0d-13f5f665a19e",
        "display_lemma": "itself",
        "part_of_speech": "pronoun",
        "lexical_type": "word",
        "senses": [{
            "sense_id": "a09f14e9-8dde-5753-974e-67540f06f258",
            "definition_en": "Refers back to the same subject.",
            "cefr": None,
            "translations": [{"text": "o‘zi"}],
            "examples": [],
        }],
        "forms": [],
        "relations": [],
        "collocations": [],
    }
    sid = itself["senses"][0]["sense_id"]
    forbidden = ["myself", "ourselves", "themselves", "yourself"]
    stored = {
        "senses": {
            sid: {
                "meaningSha": presentation.meaning_hash(itself, itself["senses"][0]),
                "synonyms": [
                    {"text": word, "lexemeId": identifier}
                    for word, identifier in zip(
                        forbidden,
                        data["entries"][itself["lexeme_id"]][sid]["remove_synonym_lexeme_ids"]
                    )
                ],
                "collocations": [],
            }
        }
    }
    monkeypatch.setattr(presentation, "shard", lambda _: {itself["lexeme_id"]: stored})
    monkeypatch.setattr(reader, "stored", lambda _: None)
    assert presentation.present(itself)["senses"][sid]["synonyms"] == []
    other_release = {**itself, "release_id": "unrelated-release"}
    assert [r["text"] for r in presentation.present(other_release)["senses"][sid]["synonyms"]] == forbidden

    food = {
        "release_id": data["source_release"],
        "lexeme_id": "65a67e1f-758a-5461-a706-e2e07dbdeff6",
        "display_lemma": "cake",
        "part_of_speech": "n",
        "lexical_type": "word",
        "senses": [
            {
                "sense_id": "4d245a0c-9a49-457b-a9e5-6a3d045caac1",
                "definition_en": "food made from or based on a mixture of flour, sugar, eggs, and fat, typically cooked in an oven",
                "cefr": "B1",
                "translations": [{"text": "tort"}],
                "examples": [],
            },
            {
                "sense_id": "8e641b23-55e5-4511-ab1d-e0433df0c93d",
                "definition_en": "a block of solid substance (such as soap or wax)",
                "cefr": "A2",
                "translations": [{"text": "bo‘lak"}],
                "examples": [],
            },
        ],
        "forms": [],
        "relations": [],
        "collocations": [],
    }
    monkeypatch.setattr(presentation, "shard", lambda _: {})
    view = presentation.present(food)
    assert {r["text"] for r in view["senses"][food["senses"][0]["sense_id"]]["collocations"]} == {
        "birthday cake", "chocolate cake"
    }
    assert view["senses"][food["senses"][1]["sense_id"]]["collocations"] == []
    assert presentation.present({**food, "release_id": "unrelated-release"})["senses"][food["senses"][0]["sense_id"]]["collocations"] == []


def test_every_editorial_example_preserves_grammar_and_its_source_identity():
    corrections = presentation.example_corrections()
    num_examples = 0
    for lexeme_id, senses in corrections["entries"].items():
        assert len(lexeme_id) == 36
        for sense_id, record in senses.items():
            assert len(sense_id) == 36
            assert len(record["meaning_sha"]) == 64
            for example_id, item in record["examples"].items():
                assert len(example_id) == 36
                assert item["original_en"].strip()
                assert item["text_en"][-1] in ".?!"
                assert item["text_uz"][-1] in ".?!"
                assert item["text_en"][0].isupper()
                assert item["text_uz"][0].isupper()
                assert len(item["text_en"].split()) >= 4
                num_examples += 1
    assert num_examples == 233


def test_terzetto_curation_excludes_numerical_synonyms_and_keeps_musical_trio(monkeypatch):
    e = {
        'release_id': 'rel-v1-1fa06d8d41d8ff701632573e',
        'lexeme_id': '670b7b89-7e98-59f2-a02f-890028ec5165',
        'display_lemma': 'terzetto',
        'part_of_speech': 'n',
        'lexical_type': 'word',
        'forms': [],
        'senses': [{
            'sense_id': 'aad9fee0-fbbc-5565-92ef-858166eb4920',
            'definition_en': 'the cardinal number that is the sum of one and one and one',
            'translations': [{'text': 'uch'}],
            'examples': [],
        }],
        'relations': [
            {
                'relation_type': 'synonym',
                'display_lemma': 'three',
                'target_lexeme_id': 'c343f3d2-5553-5418-8d63-2678f40831a5',
                'target_sense_id': '2ced960e-58db-498d-a92c-42dd6982aeaf',
            },
        ],
        'collocations': [],
    }
    monkeypatch.setattr(reader, 'stored', lambda _: None)
    monkeypatch.setattr(presentation, 'shard', lambda _: {})
    sense_id = e['senses'][0]['sense_id']
    row = presentation.present(e)['senses'][sense_id]
    assert row['synonyms'] == [{
        'text': 'trio',
        'lexemeId': '2eff4bba-1bb6-5dfa-9079-1a3ca8d3a601',
        'senseId': '24087232-6200-4e00-98d9-3212c842bf3b',
    }]
    assert row['antonyms'] == []
    untouched = presentation.present({**e, 'release_id': 'unrelated-release'})
    assert [s['text'] for s in untouched['senses'][sense_id]['synonyms']] == ['three']


def test_corrected_actus_reus_does_not_retain_generic_wrongdoing_synonyms(monkeypatch):
    e = {
        'release_id': 'rel-v1-1fa06d8d41d8ff701632573e',
        'lexeme_id': '660bb696-af24-52eb-bb78-ed1c4a74a1e3',
        'display_lemma': 'actus reus',
        'part_of_speech': 'n',
        'lexical_type': 'word',
        'forms': [],
        'senses': [{
            'sense_id': '9dc9e4dd-a4dc-5068-8541-654b596fc748',
            'definition_en': 'activity that transgresses moral or civil law',
            'translations': [{'text': 'huquqbuzarlik harakati'}],
            'examples': [],
        }],
        'relations': [
            {
                'relation_type': 'synonym',
                'display_lemma': 'misconduct',
                'target_lexeme_id': '399fadbd-d220-5439-a826-adef9eca72f6',
                'target_sense_id': '8e731676-ea88-4765-b384-50f533fdd550',
            },
        ],
        'collocations': [],
    }
    monkeypatch.setattr(reader, 'stored', lambda _: None)
    monkeypatch.setattr(presentation, 'shard', lambda _: {})
    sid = e['senses'][0]['sense_id']
    view = presentation.present(e)
    assert view['senses'][sid]['synonyms'] == []
    assert e['relations'][0]['display_lemma'] == 'misconduct'
