"""Exercise the actual file, ASGI, and PostgreSQL directory import flow."""
from __future__ import annotations

import asyncio
import base64
import csv
import io
import resource
import time
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from openpyxl import Workbook, load_workbook

from _finance_schema import http  # noqa: F401
from test_academy_groups import BASE
from app import main
from app.academy_directory_files import FIELDS, spreadsheet

API = '/api/staff/academy/directory'
MIGRATION = Path(__file__).resolve().parents[1]/'migrations'/'1127_academy_directory_import.sql'
COLUMNS = {name:i for i,name in enumerate(FIELDS)}


@pytest_asyncio.fixture
async def directory_http(http, monkeypatch):
    await http.con.execute(BASE)
    await http.con.execute(MIGRATION.read_text())
    async def signed_in(req, active=False):
        role = req.headers.get('x-directory-test-role','owner')
        account = http.people.get(role)
        return {'id':account,'role':role} if account else None
    monkeypatch.setattr(main,'current_user',signed_in)
    monkeypatch.setenv('RATE_LIMIT_BACKEND','memory')
    return http


def workbook_payload(data: bytes, kind='csv', sheet=None):
    return {'format':kind,'data':base64.b64encode(data).decode(),'sheet':sheet}


def import_body(rows, source='old-campus', kind='csv'):
    return {**workbook_payload(spreadsheet(kind,FIELDS,rows),kind),'source':source,'columns':COLUMNS}


async def preview(client, command, page=1):
    response = await client.post(API+'/import/preview',json=command,params={'page':page})
    assert response.status_code == 200,response.text
    return response.json()


def confirmation(command, data):
    return {**command,'commandId':str(uuid4()),'reviewHash':data['reviewHash']}


@pytest.mark.asyncio
async def test_preview_apply_and_repeat_keep_existing_identity_and_stage_missing_account(directory_http):
    client=directory_http
    student=client.people['student']
    await client.con.execute("UPDATE users SET email='matched@fixture.invalid',name='Existing Name' WHERE id=$1",student)
    rows=[('S01','Imported name','MATCHED@fixture.invalid','student',None),
          ('T99','Pending Staff','new@fixture.invalid','teacher',None),
          ('A01','Invalid Admin','admin@fixture.invalid','admin',None),
          ('S10','Duplicate A','duplicate@fixture.invalid','student',None),
          ('S11','Duplicate B','duplicate@fixture.invalid','student',None)]
    payload=import_body(rows)
    read=await client.post(API+'/import/inspect',json=workbook_payload(spreadsheet('csv',FIELDS,rows)))
    assert read.status_code == 200 and read.json()['suggested']==COLUMNS
    data=await preview(client,payload)
    assert data['ready']==2
    assert data['counts']=={'ready_link':1,'ready_stage':1,'unsupported_role':1,'duplicate_email':2}
    assert await client.con.fetchval('SELECT count(*) FROM academy_directory_records')==0
    command=confirmation(payload,data)
    responses=await asyncio.gather(*(client.post(API+'/import/apply',json=command) for _ in range(2)))
    assert [r.status_code for r in responses]==[200,200], [r.text for r in responses]
    report=responses[0].json()
    assert report==responses[1].json() and report['linked']==report['staged']==1
    assert await client.con.fetchval('SELECT count(*) FROM academy_directory_imports')==1
    assert await client.con.fetchval("SELECT count(*) FROM audit_log WHERE action='academy.directory.imported'")==1
    assert await client.con.fetchval("SELECT name FROM users WHERE id=$1",student)=='Existing Name'
    assert await client.con.fetchval("SELECT user_id FROM academy_directory_records WHERE external_id='S01'")==student
    assert await client.con.fetchval("SELECT user_id FROM academy_directory_records WHERE external_id='T99'") is None
    assert not await client.con.fetchval("SELECT 1 FROM users WHERE email='new@fixture.invalid'")
    issues=await client.get(API+'/imports/'+report['batchId']+'/issues.csv')
    assert '4,unsupported_role' in issues.text and 'duplicate@fixture' not in issues.text
    assert (await client.get(API+'/imports/'+report['batchId']+'/issues.csv',
                             headers={'x-directory-test-role':'admin'})).status_code==403
    changed=await client.post(API+'/import/apply',json={**command,'source':'other'})
    assert changed.status_code==409 and changed.json()['error']=='idempotency_conflict'
    before=await preview(client,payload)
    assert before['counts']['already_staged']==1
    teacher=client.people['teacher']
    await client.con.execute("UPDATE users SET email='new@fixture.invalid' WHERE id=$1",teacher)
    after=await preview(client,payload)
    assert after['counts']['ready_link']==1
    assert (await client.post(API+'/import/apply',json=confirmation(payload,after))).json()['linked']==1
    assert await client.con.fetchval("SELECT user_id FROM academy_directory_records WHERE external_id='T99'")==teacher
    assert (await preview(client,payload))['ready']==0


