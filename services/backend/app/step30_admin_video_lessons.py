"""Staff TED / Podcast authoring, provider, transcript, vocabulary, questions,
version history and audit. Port of api/admin/video-lessons and data/video-lessons.
"""
from __future__ import annotations
import json,os,re
from urllib.parse import urlsplit,parse_qs
from fastapi import APIRouter,Request
from . import main as core
from .preview_contract import current_preview
from .step25_content_version import version_hashes,encoded,digest
from .step30_video_lexical import ingest_video_occurrences

router=APIRouter()
VIDEO_ID=re.compile(r'^[A-Za-z0-9_-]{11}$')
DIRECT_ID=re.compile(r'^[A-Za-z0-9_-]{1,32}\.(mp4|webm)$')
YOUTUBE={'youtube.com','www.youtube.com','m.youtube.com','music.youtube.com',
        'youtube-nocookie.com','www.youtube-nocookie.com','youtu.be','www.youtu.be'}
ERROR_TEXT={'unsupported_host':'Only YouTube links can be played inside Learners Area. Other hosts open as an external link instead.',
    'no_video_id':'That link does not contain a video id — copy the link from the video page itself.',
    'invalid_id':'That does not look like a real video id (11 characters). Check the link.',
    'invalid_url':'That is not a link the centre can read.'}

def parse_provider(raw,media_origin=None):
    text=raw.strip()
    if not text:return None,'no_video_id'
    if '/' not in text and '://' not in text:
        return (('youtube',text),None) if VIDEO_ID.fullmatch(text) else (None,'invalid_id')
    try:
        uri=urlsplit(text if text.startswith('http') else 'https://'+text)
        if uri.scheme not in ('http','https') or not uri.hostname:return None,'invalid_url'
    except (ValueError,TypeError):return None,'invalid_url'
    if media_origin and uri.scheme=='https' and f'{uri.scheme}://{uri.netloc}'==media_origin:
        ident=uri.path.removeprefix('/media/') if uri.path.startswith('/media/') else ''
        return (('direct',ident),None) if DIRECT_ID.fullmatch(ident) and not uri.query and not uri.fragment else (None,'invalid_id')
    if uri.hostname not in YOUTUBE:return None,'unsupported_host'
    if uri.hostname.endswith('youtu.be'):
        ident=next((seg for seg in uri.path.split('/') if seg),'')
    elif uri.path=='/watch':ident=parse_qs(uri.query).get('v',[None])[0]
    else:
        ident=next((uri.path[len(prefix):].split('/')[0] for prefix in ('/embed/','/shorts/','/live/','/v/') if uri.path.startswith(prefix)),None)
    if not ident:return None,'no_video_id'
    if not VIDEO_ID.fullmatch(ident):return None,'invalid_id'
    return ('youtube',ident),None

class Bad(Exception):
    def __init__(self,message):self.message=message

def text(v,minn,maxn,*,trim=False,path=''):
    if not isinstance(v,str):raise Bad('Required')
    result=v.strip() if trim else v
    if len(result)<minn:raise Bad(f'String must contain at least {minn} character(s)')
    if len(result)>maxn:raise Bad(f'String must contain at most {maxn} character(s)')
    return result

def num(v,low,high,*,integer=False):
    if type(v) not in (int,float):raise Bad('Expected number, received '+('null' if v is None else 'string'))
    if integer and int(v)!=v:raise Bad('Expected integer, received float')
    if v<low:raise Bad(f'Number must be greater than or equal to {low}')
    if v>high:raise Bad(f'Number must be less than or equal to {high}')
    return int(v) if integer else v

