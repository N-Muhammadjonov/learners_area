"""Owner-only full student archive: 2000-student / 10000-row caps, repeatable read
snapshot, audited downloads, Unicode PDF, DOCX and ZIP with manifest hashes.
Source: owner/student-export/route.ts and student-export/{format,pdf}.ts.
"""
from __future__ import annotations
import io,json,hashlib,uuid,zipfile
from datetime import datetime,timezone,date
from fastapi import APIRouter,Request
from fastapi.responses import Response
from . import main as core
from .rate_limit import counter,too_many
from .db import row_to_dict
router=APIRouter()
MEDIA={'pdf':'application/pdf','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','zip':'application/zip'}

def normalize(value):
    if isinstance(value,(date,datetime)):return value.isoformat(timespec='milliseconds').replace('+00:00','Z') if isinstance(value,datetime) else value.isoformat()
    if isinstance(value,uuid.UUID):return str(value)
    if isinstance(value,dict):return {k:normalize(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)):return [normalize(v) for v in value]
    return value

def archive_lines(archive):
    lines=[f"Generated: {archive['generatedAt']}",f"Students: {len(archive['students'])}",'']
    for student in archive['students']:
        lines.extend([f"{student['name']} | {student['email'] or 'Telegram'} | {student['accountStatus']}",f"Student ID: {student['id']}",f"Registered: {student['createdAt']}"])
        for skill,rows in archive['results'].items():
            own=[row for row in rows if row['userId']==student['id']]
            lines.append(f'{skill}: {len(own)} records')
            for row in own:
                for k,v in row.items():
                    if k=='userId':continue
                    if v is None:formatted='—'
                    elif isinstance(v,(dict,list)):formatted=json.dumps(v,ensure_ascii=False,separators=(',',':'))
                    elif isinstance(v,bool):formatted=str(v).lower()
                    else:formatted=str(v)
                    lines.append(f'{k}: {formatted}')
                lines.append('')
        lines.append('')
    return lines

