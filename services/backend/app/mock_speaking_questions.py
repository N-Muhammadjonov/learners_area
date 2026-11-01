"""Private, immutable per-question recordings; no external AI call or transcript certification."""
import hashlib,json,uuid
from fastapi import APIRouter,Request
from starlette.datastructures import UploadFile
from . import main as core

router=APIRouter()
MAX_BYTES=10*1024*1024

async def available(con):
    return bool(await con.fetchval("SELECT to_regclass('public.mock_speaking_question_captures') IS NOT NULL"))

def snapshot(attempt):
    value=attempt.get('mock_snapshot') or {}
    return json.loads(value) if isinstance(value,str) else value

def questions(attempt):
    return snapshot(attempt).get('speakingMaterial',{}).get('parts',[])

def question_mode(attempt):
    return snapshot(attempt).get('speakingCaptureMode')=='question'

def _capture(value):
    if not isinstance(value,dict) or set(value)-{'text','status','reason'}:return None
    text=value.get('text','');status=value.get('status','unavailable')
    if not isinstance(text,str) or len(text)>40000 or status not in ('unavailable','browser_unverified'):return None
    try:text.encode('utf-8')
    except UnicodeEncodeError:return None
    if '\x00' in text:return None
    if status=='unavailable' and text:return None
    # Store exactly what recognition returned. No trimming, spelling correction,
    # punctuation rewrite, filler removal or assertion that this text is exact.
    return {'text':text,'status':status,'reason':str(value.get('reason') or '')[:120]}

async def rows(con,attempt_id):
    return await con.fetch('SELECT * FROM mock_speaking_question_captures WHERE attempt_id=$1 ORDER BY part,question_id',attempt_id)


def public_row(row):
    capture=row['transcript_capture']
    capture=json.loads(capture) if isinstance(capture,str) else capture
    return {'part':row['part'],'questionId':str(row['question_id']),'questionIds':[str(row['question_id'])],
            'codec':row['codec'],'bytes':row['bytes'],'durationMs':row['duration_ms'],'sha256':row['sha256'],
            'objectKey':row['object_key'],'captureStatus':'finalized',
            'transcriptStatus':(capture or {}).get('status','unavailable')}


@router.post('/api/mocks/attempts/{id}/speaking/responses')
async def upload_response(req:Request,id:str):
    from . import mock_system_port as mock
    user=await mock._auth_user(req)
    denied=mock._require_student(user)
    if denied:return denied
    from .rate_limit import async_counter,too_many
    limited=await async_counter('upload_intent',str(user['id']),consume=True)
    if limited:return too_many(limited)
    aid=core.uuid_value(id)
    if not aid:return mock._err('not_found','Attempt not found.',404)
    db=await core.pool()
    async with db.acquire() as con:
        attempt,denied=await mock._check_attempt_ownership(con,aid,user)
        if denied:return denied
        if not question_mode(attempt):return mock._err('question_capture_unavailable','This attempt uses original Part recordings.',409)
        if attempt['status']!='in_progress':return mock._err('attempt_closed','Attempt is closed.',409)
        skills=list(dict.fromkeys(s['skill'] for s in snapshot(attempt).get('sections',[])))
        if 'speaking' not in skills or attempt['active_section_position']!=skills.index('speaking')+1:
            return mock._err('section_locked','Speaking is not the active section.',409)
    try:
        async with req.form(max_files=1,max_fields=8,max_part_size=200000) as form:
            part=str(form.get('part') or '')
            qid=core.uuid_value(form.get('questionId'))
            duration=int(form.get('durationMs') or 0)
            transcript=_capture(json.loads(str(form.get('transcriptCapture') or '{}')))
            declared_sha=form.get('sha256')
            file=form.get('audio')
            if not isinstance(file,UploadFile):return mock._err('empty_audio','Original recording is required.',422)
            mime=(file.content_type or '').split(';')[0].strip().lower()
            raw=await file.read(MAX_BYTES+1)
    except (ValueError,TypeError):return mock._err('invalid_input','Invalid question recording metadata.',422)
    if not qid or not any(q.get('part')==part and q.get('questionId')==str(qid) for q in questions(attempt)):
        return mock._err('invalid_question','Question is not part of this frozen Speaking attempt.',422)
    if not transcript or not 1<=duration<=600000:
        return mock._err('invalid_input','Invalid duration or transcript capture.',422)
    if mime not in mock.ALLOWED_SPEAKING_MIMES:return mock._err('unsupported_codec','Unsupported recording format.',422)
    if not 64<=len(raw)<=MAX_BYTES:return mock._err('file_too_large','Each question audio must be 64 bytes to 10 MB.',413)
    if mock._verify_audio_magic(raw,mime):return mock._err('invalid_audio','Invalid recording container.',422)
    digest=hashlib.sha256(raw).hexdigest()
    if declared_sha!=digest:return mock._err('hash_mismatch','Original recording checksum mismatch.',409)
    ext={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/aac':'aac','audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3'}[mime]
    async def existing(con):
        return await con.fetchrow('SELECT * FROM mock_speaking_question_captures WHERE attempt_id=$1 AND part=$2 AND question_id=$3',aid,part,qid)
    async with db.acquire() as con:
        previous=await existing(con)
    if previous:
        if previous['sha256']!=digest or previous['transcript_capture']!=transcript:
            return mock._err('recording_immutable','This question already has a finalized recording.',409)
        return core.j({'ok':True,**public_row(previous)},headers=mock.PRIVATE_HEADERS)
    key=f'mock/responses/{aid}/{qid}/{uuid.uuid4()}.{ext}'
    try:await mock._write_storage_object(key,raw,mime)
    except Exception:return mock._err('storage_unavailable','Audio is retained locally; retry upload.',503)
    async with db.acquire() as con:
        async with con.transaction():
            current,denied=await mock._check_attempt_ownership(con,aid,user,for_update=True)
            if denied:return denied
            if current['status']!='in_progress':return mock._err('attempt_closed','Attempt is closed.',409)
            open_section=await con.fetchval("SELECT status='in_progress' AND submitted_at IS NULL AND now()<=deadline_at+interval '15 seconds' FROM mock_section_submissions WHERE attempt_id=$1 AND skill='speaking'",aid)
            if not open_section:return mock._err('section_closed','Speaking is closed.',409)
            previous=await existing(con)
            if previous:
                if previous['sha256']!=digest or previous['transcript_capture']!=transcript:
                    return mock._err('recording_immutable','This question already has a finalized recording.',409)
                return core.j({'ok':True,**public_row(previous)},headers=mock.PRIVATE_HEADERS)
            saved=await con.fetchrow("""INSERT INTO mock_speaking_question_captures
              (attempt_id,part,question_id,question_ids,object_key,codec,mime_type,bytes,duration_ms,sha256,transcript_capture)
              VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *""",
              aid,part,qid,json.dumps([str(qid)]),key,ext,mime,len(raw),duration,digest,json.dumps(transcript,ensure_ascii=False))
    return core.j({'ok':True,**public_row(saved)},headers=mock.PRIVATE_HEADERS)