def schema(body):
    if not isinstance(body,dict):raise Bad('Expected object, received null')
    out={}
    for key in ('lessonId','videoLessonId'):
        if body.get(key) is not None:
            if not isinstance(body[key],str) or not core.uuid_value(body[key]):raise Bad('Invalid uuid')
            out[key]=body[key]
        else:out[key]=None
    kind=body.get('mediaKind')
    if kind is not None and kind not in ('video','audio'):raise Bad("Invalid enum value. Expected 'video' | 'audio'")
    out['mediaKind']=kind
    out['title']=text(body.get('title'),3,200,trim=True)
    out['videoUrl']=text(body.get('videoUrl'),3,500,trim=True)
    for key,maxn in [('beforeYouWatch',2000),('transcriptAttribution',200),('transcriptText',20000),('notes',4000)]:
        out[key]=text(body[key],0,maxn) if body.get(key) is not None else None
    out['durationSeconds']=num(body['durationSeconds'],0,43200,integer=True) if body.get('durationSeconds') is not None else None
    source=body.get('transcriptSource')
    if source is not None and source not in ('authored','licensed','permitted'):raise Bad('Invalid enum value')
    out['transcriptSource']=source
    lines=body.get('transcript')
    if lines is not None:
        if not isinstance(lines,list):raise Bad('Expected array')
        if len(lines)>2000:raise Bad('Array must contain at most 2000 element(s)')
        out['transcript']=[]
        for line in lines:
            if not isinstance(line,dict):raise Bad('Expected object')
            out['transcript'].append({'startSeconds':num(line.get('startSeconds'),0,43200),
                                      'text':text(line.get('text'),0,600)})
    else:out['transcript']=None
    vocabulary=body.get('vocabulary')
    if vocabulary is not None:
        if not isinstance(vocabulary,list):raise Bad('Expected array')
        if len(vocabulary)>100:raise Bad('Array must contain at most 100 element(s)')
        out['vocabulary']=[]
        for item in vocabulary:
            if not isinstance(item,dict):raise Bad('Expected object')
            out['vocabulary'].append({'word':text(item.get('word'),1,120,trim=True),
                'pos':text(item.get('pos'),0,30),'def':text(item.get('def'),1,500,trim=True),
                'uz':text(item.get('uz'),0,500),'ex':text(item.get('ex',''),1 if current_preview.get() else 0,500,trim=True)})
    else:out['vocabulary']=None
    questions=body.get('questions')
    if questions is not None:
        if not isinstance(questions,list):raise Bad('Expected array')
        if len(questions)>200:raise Bad('Array must contain at most 200 element(s)')
        out['questions']=[]
        for row in questions:
            if not isinstance(row,dict):raise Bad('Expected object')
            if row.get('stage') not in ('comprehension','gap_fill'):raise Bad('Invalid enum value')
            ans=row.get('acceptedAnswers')
            if not isinstance(ans,list):raise Bad('Expected array')
            if not 1<=len(ans)<=8:raise Bad('Array must contain at least 1 element(s)' if not ans else 'Array must contain at most 8 element(s)')
            out['questions'].append({'stage':row['stage'],'prompt':text(row.get('prompt'),3,600,trim=True),
                'acceptedAnswers':[text(a,1,200,trim=True) for a in ans],
                'atSeconds':num(row['atSeconds'],0,43200,integer=True) if row.get('atSeconds') is not None else None})
    else:out['questions']=None
    return out

