"""Adjacent source pair integrity and publication-safe Part 3 navigation."""
import gzip,json
from pathlib import Path
from uuid import UUID
from test_speaking_catalog_port import SpeakingDB,setup,client,PROMPT
TARGET=UUID('cccccccc-cccc-cccc-cccc-cccccccccccc')

class LinkedDB(SpeakingDB):
    def __init__(self,visible=True):super().__init__();self.visible=visible
    async def fetchrow(self,sql,*args):
        self.calls.append(('fetchrow',sql,args))
        if len(self.calls)==1:return {'id':PROMPT,'part':'part2','studySupport':{'relatedPart3Id':str(TARGET)}}
        return {'id':TARGET,'topicKey':'059. travelling'} if self.visible else None

def test_link_only_exposes_published_non_deleted_part3_in_the_same_channel(monkeypatch):
    db=LinkedDB();setup(monkeypatch,db)
    result=client.get(f'/api/speaking/prompts/{PROMPT}/support')
    assert result.status_code==200
    assert result.json()['relatedPart3']=={'promptId':str(TARGET),'topicKey':'059. travelling'}
    sql,args=db.calls[1][1:]
    assert 'CONTENT_DELETED' in sql and "publication_state='published'" in sql
    assert 'p.available_in' in sql and 'part3' in args and TARGET==args[-1]

def test_missing_or_unpublished_target_does_not_generate_a_broken_link(monkeypatch):
    db=LinkedDB(False);setup(monkeypatch,db)
    result=client.get(f'/api/speaking/prompts/{PROMPT}/support')
    assert result.status_code==200 and 'relatedPart3' not in result.json()

def test_uploaded_source_has_all_pairs_and_prioritises_only_the_66_new_pairs():
    bank=json.loads(gzip.decompress((Path(__file__).resolve().parents[1]/'assets/speaking/paired166.json.gz').read_bytes()))
    rows=bank['records'];by_id={r['id']:r for r in rows}
    two=[r for r in rows if r['part']=='part2'];three=[r for r in rows if r['part']=='part3']
    assert len(two)==166 and len(three)==697 and len({r['topic'] for r in three})==166
    assert len(by_id)==863
    for r in two:
        meta=r['study_support'];target=by_id[meta['relatedPart3Id']]
        assert meta['sourcePairNumber']==target['study_support']['sourcePairNumber']
        assert target['study_support']['relatedPart2Id']==r['id']
        assert meta['sourceNew']==(meta['catalogOrder']<=66)
        assert r['follow_ups'] and all(r['study_support'][k] for k in ['ideasHtml','modelAnswerHtml','vocabulary'])
    variant=next(r for r in two if r['study_support']['sourcePairNumber']==159)
    assert by_id[variant['study_support']['relatedPart3Id']]['topic']=='059. Travelling'
    assert all('[NEW]' not in r['topic'] and '[NEW]' not in r['prompt_text'] for r in rows)
    assert all(r['study_support']['ideasHtml'] and r['study_support']['modelAnswerHtml'] and r['study_support']['vocabulary'] for r in three)
    assert all('<p>' not in w['exampleSentence'] for r in rows for w in r['study_support']['vocabulary'])
