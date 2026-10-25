"""Apply approved, validated Listening conversions without changing learner history.

Source: src/lib/import/listening/legacy.ts applyListeningConversion,
        src/app/api/admin/listening/tests/[id]/convert/route.ts.
"""
from __future__ import annotations
import json
from fastapi import APIRouter, Request
from . import main as core
from .step38_content_validation import parse_package, InvalidPackage, package_hash

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
KINDS={'completion':'short_answer','mcq':'mcq_single','matching':'matching','map':'map_labeling'}
MCQ={'mcq_single','mcq_multi'}
# Type ids are the source's precise identity; don't infer from the option array.
CODES={'short_answer','form_completion','note_completion','table_completion','flow_chart_completion',
 'summary_completion','sentence_completion','mcq_single','mcq_multi','matching','classification',
 'map_labeling','plan_labeling','diagram_labeling'}

def stored_listening(pkg):
    c=pkg['content']; audio=c['audio'];decl={a['key']:a for a in pkg['assets']}
    audio_path=audio.get('path') or decl.get(audio['assetKey'],{}).get('path') or audio['assetKey']
    image=c.get('image');image_path=c.get('imagePath') or (decl.get(image['assetKey'],{}).get('path') or image['assetKey'] if image else None)
    p={'schemaVersion':1,'legacyRuntime':False,'testId':pkg['sourceRef'],'title':pkg['title'],
       'category':'full','collection':c['collection'],
       'provenance':pkg['provenance'].get('note') or pkg['provenance'].get('source','unknown'),
       'audio':{'path':audio_path,'durationSec':audio['durationSec']},'imagePath':image_path,
       'sections':c['sections'],'questions':c['questions'],'keyword1':c['keyword1'],
       'keyword2':c['keyword2'],'vocabulary':c['vocabulary']}
    for key in ('studyPack','programme','mapDiagram'):
        if key in c:p[key]=c[key]
    return p

async def reconcile(con,test_id,stored):
    rows=await con.fetch('SELECT id,"order" FROM listening_questions WHERE test_id=$1',test_id)
    by_order={row['order']:row['id'] for row in rows};keep=set();retained=[]
    for q in stored['questions']:
        # Source listeningQuestionIdentity: only genuine MCQ types occupy the
        # multiple_choice storage enum. Matching/map use short_answer despite a
        # shared option pool (which is NOT proof of an MCQ question).
        from .step40_content_drafts import resolve_listening_type
        stated=resolve_listening_type(q.get('typeCode'))
        typ=stated['id'] if stated else KINDS.get(q.get('kind'))
        storage='multiple_choice' if typ in MCQ else 'short_answer'
        key=q['key'];answer=next((x for x in q['options'] if x==key or x.startswith(key+' ')),key)
        values=(storage,typ,q['text'],json.dumps(q['options'],ensure_ascii=False),answer,q['evidence']['why'])
        if q['number'] in by_order:
            keep.add(by_order[q['number']])
            await con.execute('''UPDATE listening_questions SET type=$2,type_code=$3,question_text=$4,
               options=$5::jsonb,correct_answer=$6,explanation=$7 WHERE id=$1''',by_order[q['number']],*values)
        else:
            await con.execute('''INSERT INTO listening_questions(test_id,"order",type,type_code,question_text,options,correct_answer,explanation)
              VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)''',test_id,q['number'],*values)
    for row in rows:
        if row['id'] in keep:continue
        attempts=await con.fetchval('SELECT 1 FROM listening_attempts WHERE test_id=$1 LIMIT 1',test_id)
        sessions=await con.fetchval('SELECT 1 FROM listening_mcq_sessions WHERE question_id=$1 LIMIT 1',row['id'])
        if sessions and not attempts:retained.append(row['order'])
        if not attempts and not sessions:
            await con.execute('DELETE FROM listening_questions WHERE id=$1',row['id'])
    if retained:
        numbers=', '.join(str(n) for n in sorted(retained))
        singular=len(retained)==1
        return [f'Question {numbers} {"was" if singular else "were"} not in this package but {"is" if singular else "are"} kept because learners have completed work recorded against {"it" if singular else "them"}. The superseded question is retained for history and is not served to new learners.']
    return []