async def pin_video(con,source,title,content,media_kind,vid,actor):
    # source versions.ts: only the semantic projection differs from full content.
    module='ted';typ='audio_lesson' if media_kind=='audio' else 'video_lesson'
    h=version_hashes(module,typ,content)
    semantic={k:content[k] for k in ('mediaKind','provider','videoId','durationSeconds','beforeYouWatch','notes','transcript','transcriptText',
                'transcriptLines','questions','vocabulary','timeline') if k in content}
    h['semantic_hash']=digest({'module':module,'contentType':typ,'semester':'assessment-semantics/v1','content':semantic})
    before=await con.fetchrow('''SELECT id,version_no,status,content_hash,semantic_hash,answer_key_hash,track
        FROM content_versions WHERE module=$1 AND content_type=$2 AND source_ref=$3 ORDER BY version_no DESC LIMIT 1''',module,typ,source)
    if before and before['semantic_hash']==h['semantic_hash']:
        await con.execute("UPDATE content_versions SET title=$2,track='unspecified',publication_state='published' WHERE id=$1",before['id'],title)
        return before['id']
    if before and before['status']=='published':await con.execute("UPDATE content_versions SET status='superseded',superseded_at=NOW() WHERE id=$1",before['id'])
    kind='created' if not before else 'answer_key' if before['answer_key_hash']!=h['answer_key_hash'] else 'semantic'
    row=await con.fetchrow('''INSERT INTO content_versions(module,content_type,source_ref,version_no,status,title,track,content_hash,semantic_hash,
        answer_key_hash,content_snapshot,publication_state,target_type,target_id,created_by_user_id,change_kind,provenance,published_at)
        VALUES($1,$2,$3,$4,'published',$5,'unspecified',$6,$7,$8,$9::jsonb,'published','video_lesson',$10,$11,$12,$13::jsonb,NOW()) RETURNING id''',
        module,typ,source,(before['version_no'] if before else 0)+1,title,h['content_hash'],h['semantic_hash'],h['answer_key_hash'],
        encoded(content),vid,actor,kind,json.dumps({'origin':'authored','mediaKind':media_kind,'provider':content['provider']}))
    return row['id']

