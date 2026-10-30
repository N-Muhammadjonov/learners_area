"""Staff-only content preview; based on canonical stored snapshots, without HTML execution.
Source: src/lib/content/preview.ts and the versions/:id/preview handler.
"""
from __future__ import annotations
import json
from fastapi import APIRouter,Request
from . import main as core

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
PROJECTIONS={
 ('listening','full_test'):['questions'],('listening','section'):['questions'],
 ('reading','general_set'):['passages'],('reading','passage'):['passages'],
 ('writing','task1'):['prompt'],('writing','task2'):['prompt'],('writing','lesson'):['body'],
 ('writing','model_text'):['body'],('writing','pattern'):['pattern'],('writing','translation_set'):['sentences'],
 ('speaking','part1_question'):['promptText'],('speaking','cue_card'):['promptText'],('speaking','part3_question'):['promptText'],
 ('speaking','material'):['primary'],('grammar','topic'):['exercises'],('vocabulary','topic_pack'):['words'],
 ('lesson','lesson'):['blocks'],('ted','video_lesson'):['media'],('ted','audio_lesson'):['media']}

def part(key,label,kind,value,problem=None):
    out={'key':key,'label':label,'kind':kind,'value':value}
    if problem:out['problem']=problem
    return out

def is_record(v):return isinstance(v,dict)
def array(c,key):return c.get(key) if is_record(c) and isinstance(c.get(key),list) else []
def text(c,key):return c.get(key) if is_record(c) else None
def number(v):return isinstance(v,(float,int)) and not isinstance(v,bool)
def string(v):return isinstance(v,str) and bool(v.strip())

def projection(module,typ,content):
    c=content if is_record(content) else {}
    p=[];pair=(module,typ)
    if pair in (('listening','full_test'),('listening','section')):
        if typ=='section':p.append(part('sectionNo','Section number','text',c.get('sectionNo'),'missing_section_no' if not number(c.get('sectionNo')) else None))
        v=array(c,'questions');p.append(part('questions','Questions (with keys)','questions',v,'no_questions' if not v else None))
        if typ=='full_test' and number(c.get('sectionNo')):p.append(part('sectionNo','Section','text',c['sectionNo']))
    elif pair in (('reading','general_set'),('reading','passage')):
        v=array(c,'passages');p.append(part('passages','Passages' if typ=='general_set' else 'Passage','passages',v,
          ('no_passages' if not v else None) if typ=='general_set' else ('passage_item_must_hold_exactly_one' if len(v)!=1 else None)))
        if typ=='general_set' and number(c.get('timeLimitMinutes')):p.append(part('timeLimitMinutes','Time limit (minutes)','text',c['timeLimitMinutes']))
    elif module=='writing':
        if typ in ('task1','task2'):
            v=c.get('prompt');p.append(part('prompt','Prompt','text',v,'missing_prompt' if not string(v) else None))
            if number(c.get('wordMinimum')):p.append(part('wordMinimum','Minimum words','text',c['wordMinimum']))
        elif typ in ('lesson','model_text'):
            v=c.get('body');p.append(part('body','Lesson body' if typ=='lesson' else 'Model text','text',v,'missing_body' if not string(v) else None))
            if typ=='model_text' and number(c.get('wordCount')):p.append(part('wordCount','Words','text',c['wordCount']))
        elif typ=='pattern':
            v=c.get('pattern');p.append(part('pattern','Pattern','text',v,'missing_pattern' if not string(v) else None))
            if isinstance(c.get('example'),str):p.append(part('example','Example','text',c['example']))
        elif typ=='translation_set':
            v=array(c,'sentences');p.append(part('sentences','Sentences','sentences',v,'no_sentences' if not v else None))
    elif module=='speaking' and typ in ('part1_question','cue_card','part3_question'):
        v=c.get('promptText');p.append(part('promptText','Prompt','text',v,'missing_prompt' if not string(v) else None))
        if string(c.get('cueCard')):p.append(part('cueCard','Cue card','text',c['cueCard']))
        if array(c,'followUps'):p.append(part('followUps','Follow-ups','text',c['followUps']))
    elif pair==('speaking','material'):
        typ0=c.get('primaryType') if isinstance(c.get('primaryType'),str) else None
        url=c.get('primaryUrl') if isinstance(c.get('primaryUrl'),str) else None
        blocks=array(c,'blocks');has_primary=c.get('hasPrimary') is True or bool(url)
        val=(f'{typ0 or "file"}' + (f' — {url}' if url else '')) if has_primary else None
        p.append(part('primary','Primary','text',val,'missing_primary' if not has_primary and not blocks else None))
        p.append(part('attachments','Attached blocks','notice',[b.get('text') or b.get('link') or b.get('type') or 'block' if is_record(b) else 'block' for b in blocks]))
        p.append(part('category','Category','text',c.get('category') if isinstance(c.get('category'),str) else None))
    elif pair==('grammar','topic'):
        v=c.get('explanation');p.append(part('explanation','Explanation','text',v,'missing_explanation' if not string(v) else None))
        ex=array(c,'exercises');p.append(part('exercises','Exercises (with keys)','questions',ex,'no_exercises' if not ex else None))
    elif pair==('vocabulary','topic_pack'):
        words=array(c,'words');p.append(part('words','Canonical senses','words',words,'no_words' if not words else None))
    elif module=='ted' and typ in ('video_lesson','audio_lesson'):
        media=c.get('media',content)
        valid=is_record(media) and (isinstance(media.get('provider'),str) or isinstance(media.get('videoUrl'),str))
        p.append(part('media','Media reference','media',media,'missing_media_reference' if not valid else None))
        if isinstance(c.get('questions'),list):p.append(part('questions','Questions','questions',c['questions']))
        if not isinstance(c.get('transcriptLines'),list) and string(c.get('transcript')):p.append(part('transcript','Transcript','text',c['transcript']))
    return p

