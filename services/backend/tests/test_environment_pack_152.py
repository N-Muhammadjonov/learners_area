"""Environment pack retains the original 152 plus 69 source-based terms."""
import asyncio
import json
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch
from starlette.requests import Request
from app import step21_packs_port as port
from app.step21_vocab_batch import sense_key
from app.step19_vocab_games_port import builtin_ids, conditions
from app.vocabulary_game_content import eligible_words, gap_prompt
from app.vocabulary_flashcard_batches import source_groups, named_parts, batch_plan

ROOT=Path(__file__).resolve().parents[1]/'app'

def words():
    packs=json.loads((ROOT/'vocabulary_builtin_packs.json').read_text(encoding='utf-8'))
    return next(p['words'] for p in packs if p['id']=='environment')

def test_223_translations_are_complete_and_playable_in_all_seven_games():
    entries=words()
    assert len(entries)==223
    assert entries[0]['term']=='acid rain'
    assert entries[151]['term']=='independent nation'
    assert entries[-1]['term']=='semi-arid'
    assert {'agricultural runoff','deforestation','critically endangered species',
            'renewable energy','monsoon','IUCN Red List'} <= {w['term'] for w in entries}
    assert len({sense_key(w) for w in entries})==223
    for entry in entries:
        for key,maxlen in (('term',120),('definitionEn',500),('translationUz',500),('example',500)):
            assert isinstance(entry[key],str) and 0<len(entry[key])<=maxlen
        assert len(entry.get('acceptedTranslations',[]))<=4
    projected=[{'id':str(i+1),'exampleSentence':w['example'],**w} for i,w in enumerate(entries)]
    for game in ('cards','choice','match','gap','race','translation','builder'):
        assert len(eligible_words(projected,game))==223,game
    assert gap_prompt(projected[93])=='It felt ______ by the coast.'
    assert gap_prompt(projected[107])=='Take an umbrella: ______.'
    assert gap_prompt(projected[120])=='Investment slowed in the current ______.'
    assert 'environment' in builtin_ids()
    args=['learner']
    assert 'uv.topic_pack=$2' in conditions('topic',None,'environment',args)

def test_source_groups_keep_original_152_words_and_all_added_sections():
    entries=words()
    groups=json.loads((ROOT/'vocabulary_pack_groups.json').read_text(encoding='utf-8'))['environment']
    assert len(groups)==11
    assert [g['end']-g['start'] for g in groups]==[23,32,29,9,25,19,15,24,24,14,9]
    assert groups[0]['start']==0 and groups[-1]['end']==223
    assert groups[6]['end']==152
    assert all(groups[i]['end']==groups[i+1]['start'] for i in range(10))
    source_groups.cache_clear()
    mapping=source_groups()
    records=[]
    for i,entry in enumerate(entries):
        key=sense_key(entry)
        assert mapping[('environment',key)][2]==i
        records.append({'id':str(i+1),'topic_pack':'environment','sense_key':key,
                        'term':entry['term'],'part_of_speech':entry['partOfSpeech'],
                        'definition_en':entry['definitionEn']})
    parts=named_parts(records)
    assert [label for label,_ in parts]==[g['label'] for g in groups]
    ordered=[entry for _,part in parts for entry in part]
    assert ordered==[str(i+1) for i in range(223)]
    plan=batch_plan(ordered,{},parts)
    assert len(plan)==11 and sum(p['count'] for p in plan)==223
    assert [p['unlocked'] for p in plan]==[True]+[False]*10

def test_environment_fallback_import_preserves_translations_and_synonyms():
    actor=uuid.UUID(int=91)
    folder=uuid.UUID(int=92)
    class Connection:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):return False
        def transaction(self):return self
        async def fetchrow(self,sql,*args):
            if 'FROM vocabulary_topic_packs' in sql:
                assert args==('environment',)
                return None
            assert 'FOR UPDATE' in sql
            return {'id':actor}
        async def fetchval(self,sql,*args):
            if 'FROM vocabulary_topic_packs' in sql:return uuid.UUID(int=93)
            assert args==(actor,'Environment')
            return folder
        async def execute(self,sql,*args):
            assert args==(actor,'environment',folder)
            return 'UPDATE 0'
    class Pool:
        def acquire(self):return Connection()
    async def run():
        with patch.object(port.core,'current_user',AsyncMock(return_value={'id':actor})),\
             patch.object(port.core,'payload',AsyncMock(return_value={'packId':'environment'})),\
             patch.object(port.core,'pool',AsyncMock(return_value=Pool())),\
             patch.object(port,'add_batch',AsyncMock(return_value={'ok':True,'added':223,'duplicates':0,'points':0})) as add:
            req=Request({'type':'http','method':'POST','path':'/api/vocabulary/packs',
                         'query_string':b'','headers':[],'scheme':'https','server':('test.invalid',443)})
            response=await port.add_pack(req)
            assert response.status_code==200
            assert json.loads(response.body)=={'ok':True,'added':223,'duplicates':0,'points':0}
            items=add.call_args.args[2]
            assert len(items)==223
            assert items[93]['acceptedTranslations']==['chilly','nippy']
            assert all(w['authored'] is True and w['translationUz'] for w in items)
            assert add.call_args.kwargs=={'topic_pack':'environment','source_type':'topic_pack','folder_id':folder}
    asyncio.run(run())