@router.post('/api/admin/video-lessons')
async def admin_video_create(req:Request):
    staff=await core.current_user(req,active=True)
    if not staff or staff['role'] not in ('teacher','admin','owner'):return core.j({'error':'forbidden'},403)
    try:b=schema(await core.payload(req))
    except Bad as ex:return core.j({'error':'invalid_input','detail':ex.message},400)
    if b['lessonId'] and b['videoLessonId']:return core.j({'error':'invalid_input','detail':'lessonId_or_videoLessonId'},400)
    if b['transcript'] and b['transcriptText'] and b['transcriptText'].strip():return core.j({'error':'invalid_input','detail':'transcript_ambiguous'},400)
    from .preview_contract import current_preview
    if current_preview.get() and b['vocabulary']:
        context='\n'.join(str(x) for x in [b['transcriptText'],*[line['text'] for line in b['transcript'] or []],b['notes']] if x)
        if any(item['ex'] not in context for item in b['vocabulary']):
            return core.j({'error':'vocabulary_context_required'},400)
    if (b['transcript'] or b['transcriptText'] and b['transcriptText'].strip()) and not b['transcriptSource']:
        return core.j({'error':'invalid_input','detail':'transcript_source_required'},400)
    db=await core.pool()
    async with db.acquire() as con:
        current=None
        if b['videoLessonId']:current=await con.fetchrow('SELECT * FROM video_lessons WHERE id=$1',core.uuid_value(b['videoLessonId']))
        elif b['lessonId']:current=await con.fetchrow('SELECT * FROM video_lessons WHERE lesson_id=$1',core.uuid_value(b['lessonId']))
        if current and staff['role']=='teacher' and str(current['created_by_user_id'])!=str(staff['id']):
            return core.j({'error':'forbidden'},403)
        origin=os.environ.get('AUTHORIZED_MEDIA_ORIGIN')
        from .security import normalize_origin
        provider,reason=parse_provider(b['videoUrl'],normalize_origin(origin))
        if reason:return core.j({'error':'video_rejected','reason':reason,'detail':ERROR_TEXT[reason]},400)
        media_kind=b['mediaKind'] or 'video'
        lesson_id=core.uuid_value(b['lessonId']) if b['lessonId'] else None
        if lesson_id and not await con.fetchval('SELECT id FROM lessons WHERE id=$1',lesson_id):return core.j({'error':'lesson_not_found'},404)
        if not lesson_id and b['videoLessonId']:
            current=await con.fetchrow('SELECT * FROM video_lessons WHERE id=$1 AND lesson_id IS NULL',core.uuid_value(b['videoLessonId']))
            if not current:return core.j({'error':'video_lesson_not_found'},404)
        duplicate=await con.fetchrow('SELECT id FROM video_lessons WHERE provider=$1 AND video_id=$2',provider[0],provider[1])
        if duplicate and (not current or duplicate['id']!=current['id']):return core.j({'error':'video_exists'},409)
        source_ref=(current['source_ref'] if current and current['source_ref'] else re.sub(r'[^a-z0-9._-]+','-',f'{media_kind}-{provider[0]}-{provider[1]}'.lower())[:80])
        transcript=b['transcript'] if b['transcript'] else None
        transcript_text=b['transcriptText'].strip() if b['transcriptText'] and b['transcriptText'].strip() else None
        notes=b['notes'].strip() if b['notes'] and b['notes'].strip() else None
        async with con.transaction():
            if current:
                vid=current['id']
                await con.execute('''UPDATE video_lessons SET lesson_id=$2,media_kind=$3,source_ref=$4,provider=$5,video_id=$6,title=$7,
                  before_you_watch=$8,duration_seconds=$9,transcript_source=$10,transcript_attribution=$11,transcript=$12::jsonb,
                  transcript_text=$13,notes=$14,updated_at=NOW() WHERE id=$1''',vid,lesson_id,media_kind,source_ref,provider[0],provider[1],b['title'],
                  b['beforeYouWatch'],b['durationSeconds'],b['transcriptSource'],b['transcriptAttribution'],json.dumps(transcript) if transcript else None,
                  transcript_text,notes)
            else:
                row=await con.fetchrow('''INSERT INTO video_lessons(lesson_id,media_kind,source_ref,provider,video_id,title,before_you_watch,
                   duration_seconds,transcript_source,transcript_attribution,transcript,transcript_text,notes,created_by_user_id)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) RETURNING id''',
                   lesson_id,media_kind,source_ref,provider[0],provider[1],b['title'],b['beforeYouWatch'],b['durationSeconds'],
                   b['transcriptSource'],b['transcriptAttribution'],json.dumps(transcript) if transcript else None,transcript_text,notes,staff['id'])
                vid=row['id']
            if b['questions'] is not None:
                await con.execute('DELETE FROM video_lesson_questions WHERE video_lesson_id=$1',vid)
                for n,question in enumerate(b['questions']):
                    await con.execute('''INSERT INTO video_lesson_questions(video_lesson_id,stage,position,prompt,accepted_answers,at_seconds)
                       VALUES($1,$2,$3,$4,$5::jsonb,$6)''',vid,question['stage'],n,question['prompt'],json.dumps(question['acceptedAnswers']),question['atSeconds'])
            if b['vocabulary'] is not None:
                await con.execute("DELETE FROM lexical_occurrences WHERE video_lesson_id=$1 AND source_type='video'",vid)
                text='\n'.join(v for v in [transcript_text,*[line['text'] for line in transcript or []],notes] if v)
                await ingest_video_occurrences(con,vid,text,b['vocabulary'])
            content={'mediaKind':media_kind,'provider':provider[0],'videoId':provider[1],
                     'durationSeconds':b['durationSeconds'],'beforeYouWatch':b['beforeYouWatch'],'notes':notes,
                     'transcriptLines':len(transcript or []),'transcriptText':transcript_text,
                     'questions':[{'stage':x['stage'],'prompt':x['prompt'],'acceptedAnswers':x['acceptedAnswers']} for x in b['questions'] or []],
                     'vocabulary':[{'word':x['word'],'pos':x['pos']} for x in b['vocabulary'] or []]}
            await pin_video(con,source_ref,b['title'],content,media_kind,vid,staff['id'])
        await con.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
             VALUES($1,'video_lesson.saved','video_lesson',$2,$3::jsonb)''',staff['id'],vid,json.dumps({'lessonId':b['lessonId'],
             'standalone':not b['lessonId'],'hasTranscript':bool(transcript or transcript_text),'hasNotes':bool(notes)}))
    return core.j({'ok':True,'id':str(vid)})

def install():core.app.include_router(router)
