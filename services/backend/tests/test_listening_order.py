import json
import unittest
from unittest.mock import AsyncMock,patch
from app.listening_order import material_order
from app import browser_listening
from app.step17_mcq_port import sequence
from app.step17_listening_course_port import SPEC,COURSE_KEY


def row(number,id=None,**extra):
    return {'id':id or str(number),'title':f'Listening Test {number}',
      'source_id':f'custom-{number}','source_ref':None,'program_ref':None,
      'payload':{'sections':[{}]*4,'questions':[{}]*40},**extra}


class OrderingTests(unittest.IsolatedAsyncioTestCase):
    def test_replacement_uuid_and_upload_date_do_not_move_test_to_the_end(self):
        original=[row(10),row(1),row(3),row(2,'old-2')]
        replacement=[r for r in original if r['id']!='old-2']+[row(2,'new-999',created_at='2099-01-01')]
        self.assertEqual([r['title'] for r in sorted(replacement,key=material_order)],
          ['Listening Test 1','Listening Test 2','Listening Test 3','Listening Test 10'])
        self.assertEqual(material_order(row(2,'old-2'))[:2],material_order(row(2,'new-999'))[:2])

    def test_authored_mcq_day_and_original_pack_numbers_are_authoritative(self):
        cards=[row(1,'late-replacement',program_ordinal=2),row(99,'first',program_ordinal=1),row(3,program_ordinal=10)]
        self.assertEqual([r['program_ordinal'] for r in sorted(cards,key=material_order)],[1,2,10])
        numbered=row(99,source_id='listening-test-2')
        self.assertEqual(material_order(numbered)[:2],(False,2))
        self.assertLess(material_order(row(10)),material_order({'id':'unclassified','title':'Extra practice'}))

    async def test_academic_catalogue_uses_numbered_order_for_a_reuploaded_test(self):
        records=[row(10),row(3),row(1),row(2,'replacement')]
        class Connection:
            async def fetch(self,sql,*args):return [] if 'WITH latest' in sql else records
            async def fetchrow(self,*args):return None
            async def fetchval(self,sql,*args):return len(records) if 'count(*)' in sql else False
        with patch.object(browser_listening,'facts',AsyncMock(return_value=([],None))),patch.object(browser_listening,'sequence',AsyncMock(return_value=True)):
            data=await browser_listening.catalogue(Connection(),{'id':'owner','role':'owner'},'academic_full_test',{})
        self.assertEqual([c['title'] for c in data['cards']],['Listening Test 1','Listening Test 2','Listening Test 3','Listening Test 10'])
        self.assertFalse(data['hasMore'])

    async def test_mcq_replacement_keeps_its_day_slot_and_the_next_day_lock(self):
        records=[row(10,'tenth',program_ordinal=10),row(3,'third',program_ordinal=3),
          row(1,'first',program_ordinal=1),row(2,'replacement',program_ordinal=2,created_at='2099-01-01')]
        for r in records:r.update(publication_state='published',publish_at=None)
        class Connection:
            async def fetch(self,sql,*args):
                if 'WITH latest' in sql:return [{'test_id':r['id'],'id':r['id']+'-q','stage':'reasoned' if r['program_ordinal']==1 else None} for r in records]
                return records
        data=await browser_listening.days(Connection(),{'id':'learner','role':'student'}, {})
        self.assertEqual([d['day'] for d in data['days']],[1,2,3,10])
        self.assertEqual([d['locked'] for d in data['days']],[False,False,True,True])
        self.assertEqual(data['days'][1]['testId'],'replacement')

    async def test_course_lock_order_matches_reuploaded_card_order(self):
        def work(source):
            spec=SPEC[source]
            return json.dumps({'version':spec['version'],'exam':True,'retry':[],
              'units':{k:v['units'] for k,v in spec['activities'].items()}})
        records=[row(3,'third',source_id='listening-test-3',values={},original_exam_submitted=False),
          row(2,'replacement',source_id='listening-test-2',values={COURSE_KEY:work('listening-test-2')},original_exam_submitted=True)]
        class Connection:
            async def fetch(self,*args):return records
        user={'id':'learner','role':'student'}
        self.assertTrue(await sequence(Connection(),user,{'id':'third','program_ref':None}))
        records[1]['values']={}
        self.assertFalse(await sequence(Connection(),user,{'id':'third','program_ref':None}))

if __name__=='__main__':unittest.main()