def pdf_bytes(title,lines,id):
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    import os
    from pathlib import Path
    candidates = [Path(__file__).resolve().parents[1]/'assets/fonts/DejaVuSans.ttf',
                  Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')]
    path=os.environ.get('LEARNERS_PDF_UNICODE_FONT') or str(next((p for p in candidates if p.is_file()), candidates[0]))
    pdfmetrics.registerFont(TTFont('LA-DejaVuSans',path))
    buf=io.BytesIO();p=canvas.Canvas(buf,pagesize=(595,842),pageCompression=1)
    p.setTitle(title);p.setAuthor('Learners Area');p.setCreator('Learners Area')
    y=790;page=1
    def draw(source,size=9):
        nonlocal y,page
        for original in source.splitlines() or ['']:
            txt=''.join(c for c in original if c in ('\t',) or ord(c)>=32)
            line='';pieces=__import__('re').findall(r'\S+\s*|\s+',txt)
            def write(s):
                nonlocal y,page
                if y<55:
                    p.setFont('LA-DejaVuSans',7);p.setFillColorRGB(.4,.42,.5);p.drawString(50,28,f'{id} · {page}')
                    p.showPage();page+=1;y=790
                if s:
                    p.setFont('LA-DejaVuSans',size);p.setFillColorRGB(.12,.14,.23);p.drawString(50,y,s.rstrip())
                y-=size+5
            for piece in pieces:
                if line and pdfmetrics.stringWidth(line+piece,'LA-DejaVuSans',size)>495:
                    write(line);line=''
                if pdfmetrics.stringWidth(piece,'LA-DejaVuSans',size)<=495:line+=piece
                else:
                    for char in piece:
                        if pdfmetrics.stringWidth(line+char,'LA-DejaVuSans',size)>495:write(line);line=''
                        line+=char
            write(line)
    draw(title,16);y-=12
    for line in lines:draw(line)
    p.setFont('LA-DejaVuSans',7);p.setFillColorRGB(.4,.42,.5);p.drawString(50,28,f'{id} · {page}')
    p.save();return buf.getvalue()

def docx_bytes(title,lines):
    from docx import Document
    doc=Document();doc.add_heading(title,0)
    for line in lines:doc.add_paragraph(line)
    buf=io.BytesIO();doc.save(buf);return buf.getvalue()

def render_archive(archive,fmt):
    encoded=json.dumps(archive,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    if len(encoded)>20*1024*1024:raise ValueError('archive_too_large')
    lines=archive_lines(archive);title='Learners Area - Student records'
    if fmt=='pdf':return pdf_bytes(title,lines,archive['id'])
    if fmt=='docx':return docx_bytes(title,lines)
    files={'students.json':json.dumps(archive,ensure_ascii=False,indent=2).encode('utf-8'),
       'students.pdf':pdf_bytes(title,lines,archive['id']),'students.docx':docx_bytes(title,lines)}
    manifest={'archiveId':archive['id'],'generatedAt':archive['generatedAt'],'students':len(archive['students']),
      'files':{name:{'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()} for name,content in files.items()}}
    files['manifest.json']=json.dumps(manifest,ensure_ascii=False,indent=2).encode('utf-8')
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for name,content in files.items():z.writestr(name,content)
    return out.getvalue()

QUERY={
  'reading':"SELECT * FROM reading_attempts WHERE user_id=ANY($1::uuid[]) LIMIT 10001",
  'listening':"SELECT * FROM listening_attempts WHERE user_id=ANY($1::uuid[]) LIMIT 10001",
  'speaking':"SELECT id,user_id,part,status,transcript FROM speaking_attempts WHERE user_id=ANY($1::uuid[]) LIMIT 10001",
  'writing':"SELECT * FROM writing_submissions WHERE user_id=ANY($1::uuid[]) LIMIT 10001",
  'mocks':"SELECT * FROM mock_attempts WHERE user_id=ANY($1::uuid[]) LIMIT 10001",
  'evaluations':'''SELECT id,user_id,source_type,source_id,overall_estimate,criteria,checked_by_name,created_at
                    FROM evaluations WHERE user_id=ANY($1::uuid[]) LIMIT 10001''',
}

def camel(s):
    parts=s.split('_');return parts[0]+''.join(x.title() for x in parts[1:])

@router.get('/api/owner/student-export')
async def student_export(req:Request):
    user=await core.current_user(req,active=True)
    if not user or user['role']!='owner':return core.j({'error':'forbidden'},403)
    # Same per-owner 4/minute fixed-window throttle, before validating format.
    key=str(user['id']);limited=counter('student_archive',key,consume=True)
    if limited:return too_many(limited)
    fmt=req.query_params.get('format')
    if fmt not in MEDIA:return core.j({'error':'invalid_format'},400)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            async with con.transaction(isolation='repeatable_read',readonly=True):
                students=await con.fetch("SELECT id,name,email,account_status,created_at FROM users WHERE role='student' LIMIT 2001")
                if len(students)>2000:raise ValueError('archive_too_large')
                ids=[r['id'] for r in students];results={}
                if ids:
                    for skill,sql in QUERY.items():
                        rows=await con.fetch(sql,ids)
                        if len(rows)>10000:raise ValueError('archive_too_large')
                        results[skill]=[{camel(k):normalize(v) for k,v in row_to_dict(r).items()} for r in rows]
                stamp=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
                archive={'version':1,'id':str(uuid.uuid4()),'generatedAt':stamp,
                  'students':[{camel(k):normalize(v) for k,v in row_to_dict(r).items()} for r in students], 'results':results}
        content=render_archive(archive,fmt)
        async with db.acquire() as con:
            await con.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
              VALUES($1,'report.downloaded','student_archive',$2,$3::jsonb)''',user['id'],archive['id'],
              json.dumps({'format':fmt,'students':len(archive['students']),'records':{k:len(v) for k,v in results.items()},
                  'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}))
        return Response(content,media_type=MEDIA[fmt],headers={'Content-Disposition':f'attachment; filename="learners-area-students-{stamp[:10]}.{fmt}"',
           'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
    except ValueError as e:
        return core.j({'error':'archive_too_large' if str(e)=='archive_too_large' else 'export_unavailable'},413 if str(e)=='archive_too_large' else 503,{'Cache-Control':'private, no-store'})
    except Exception:
        return core.j({'error':'export_unavailable'},503,{'Cache-Control':'private, no-store'})

def install():
    from .rate_limit import RULES
    RULES.setdefault('student_archive',(4,60))
    core.app.include_router(router)
