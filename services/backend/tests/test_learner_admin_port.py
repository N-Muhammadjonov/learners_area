"""Contract tests without a live database for staff content/report and writing activation."""
import uuid
from fastapi.testclient import TestClient
from app import main as core
from app.learner_admin_port import _clean_custom, _activation_key
from test_migration_phase2 import Conn, FakePool

client=TestClient(core.app)
UID=uuid.UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
VERSION=uuid.UUID('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')


def auth(monkeypatch,conn,role='teacher'):
    async def user(req,active=False):return {'id':UID,'name':'Teacher','role':role,'account_status':'active'}
    async def pool():return FakePool(conn)
    monkeypatch.setattr(core,'current_user',user)
    monkeypatch.setattr(core,'pool',pool)


class RowsConn(Conn):
    def __init__(self,rows=None):
        super().__init__(rows)
        self.next_updated={'status':'resolved'}
        self.next_exists=VERSION
    async def fetchrow(self,sql,*args):
        self.calls.append(('fetchrow',sql,args))
        return self.next_updated
    async def fetchval(self,sql,*args):
        self.calls.append(('fetchval',sql,args))
        return self.next_exists


def test_staff_revision_list_filters_deleted_and_scopes(monkeypatch):
    conn=RowsConn([{'id':VERSION,'versionNo':3,'status':'draft',
         'publicationState':'draft','title':'New version','track':'academic',
         'answerKeyHash':'f'*64,'targetType':'reading_passage','targetId':VERSION}])
    auth(monkeypatch,conn)
    path='/api/admin/content/items/reading/passage/sample-01'
    response=client.get(path)
    assert response.status_code==200
    data=response.json()
    assert (data['module'],data['contentType'],data['sourceRef'])==('reading','passage','sample-01')
    assert data['versions'][0]['id']==str(VERSION)
    query=[c for c in conn.calls if c[0]=='fetch'][0]
    assert query[2]==('reading','passage','sample-01')
    assert "CONTENT_DELETED" in query[1] and 'ORDER BY version_no DESC' in query[1]
    conn.rows=[]
    assert client.get(path).status_code==404
    auth(monkeypatch,conn,'student')
    assert client.get(path).status_code==403


def test_report_resolution_once_and_auth(monkeypatch):
    conn=RowsConn();auth(monkeypatch,conn)
    path='/api/support/reports/'+str(VERSION)
    response=client.patch(path,json={'ignored':'yes'})
    assert response.status_code==200 and response.json()=={'ok':True,'status':'resolved'}
    query=[c for c in conn.calls if c[0]=='fetchrow'][0]
    assert query[2]==(VERSION,UID)
    assert 'resolved_at IS NULL' in query[1]
    conn.next_updated=None
    assert client.patch(path).json()=={'error':'already_resolved'}
    conn.next_exists=None
    assert client.patch(path).json()=={'error':'not_found'}
    assert client.patch('/api/support/reports/not-uuid').status_code==404
    auth(monkeypatch,conn,'student')
    assert client.patch(path).status_code==403


def test_activation_cleaning_and_key_rules():
    assert _clean_custom('  Make  a   decision ')=='Make a decision'
    assert _clean_custom('x') is None
    assert _clean_custom('abc$') is None
    assert _clean_custom('O’Connor')=='O’Connor'
    assert _activation_key('Make a decision')==_activation_key('Make the decision')
    assert _activation_key('co-operate')==_activation_key('co operate')


def test_activation_random_from_own_vocabulary(monkeypatch):
    conn=RowsConn([{'entryId':VERSION,'term':'innovative','definitionEn':'creative','translationUz':'innovatsion'}])
    auth(monkeypatch,conn,'student')
    r=client.get('/api/writing/activation/items?count=9999')
    assert r.status_code==200 and r.json()['items'][0]['term']=='innovative'
    assert r.headers['cache-control']=='no-store'
    assert conn.calls[-1][2]==(UID,30)
    r=client.get('/api/writing/activation/items?count=nan')
    assert r.status_code==200 and conn.calls[-1][2]==(UID,10)


def test_activation_resolves_exact_own_saved_and_unknown_as_custom(monkeypatch):
    conn=RowsConn([{'entryId':VERSION,'term':'make a decision',
      'definitionEn':'decide','translationUz':'qaror qabul qilmoq'}])
    auth(monkeypatch,conn,'student')
    r=client.post('/api/writing/activation/items',json={'terms':['Make the decision','unseen phrase','unseen phrase','x']})
    assert r.status_code==200
    result=r.json()['items']
    assert len(result)==2
    assert result[0]['entryId']==str(VERSION)
    assert result[1]=={'entryId':None,'term':'unseen phrase','definitionEn':None,'translationUz':None}
    assert conn.calls[0][2]==(UID,)
    for body in ({'terms':[]},{'terms':['a'],'extra':True},{'terms':[4]}, {'terms':['word']*31}):
        assert client.post('/api/writing/activation/items',json=body).status_code==400


def test_activation_error_schema_when_not_logged_in(monkeypatch):
    async def user(req,active=False):return None
    monkeypatch.setattr(core,'current_user',user)
    for method in ('get','post'):
        response=getattr(client,method)('/api/writing/activation/items')
        assert response.status_code==401
        assert response.json()=={'error':{'code':'unauthenticated','message':'Sign in again.'}}


def test_support_reports_input_fields_and_audit(monkeypatch):
    class SupportConn(RowsConn):
        async def fetchrow(self,sql,*args):
            self.calls.append(('fetchrow',sql,args))
            return {'id':VERSION,'route':'/app/speaking','module':'speaking'}
    conn=SupportConn();auth(monkeypatch,conn,'student')
    path='/api/support/reports'
    for b in ({'route':'https://attacker.example','module':'reading','message':'Something'},
              {'route':'//attacker.example','module':'reading','message':'Something'},
              {'route':'/app','module':'reading','message':'x'},
              {'route':'/app','module':'reading','message':'Something','viewport':55}):
        assert client.post(path,json=b).status_code==400,b
    r=client.post(path,json={'route':'/app/speaking','module':'speaking','message':'This is incorrect',
                            'sessionToken':'must-not-be-stored','viewport':'mobile'})
    assert r.status_code==200 and r.json()=={'ok':True,'id':str(VERSION)}
    insert=[c for c in conn.calls if c[0]=='fetchrow'][0]
    assert insert[2]==(UID,'/app/speaking','speaking','This is incorrect','mobile',None,None)
    audit=[c for c in conn.calls if c[0]=='execute'][0]
    assert 'support.reported' in audit[1] and audit[2][1]==str(VERSION)
    assert 'sessionToken' not in str(conn.calls)


def test_support_reports_staff_inbox_only(monkeypatch):
    from datetime import datetime,timezone
    conn=RowsConn([{'id':VERSION,'route':'/app/reading','module':'reading','message':'Bad link',
           'viewport':None,'build':'cb6b3cdf','lastErrorCode':None,'status':'open',
           'createdAt':datetime(2026,10,22,9,0,tzinfo=timezone.utc),
           'resolvedAt':None,'reporterName':'Learner','reporterRole':'student'}])
    auth(monkeypatch,conn,'student')
    assert client.get('/api/support/reports').status_code==403
    auth(monkeypatch,conn,'teacher')
    r=client.get('/api/support/reports')
    assert r.status_code==200
    assert r.json()['reports'][0]['createdAt']=='2026-10-22T09:00:00.000Z'
    assert r.json()['reports'][0]['reporterName']=='Learner'
    assert conn.calls[-1][0]=='fetch' and 'LIMIT 50' in conn.calls[-1][1]
