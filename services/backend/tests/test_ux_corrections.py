import asyncio
import hashlib
import hmac
import json
import os
import unittest
import uuid
from unittest.mock import AsyncMock,patch
from starlette.requests import Request
from app import main as core
from app import step17_dictionary_read_port as dictionary
from app.step17_mcq_port import programme_snapshot,sequence
from app.browser_listening import days
from app.browser_reading import academic_catalogue,academic_locked
from app import retention_meaning
from app import step21_meaning_access

uid=uuid.UUID(int=1)
def ident(n):return uuid.UUID(int=n)

class ProgrammeConnection:
    def __init__(self,completed=1):self.completed=completed;self.calls=[]
    async def fetch(self,sql,*args):
        self.calls.append((sql,args))
        if 'WITH latest' in sql:
            self.asserted_user=args[0]
            return [{'test_id':ident(i+10),'id':ident(1000+i*5+q),'stage':'reasoned' if i<self.completed else None} for i in range(75) for q in range(5)]
        return [{'id':ident(i+10),'program_ref':'listening-mcq-program','program_ordinal':i+1,'title':f'Day {i+1}','publication_state':'published','publish_at':None} for i in range(75)]

class AcademicConnection:
    async def fetch(self,sql,*args):
        if 'SELECT s.id,s.title,s.created_at' in sql:
            self.catalogue_sql=sql
            return [{'id':ident(i+10),'title':f'Test {i+1}','created_at':None} for i in range(30)]
        if 'DISTINCT ON (a.set_id)' in sql:
            return [{'set_id':ident(10),'id':ident(101),'status':'completed','completed':True,'answered_count':40,'total_questions':40}]
        return [{'set_id':ident(i+10),'passage_no':n,'title':f'Part {n}'} for i in range(30) for n in (1,2,3)]