async def apply_conversion(con, test_id, actor, pkg):
    row=await con.fetchrow('''SELECT t.publication_state,p.source_id FROM listening_packages p
      JOIN listening_tests t ON t.id=p.test_id WHERE p.test_id=$1''',test_id)
    if not row:return {'ok':False,'error':'not_found'}
    stored=stored_listening(pkg);digest=package_hash(pkg)
    await con.execute('''UPDATE listening_packages SET payload=$2::jsonb,source_hash=$3,legacy_runtime=false
      WHERE test_id=$1''',test_id,json.dumps(stored,ensure_ascii=False),digest)
    await con.execute('UPDATE listening_tests SET transcript=$2 WHERE id=$1',test_id,
                      '\n\n'.join(s['transcript'] for s in stored['sections']))
    await reconcile(con,test_id,stored)
    previous=await con.fetchrow('''SELECT content_version FROM content_imports
       WHERE module='listening' AND content_type='full_test' AND source_ref=$1
       ORDER BY content_version DESC LIMIT 1''',stored['testId'])
    provenance={'source':'legacy_conversion','sourceRef':stored['testId'],'module':'listening',
       'contentType':'full_test','schemaVersion':pkg['schemaVersion'],'importedBy':str(actor),
       'importedAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z')}
    await con.execute('''INSERT INTO content_imports(module,content_type,schema_version,import_version,
       source_ref,content_hash,content_version,status,target_type,target_id,actor_user_id,
       original_filename,legacy_runtime,assets,provenance,result,note)
       VALUES('listening','full_test',$1,1,$2,$3,$4,'converted','listening_test',$5,$6,$7,false,
         '[]'::jsonb,$8::jsonb,$9::jsonb,$10)''',pkg['schemaVersion'],stored['testId'],digest,
        (previous['content_version'] if previous else 0)+1,test_id,actor,pkg['provenance'].get('originalFilename'),
        json.dumps(provenance),json.dumps({'action':'converted','questions':len(stored['questions']),
                             'previousPublication':row['publication_state']}),
        'Converted from the legacy review surface.')
    return {'ok':True,'questions':len(stored['questions']),'contentHash':digest}

@router.post('/api/admin/listening/tests/{id}/convert')
async def convert_listening(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('owner','admin'):return core.j({'error':'forbidden'},403)
    db=await core.pool()
    async with db.acquire() as con:
        if not await con.fetchval("SELECT to_regclass('public.content_imports') IS NOT NULL"):
            return core.j({'error':'qa_migration_0040_required'},503)
        test_id=core.uuid_value(id)
        if test_id is None:return core.j({'error':'not_found'},404)
        raw=await core.payload(req)
        try:
            if not isinstance(raw,dict) or 'package' not in raw or not isinstance(raw['package'],dict):
                raise InvalidPackage('schema_invalid',[{'level':1,'code':'schema_invalid','message':'Required','blocking':True}])
            pkg,_=parse_package(raw['package'])
            if pkg['module']!='listening' or pkg['contentType']!='full_test':
                raise InvalidPackage('schema_invalid',[{'level':1,'code':'schema_invalid','message':'Invalid package type','blocking':True}])
        except InvalidPackage as exc:
            return core.j({'error':'invalid_package','issues':exc.items},400,PRIVATE)
        existing=await con.fetchrow('SELECT source_id FROM listening_packages WHERE test_id=$1',test_id)
        if not existing or pkg['sourceRef']!=existing['source_id']:
            return core.j({'error':'source_conflict','detail':'The converted package must keep the original sourceRef.'},409)
        async with con.transaction():
            result=await apply_conversion(con,test_id,user['id'],pkg)
        if not result['ok']:return core.j({'error':result['error']},409)
        await con.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
          VALUES($1,'content.import.legacy_converted','listening_test',$2,$3::jsonb)''',user['id'],str(test_id),
          json.dumps({'questions':result['questions'],'contentHash':result['contentHash']}))
    return core.j({'ok':True,'applied':True,'questions':result['questions']},headers=PRIVATE)

def install():core.app.include_router(router)
