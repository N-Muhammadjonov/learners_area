"""Operational checks for checksum parity and nonblocking authentication."""
import asyncio,copy,hashlib,threading
import httpx,pytest
from uuid import UUID
from app import main as core
from app.asgi import application
from app import rate_limit
from app import step17_dictionary_read_port as dictionary
from app.dictionary_canonical import stable
from _parity_fixture import dictionary_entry

UID='aa111111-1111-4111-8111-111111111111'
REL='rel-v1-'+'a'*24


def test_remote_dictionary_entry_must_match_the_pinned_content_checksum(monkeypatch):
    value=dictionary_entry(REL,UID,'word')
    digest=hashlib.sha256(stable({k:v for k,v in value.items() if k!='release_id'}).encode()).hexdigest()
    class Connection:
        async def fetchrow(self,*args):
            return {'lexeme_id':UUID(UID),'payload':None,'worker_release':REL,'storage_release':REL,'shard_descriptor':{'shard':'aa'},'target_state':'validated','storage_offset':None,'content_sha':digest}
    delivered=copy.deepcopy(value)
    async def worker(request):return {'entry':delivered}
    monkeypatch.setattr(dictionary,'worker',worker)
    assert asyncio.run(dictionary.entry(Connection(),UUID(UID),REL))==value
    delivered['senses'][0]['definition_en']='A substituted meaning.'
    with pytest.raises(ValueError,match='dictionary_entry_checksum_mismatch'):
        asyncio.run(dictionary.entry(Connection(),UUID(UID),REL))


def test_a_password_check_does_not_block_other_http_requests(monkeypatch):
    import bcrypt
    monkeypatch.setenv('AUTH_SECRET','unit-test-only-password-parallel-secret')
    monkeypatch.setattr(rate_limit,'BUCKETS',{})
    started=threading.Event();release=threading.Event()
    def check(password,digest):
        started.set();release.wait(2);return True
    monkeypatch.setattr(bcrypt,'checkpw',check)
    class Connection:
        def acquire(self):return self
        async def __aenter__(self):return self
        async def __aexit__(self,*args):return False
        async def fetchrow(self,*args):return {'id':UUID(UID),'email':'parallel@example.test','password_hash':'test-digest','role':'student','name':'Parallel Learner','locale':'uz','onboarding_completed_at':None,'account_status':'active','auth_version':0}
    async def pool():return Connection()
    monkeypatch.setattr(core,'pool',pool)
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application),base_url='http://preview.test') as client:
            login=asyncio.create_task(client.post('/api/auth/login',json={'email':'parallel@example.test','password':'password'},headers={'origin':'http://preview.test'}))
            try:
                assert await asyncio.to_thread(started.wait,1)
                response=await client.post('/api/theme',json={'theme':'night'},headers={'origin':'http://preview.test'})
                assert response.status_code==200
                assert not login.done(), 'an unrelated request completed only after hashing blocked the event loop'
            finally:release.set()
            assert (await login).status_code==200
    asyncio.run(scenario())