async def lesson_projection(con,content,target):
    c=content if is_record(content) else {}
    keys=('learningArea','summary','teacherNotes','estimatedMinutes')
    snapshot_says=any(k in c for k in keys)
    row=None
    if not snapshot_says and target:
        row=await con.fetchrow('SELECT learning_area,summary,teacher_notes,estimated_minutes FROM lessons WHERE id=$1',target)
    def v(k):
        val=c.get(k) if snapshot_says else (row.get(''.join('_'+x.lower() if x.isupper() else x for x in k).lstrip('_')) if row else None)
        return val if number(val) and k=='estimatedMinutes' else val if string(val) and k!='estimatedMinutes' else None
    obj={k:v(k) for k in keys}
    obj['source']='revision' if snapshot_says else 'lesson_row' if row else 'unclassified'
    p=[part('lesson_metadata','Lesson metadata','text',obj)]
    blocks=array(c,'blocks');rendered=[]
    for block in blocks:
        if not is_record(block) or block.get('type')!='content_reference':rendered.append(block);continue
        ref=block.get('ref');resolved={'unavailable':True}
        if is_record(ref) and all(isinstance(ref.get(k),str) for k in ('module','contentType','sourceRef')):
            version=core.uuid_value(ref.get('versionId','')) if ref.get('versionId') else None
            try:
                if version:row=await con.fetchrow('SELECT id,publication_state FROM content_versions WHERE id=$1',version)
                else:row=await con.fetchrow('''SELECT id,publication_state FROM content_versions WHERE module=$1 AND content_type=$2 AND source_ref=$3 ORDER BY version_no DESC LIMIT 1''',ref['module'],ref['contentType'],ref['sourceRef'])
                if row:resolved={'versionId':str(row['id']),'publicationState':row['publication_state']}
            except Exception:pass
        else:resolved={'unavailable':True,'problem':'reference_not_checked'} if not is_record(ref) else {'unavailable':True}
        rendered.append({**block,'resolved':resolved})
    p.append(part('blocks','Typed blocks','blocks',rendered,'empty_lesson' if not blocks else None))
    return p

async def build_preview(con,row):
    c=row.get('content_snapshot')
    if isinstance(c,str):c=json.loads(c)
    pair=(row['module'],row['content_type'])
    executable=is_record(c) and ('authoredRuntime' in c or 'runtime' in c)
    canonical=None if executable else c
    issues=[];p=[]
    proj=pair in PROJECTIONS
    if not proj:issues.append('unknown_content_type' if row['module'] not in {'listening','reading','writing','speaking','grammar','vocabulary','lesson','ted'} else 'preview_not_implemented')
    if c is None:issues.append('content_snapshot_missing')
    if executable:issues.extend(['executable_content_not_previewable','executable_content_redacted'])
    if proj and canonical is not None:
        try:p=await lesson_projection(con,c,row.get('target_id')) if pair==('lesson','lesson') else projection(*pair,c)
        except Exception:p=[];issues.append('projection_failed')
    if executable and proj:p=[part('executable_runtime','Executable material','notice',None,'executable_runtime_not_previewable')]
    issues.extend(f'{x["key"]}:{x["problem"]}' for x in p if x.get('problem'))
    issues.extend('missing_core:'+k for k in PROJECTIONS.get(pair,[]) if k not in {x['key'] for x in p})
    missing=not proj or executable or canonical is None or any(x.startswith('missing_core:') or x in ('content_snapshot_missing','preview_not_implemented') for x in issues)
    state='MISSING' if missing else 'PARTIAL' if issues else 'PREVIEW_READY'
    return {'identity':{'module':pair[0],'contentType':pair[1],'sourceRef':row['source_ref'],
        'contentKey':':'.join(pair),'versionId':str(row['id']),'versionNo':row['version_no'],
        'versionIdentity':f'{pair[0]}:{pair[1]}:{row["source_ref"]}@v{row["version_no"]}',
        'status':row['status'],'publicationState':row['publication_state'],'track':row['track'],'title':row['title']},
       'canonical':canonical,'parts':p,'answerKeyVisible':True,'problems':issues,'status':state}

@router.get('/api/admin/content/versions/{id}/preview')
async def preview(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401)
    if user['role'] not in ('teacher','admin','owner'):return core.j({'error':'forbidden'},403)
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    db=await core.pool()
    async with db.acquire() as con:
        row=await con.fetchrow('''SELECT id,module,content_type,source_ref,version_no,status,publication_state,title,track,target_id,content_snapshot FROM content_versions WHERE id=$1''',core.uuid_value(id))
        if not row:return core.j({'error':'not_found'},404)
        obj=await build_preview(con,dict(row))
    return core.j({'ok':True,'preview':obj},headers=PRIVATE)

def install():core.app.include_router(router)
