"""New route and policy regression tests; NOT live DB or Next.js differential tests."""
import json
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step22_upload_port import policy,category,extension,key_for,dangerous
from app.step22_speaking_patch import valid_patch,valid_primary,valid_block
from app.step22_listening_submit import norm,matches

client=TestClient(core.app)
ID='11111111-1111-4111-8111-111111111111'
NEW={
 ('PUT','/api/listening/attempts/{id}/draft'),
 ('POST','/api/listening/attempts/{id}/submit'),
 ('PUT','/api/materials/{type}/{id}'),
 ('POST','/api/uploads/intent'),
 ('POST','/api/uploads'),
 ('DELETE','/api/speaking/materials/{id}'),
 ('PATCH','/api/speaking/materials/{id}'),
}

def test_exact_status_and_no_extra_routes():
    d=json.loads(Path('PORT_STATUS.json').read_text())
    deployed=[(m,r.path) for r in core.app.routes for m in r.methods if r.path.startswith('/api/')]
    marked={(r['method'],r['path']) for r in d['endpoints'] if r['status'].startswith('ported_')}
    assert len(deployed)==len(set(deployed))==265
    assert set(deployed)==marked
    assert len(d['endpoints'])==265 and d['ported_methods']==265 and d['unported_methods']==0
    assert NEW <= marked

@pytest.mark.parametrize('method,path',sorted(NEW))
def test_anonymous_is_denied_before_database(monkeypatch,method,path):
    async def no_user(*args,**kwargs):return None
    async def no_pool():raise AssertionError('must not fetch data for anonymous request')
    monkeypatch.setattr(core,'current_user',no_user)
    monkeypatch.setattr(core,'pool',no_pool)
    uri=path.replace('{type}','reading').replace('{id}',ID)
    response=client.request(method,uri,json={} if method not in ('GET','DELETE') else None)
    assert response.status_code==401,(method,response.status_code,response.text)

@pytest.mark.parametrize('filename,kind,limit',[
 ('notes.pdf','file',60),('music.mp3','audio',60),('scan.png','image',10),('lesson.mp4','video',500),('manuscript.xml','primary',500)])
def test_allowed_types(filename,kind,limit):
    assert policy(filename,'application/octet-stream',min(limit,2)*1024*1024,kind) is None

@pytest.mark.parametrize('filename',[
 'root.exe','notes.exe.pdf','run.sh','package.apk','real.txt.cmd','script.php'])
def test_executable_uploads_are_refused(filename):
    assert dangerous(filename)
    assert policy(filename,'application/octet-stream',120,'primary')=='dangerous_type'

def test_media_types_and_filename_constraints():
    assert extension('note.txt')=='.txt'
    assert category('speaking_recording',None)=='audio'
    assert policy('voice.mp3','audio/mpeg',61*1024*1024,'audio')=='file_too_large'
    assert policy('photo.svg','image/svg+xml',100,'image')=='unsupported_type'
    assert policy('notes.txt','text/plain',0,'file')=='missing_file'
    a=key_for(None,None,str(uuid4()),'primary','../../attack.exe')
    assert a.startswith('pending/') and '../' not in a and a.endswith('.exe')

def test_patch_rejects_forged_attachment_and_invalid_urls():
    assert not valid_patch({'blocks':[{'type':'audio','ref':{'objectKey':''}}]})
    assert not valid_patch({'blocks':[{'type':'link','linkUrl':'javascript:alert(1)'}]})
    assert not valid_patch({'title':'a'})
    assert not valid_primary({'mode':'link','primaryType':'link','primaryUrl':'file:///etc/passwd'})
    assert valid_patch({'title':'Updated lesson','blocks':[{'type':'text','textContent':'Study this'}]})
    assert valid_block({'type':'audio','ref':{'uploadId':ID}})

def test_listening_answers_comparison():
    assert norm('  Blue  Sky')=='blue sky'
    q={'correct_answer':'B','options':['cats','birds'],'type_code':'mcq_single'}
    assert matches(q,'birds')
    assert matches(q,'b')
    assert not matches(q,'cats')
    multi={'correct_answer':'A,C','options':[],'type_code':'mcq_choose_two'}
    assert matches(multi,'C, A')
    assert not matches(multi,'B, A')