class UXTests(unittest.IsolatedAsyncioTestCase):
    async def test_mcq_catalogue_paginates_while_sequence_locks_are_global(self):
        con=ProgrammeConnection();user={'id':uid,'role':'student'}
        result=await days(con,user,{'page':'1'})
        self.assertEqual(len(result['days']),24)
        self.assertEqual([r['day'] for r in result['days']],[*range(1,25)])
        self.assertEqual([r['locked'] for r in result['days'][:4]],[False,False,True,True])
        self.assertTrue(result['hasNextPage']);self.assertEqual((result['page'],result['pageSize'],result['visibleDays']),(1,24,75))
        self.assertEqual(result['progress']['questionsPublished'],375)
        self.assertEqual(con.asserted_user,uid);self.assertEqual(len(con.calls),2)
        last=await days(con,user,{'page':'4'})
        self.assertEqual([r['day'] for r in last['days']],[73,74,75]);self.assertFalse(last['hasNextPage'])
        self.assertTrue(all(r['locked'] for r in last['days']))
        empty=await days(con,user,{'page':'99'})
        self.assertEqual(empty['days'],[]);self.assertEqual(empty['page'],99);self.assertFalse(empty['hasNextPage'])
        for index,expected in ((0,True),(1,True),(2,False),(74,False)):
            self.assertEqual(await sequence(con,user,{'id':ident(index+10),'program_ref':'listening-mcq-program'}),expected)
        other=await days(ProgrammeConnection(0),{'id':ident(2),'role':'student'},{})
        self.assertTrue(other['days'][1]['locked'])
        teacher=await days(ProgrammeConnection(0),{'id':ident(3),'role':'teacher'},{})
        self.assertTrue(all(not x['locked'] for x in teacher['days']))

    async def test_academic_catalogue_and_direct_access_share_the_original_order(self):
        con=AcademicConnection();user={'id':uid,'role':'student'}
        cards=await academic_catalogue(con,user)
        self.assertEqual(len(cards),30);self.assertEqual([c['locked'] for c in cards[:3]],[False,False,True])
        self.assertIn('min(p.test_no)',con.catalogue_sql)
        self.assertIn('CONTENT_DELETED',con.catalogue_sql)
        self.assertNotIn('LIMIT 25',con.catalogue_sql)
        self.assertTrue(await academic_locked(con,user,{'id':ident(12)}))
        self.assertFalse(await academic_locked(con,{'id':uid,'role':'owner'},{'id':ident(12)}))

    async def test_dictionary_root_with_and_without_slash_have_identical_signed_gateway(self):
        captured=[]
        class Response:
            status_code=200;content=b'{}'
            def json(self):return {'release_id':'synthetic','results':[]}
        class Client:
            def __init__(self,**kwargs):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,url,**kwargs):captured.append((url,kwargs));return Response()
        key='synthetic-test-secret-12345678901234567890'
        with patch('httpx.AsyncClient',Client),patch.dict(os.environ,{'APP_ENV':'production','DICTIONARY_SIGNING_SECRET':key}):
            for target in ['https://dictionary.example','https://dictionary.example/']:
                with patch.dict(os.environ,{'DICTIONARY_WORKER_URL':target}):await dictionary.worker({'action':'search','query':'book'})
            with patch.dict(os.environ,{'DICTIONARY_WORKER_URL':'https://dictionary.example/unexpected'}):
                with self.assertRaises(ValueError):await dictionary.worker({})
        self.assertEqual([x[0] for x in captured],['https://dictionary.example/v1/dictionary']*2)
        for _,request in captured:
            stamp,sig=request['headers']['X-LA-Dictionary-Proof'].split(':')
            import base64
            digest=hmac.new(key.encode(),b'learners-area:dictionary-gateway:v1\n'+stamp.encode()+b'\n'+request['content'],hashlib.sha256).digest()
            self.assertEqual(sig,base64.urlsafe_b64encode(digest).decode().rstrip('='))

    async def test_retention_offsets_use_utf16_and_reject_foreign_word(self):
        class Con:
            async def fetchrow(self,*args):return {'body_text':'😀 I read a book.','retention_text_version_id':ident(7)}
            async def fetch(self,*args):return [{'id':ident(9)}]
        resolved={'status':'resolved','lexeme':{'term':'book','definition_en':'written pages','translation_uz':'kitob','part_of_speech':'noun','provenance':'editorial','verification_status':'verified'}}
        with patch('app.step21_vocabulary_create.resolve_occurrence',AsyncMock(return_value=resolved)) as resolve,patch.object(retention_meaning,'worker',AsyncMock()) as worker:
            result=await retention_meaning.lookup(Con(),{'id':uid},ident(8),'book',12,16)
            self.assertEqual(result['contextual']['definitionEn'],'written pages');worker.assert_not_called()
            self.assertIsNone(await retention_meaning.lookup(Con(),{'id':uid},ident(8),'money',12,16))
            self.assertEqual(resolve.await_count,1)

    async def test_context_selection_cannot_invent_dictionary_senses(self):
        candidates=[{'entry':{'display_lemma':'bank','part_of_speech':'noun'},'sense':{'sense_id':'river','definition_en':'the land beside a river'}},{'entry':{'display_lemma':'bank','part_of_speech':'noun'},'sense':{'sense_id':'money','definition_en':'a financial institution'}}]
        response={'choices':[{'message':{'content':json.dumps({'senseId':'invented','confidence':1})}}]}
        with patch('app.step23_writing_provider.provider_spec',AsyncMock(return_value={'id':'compatible','model':'synthetic','url':'https://provider.example','headers':{}})),patch.object(retention_meaning,'request_json',AsyncMock(return_value=response)) as request:
            self.assertIsNone(await retention_meaning.select_sense('The river flooded the bank.','bank',candidates,user_id=uid))
            self.assertEqual(request.await_args.args[0],uid)
        self.assertIs(await retention_meaning.select_sense('A book.','book',candidates[:1]),candidates[0])

    async def test_context_response_is_sealed_when_reading_deadline_expires_during_lookup(self):
        class Connection:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
        class Pool:
            def acquire(self):return Connection()
        request=Request({'type':'http','query_string':f'sourceType=retention&sourceId={ident(8)}&q=book&startChar=0&endChar=4'.encode(),'headers':[]})
        with patch.object(core,'current_user',AsyncMock(return_value={'id':uid,'role':'student'})),patch.object(core,'pool',AsyncMock(return_value=Pool())),patch.object(step21_meaning_access,'text_access',AsyncMock(side_effect=['allowed','locked'])),patch.object(retention_meaning,'lookup',AsyncMock(return_value={'contextual':{'definitionEn':'PRIVATE_SOURCE'}})):
            response=await step21_meaning_access.meaning(request)
            self.assertEqual(response.status_code,403);self.assertNotIn(b'PRIVATE_SOURCE',response.body)

if __name__=='__main__':unittest.main()