@pytest.mark.asyncio
async def test_xlsx_formula_and_role_boundaries_and_csv_escape(directory_http):
    client=directory_http
    book=Workbook()
    book.active.title='Cover'
    book.active.append(['Other'])
    sheet=book.create_sheet('Roster')
    sheet.append(['Внешний ID','ФИО','Почта','Роль','User ID'])
    sheet.append(['C01','Spreadsheet Student','a@fixture.invalid','ученик',None])
    sheet.append(['C02','=SUM(1,2)','b@fixture.invalid','student',None])
    out=io.BytesIO()
    book.save(out)
    command={**workbook_payload(out.getvalue(),'xlsx','Roster'),'source':'xlsx-source','columns':COLUMNS}
    data=await preview(client,command)
    assert data['counts']=={'ready_stage':1,'formula_cell':1}
    assert (await client.post(API+'/import/apply',json=confirmation(command,data))).status_code==200
    for role in ('admin','student','teacher'):
        headers={'x-directory-test-role':role}
        assert (await client.post(API+'/import/preview',json=command,headers=headers)).status_code==403
        assert (await client.get(API+'/export/xlsx',headers=headers)).status_code==403
    student=client.people['student']
    await client.con.execute("UPDATE users SET name='=1+1' WHERE id=$1",student)
    output=await client.get(API+'/export/csv',params={'role':'student'})
    assert output.status_code==200 and output.headers['cache-control']=='private, no-store'
    rows=list(csv.DictReader(io.StringIO(output.content.decode('utf-8-sig'))))
    assert next(row['name'] for row in rows if row['user_id']==str(student))=="'=1+1"
    typed=await client.get(API+'/export/xlsx',params={'role':'student'})
    workbook=load_workbook(io.BytesIO(typed.content))
    row=next(r for r in workbook.active.iter_rows(min_row=2) if r[4].value==str(student))
    assert row[1].value=='=1+1' and row[1].data_type=='s'
    workbook.close()
    for name in ('academy_directory_imports','academy_directory_records'):
        assert await client.con.fetchval('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',name)
        assert not await client.con.fetchval("SELECT has_table_privilege('authenticated',$1,'SELECT')",name)


@pytest.mark.asyncio
async def test_apply_rejects_stale_account_match(directory_http):
    client=directory_http
    student=client.people['student']
    payload=import_body([('D-1','Placeholder','fresh@fixture.invalid','student',None)])
    data=await preview(client,payload)
    await client.con.execute("UPDATE users SET email='fresh@fixture.invalid' WHERE id=$1",student)
    rejected=await client.post(API+'/import/apply',json=confirmation(payload,data))
    assert rejected.status_code==409 and rejected.json()['error']=='preview_changed'
    assert not await client.con.fetchval('SELECT 1 FROM academy_directory_records')


@pytest.mark.asyncio
async def test_owner_can_resolve_unmatched_row_to_explicit_account_without_role_change(directory_http):
    client=directory_http
    student=client.people['student']
    command=import_body([('EX1','Learner','old@fixture.invalid','student',None)])
    data=await preview(client,command)
    assert (await client.post(API+'/import/apply',json=confirmation(command,data))).status_code==200
    pending=await client.get(API+'/pending',params={'source':command['source']})
    assert pending.json()['rows'][0]['external_id']=='EX1'
    link={'source':command['source'],'externalId':'EX1','userId':str(student)}
    assert (await client.post(API+'/pending/link',json=link,headers={'x-directory-test-role':'admin'})).status_code==403
    wrong=await client.post(API+'/pending/link',json={**link,'userId':str(client.people['teacher'])})
    assert wrong.status_code==422 and wrong.json()['error']=='account_role_mismatch'
    for _ in range(2):
        assert (await client.post(API+'/pending/link',json=link)).status_code==200
    assert (await client.get(API+'/pending',params={'source':command['source']})).json()['rows']==[]
    assert await client.con.fetchval("SELECT count(*) FROM audit_log WHERE action='academy.directory.linked'")==1
    assert await client.con.fetchval('SELECT user_id FROM academy_directory_records')==student


@pytest.mark.parametrize('size',[500,5000,10000])
@pytest.mark.asyncio
async def test_directory_import_sizes(directory_http,size):
    client=directory_http
    rows=[(str(i),f'Fixture {i}',f'fixture{i}@fixture.invalid','student',None) for i in range(size)]
    start=time.perf_counter()
    payload=import_body(rows,kind='xlsx' if size==10000 else 'csv')
    data=await preview(client,payload)
    inspected=time.perf_counter()
    assert data['ready']==size and len(data['rows'])==100
    result=await client.post(API+'/import/apply',json=confirmation(payload,data))
    assert result.status_code==200,result.text
    finished=time.perf_counter()
    assert result.json()['staged']==size
    assert await client.con.fetchval('SELECT count(*) FROM academy_directory_records')==size
    print(f'directory size={size} format={payload["format"]} preview_ms={(inspected-start)*1000:.1f} '
          f'apply_ms={(finished-inspected)*1000:.1f} process_peak_rss_kib={resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}')
