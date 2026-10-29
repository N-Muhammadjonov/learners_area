"""Speaking submission; private recording persists regardless of STT/evaluation availability.
Matches strict submitAttemptSchema (the current source rejects manualTranscript in body).
"""
from __future__ import annotations
import os,json
import httpx
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
from .speaking_workflow_port import ATTEMPT_COLUMNS
from .step19_storage import valid_key,head_object,read_object
from .step31_learning_production import _language
from . import step31_coach as coach
from .rate_limit import evaluation_limit
from .ai_runtime import request_json
router=APIRouter()

async def transcribe(object_key,mime,duration,language,*,user_id=None):
    def fail(reason,retryable=False):return {'ok':False,'failure':{'reason':reason,'retryable':retryable}}
    selected=(os.getenv('STT_PRIMARY_PROVIDER') or 'none').strip()
    if selected!='openai':return fail('not_configured')
    key=(os.getenv('OPENAI_API_KEY') or '').strip();model=(os.getenv('OPENAI_STT_MODEL') or '').strip()
    if not key or not model:return fail('not_configured')
    try:
        # The original first performs a private HEAD, then reads the private bytes.
        if not valid_key(object_key):return fail('provider_error')
        if not await head_object(object_key):return fail('network')
        data=await read_object(object_key,0,24*1024*1024)
        if not data or len(data)>24*1024*1024:return fail('provider_error')
        mime=(mime or '').split(';')[0].strip()
        ext={'audio/webm':'webm','video/webm':'webm','audio/mp4':'mp4','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/flac':'flac'}.get(mime)
        if not ext:return fail('capability_missing')
        status,response=await request_json(user_id,'https://api.openai.com/v1/audio/transcriptions',{'Authorization':f'Bearer {key}'},
             data={'model':model,'response_format':'json','language':language},files={'file':(f'recording.{ext}',data,mime)},timeout=60,max_bytes=100000,with_status=True)
        if status!=200:return fail('auth_failed' if status in (401,403) else 'rate_limited' if status==429 else 'network' if status==0 else 'provider_error',status==0 or status>=500)
        if not isinstance(response,dict):return fail('invalid_response')
        text=response.get('text')
        if not isinstance(text,str) or not text.strip() or len(text)>40000:return fail('invalid_response')
        return {'ok':True,'transcript':text.strip(),'providerId':'openai'}
    except (ValueError,TypeError,KeyError,OSError,httpx.HTTPError):return fail('network',True)

@router.post('/api/speaking/attempts/{id}/submit')
async def speaking_submit(req:Request,id:str):
    aid=core.uuid_value(id)
    if not aid:return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401)
    limited=await evaluation_limit(user['id'],lightweight=False)
    if limited is not None:return limited
    db=await core.pool()
    async with db.acquire() as con:
        attempt=await con.fetchrow('SELECT * FROM speaking_attempts WHERE id=$1',aid)
        if not attempt:return core.j({'error':'not_found'},404)
        if attempt['user_id']!=user['id']:return core.j({'error':'forbidden'},403)
        if attempt['status']!='recording':return core.j({'error':'attempt_already_submitted'},409)
        if not attempt['recording_object_key']:return core.j({'error':'no_recording'},409)
    b=await core.payload(req)
    if b is None:b={}
    if not isinstance(b,dict) or set(b)-{'durationMs'} or ('durationMs' in b and (type(b['durationMs']) is not int or not 1<=b['durationMs']<=3600000)):
        return core.j({'error':'invalid_input'},400)
    duration=b.get('durationMs');language=_language(req)
    speech=await transcribe(attempt['recording_object_key'],attempt['recording_mime_type'],duration or attempt['recording_duration_ms'],language,user_id=user['id'])
    transcript=speech['transcript'] if speech['ok'] else None
    origin='stt' if transcript else None
    failure=None if speech['ok'] else speech['failure']
    async with db.acquire() as con:
        updated=await con.fetchrow(f'''UPDATE speaking_attempts SET status='submitted', submitted_at=now(),
           recording_duration_ms=COALESCE($2,recording_duration_ms), transcript=COALESCE($3,transcript),
           transcript_origin=COALESCE($4,transcript_origin),transcript_provider=COALESCE($5,transcript_provider)
           WHERE id=$1 AND user_id=$6 AND status='recording' AND recording_object_key=$7
           RETURNING {ATTEMPT_COLUMNS}''',aid,duration,transcript,origin,speech.get('providerId'),user['id'],attempt['recording_object_key'])
    if not updated:return core.j({'error':'attempt_already_submitted'},409)
    evaluation=None;error=None
    if transcript:
        async with db.acquire() as con:
            prompt=await con.fetchrow('SELECT prompt_text FROM speaking_prompts WHERE id=$1',attempt['prompt_id']) if attempt['prompt_id'] else None
        result=await coach.evaluate(user['id'],'speaking','speaking_attempt',aid,
            {'part':attempt['part'],'promptText':prompt['prompt_text'] if prompt else None,'transcript':transcript,
             'transcriptOrigin':origin,'durationMs':duration or attempt['recording_duration_ms'],'pronunciationAvailable':False},language)
        if result['ok']:
            ev=result['evaluation'];evaluation={'id':ev['id'],'checkedBy':'RIWI','fallbackUsed':ev['fallbackUsed'],
                                              'overallEstimate':ev['overallEstimate'],'verdict':ev['verdict']}
        else:error=result['error']
    return core.j({'ok':True,'attempt':row_to_dict(updated),'transcriptOrigin':origin,
       'transcriptionFailure':failure,'evaluationError':error,'recordingSaved':True,
       'evaluated':evaluation is not None,'evaluation':evaluation})

def install():core.app.include_router(router)
