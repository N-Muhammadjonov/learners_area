"""Canonical Reading / Listening import with server-side asset ownership, transactions,
version history and real dry-run rollback.

Source: src/lib/import/core/pipeline.ts, assets.ts, reading/importer.ts,
listening/importer.ts and app/api/admin/{content,listening}/import/route.ts.
"""
from __future__ import annotations
import json,hashlib,re,uuid,logging
from fastapi import APIRouter,Request
from . import main as core
from .step38_content_validation import (parse_package,InvalidPackage,issue,package_hash,parse,legacy_v1_schema)
from .step38_content_validate import preview
from .step39_listening_conversion import stored_listening,reconcile,KINDS,CODES
from .step25_content_version import pin
from .step19_storage import read_object
from .step34_reading_import import import_set

router=APIRouter();PRIVATE={'Cache-Control':'private, no-store'}
MAX_BYTES=2*1024*1024
ERROR_STATUS={'unauthenticated':401,'forbidden':403,'payload_too_large':413,
 'asset_not_owned':409,'asset_not_finalized':409,'source_conflict':409,'source_already_imported':409,
 'schema_not_ready':503,'unknown':500}
class ImportFailure(Exception):
    def __init__(self,code,detail,level=4,path=None,missing=None):
        super().__init__(detail);self.code=code;self.detail=detail;self.level=level;self.path=path;self.missing=missing

def failure(ex):
    if isinstance(ex,InvalidPackage):
        return {'ok':False,'code':ex.code,'report':{'ok':False,'issues':[e for e in ex.items if e['blocking']],
                                      'warnings':[e for e in ex.items if not e['blocking']]},
                'detail':ex.items[0]['message'] if ex.items else None}
    d={'ok':False,'code':ex.code,'report':{'ok':False,'issues':[issue(ex.level,ex.code,ex.detail,ex.path)],'warnings':[]},
      'detail':ex.detail}
    if ex.missing is not None:d['missingAssetKeys']=ex.missing
    return d

def allowed(role,module):
    # Listening/Reading currently use management roles; never infer permission from a supplied key.
    return role in ('owner','admin')

async def claim(con,pkg,uploads,actor):
    declared=pkg['assets'];provided=[a for a in declared if uploads.get(a['key'])]
    missing=[a['key'] for a in declared if a['required'] and a not in provided]
    if missing:raise ImportFailure('asset_missing','Provide the uploaded file for: '+', '.join(missing)+'.',3,'assets',missing)
    ids=[uploads[a['key']] for a in provided]
    if len(ids)!=len(set(ids)):raise ImportFailure('duplicate_asset','The same uploaded file was assigned to two assets.',3)
    if not ids:return [],[]
    uuids=[]
    for x in ids:
        try:uuids.append(uuid.UUID(x))
        except ValueError:raise ImportFailure('asset_not_finalized','One or more uploaded files could not be found.',3)
    records=await con.fetch('SELECT * FROM upload_intents WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',uuids)
    if len(records)!=len(ids):raise ImportFailure('asset_not_finalized','One or more uploaded files could not be found.',3)
    by_id={str(r['id']):r for r in records};resolved=[];warnings=[]
    for a in provided:
        row=by_id.get(str(uuid.UUID(uploads[a['key']])))
        if not row:raise ImportFailure('asset_not_finalized','One or more uploaded files could not be found.',3)
        key=a['key'];mime=row['mime_type'];role=a['role']
        if str(row['user_id'])!=str(actor):raise ImportFailure('asset_not_owned',f'Asset "{key}" was uploaded by another account.',3)
        if row['status']!='finalized' or row['used_at']:raise ImportFailure('asset_not_finalized',f'Asset "{key}" is not a finalized, unused upload.',3)
        if row['purpose'] not in ('material_primary','material_block'):
            raise ImportFailure('asset_not_owned',f'Asset "{key}" was uploaded for a different purpose.',3)
        ok={'audio':mime.startswith('audio/') or mime=='video/webm',
            'image':mime.startswith('image/'),
            'document':mime.startswith('text/') or mime=='application/pdf' or mime.startswith('application/vnd.')}[role]
        if not ok or mime not in a['mimeTypes']:
            raise ImportFailure('asset_mime_invalid',f'Asset "{key}" is {mime}; declared types are {", ".join(a["mimeTypes"])}.',3)
        if row['size']>a['maxBytes']:
            raise ImportFailure('asset_mime_invalid',f'Asset "{key}" exceeds {a["maxBytes"]} bytes.',3)
        if a.get('sha256'):
            if row['size']<=64*1024*1024:
                raw=await read_object(row['object_key'])
                if raw is None:warnings.append(f'Asset "{key}": sha256 could not be verified against storage.')
                elif hashlib.sha256(raw).hexdigest()!=a['sha256']:
                    raise ImportFailure('asset_hash_mismatch',f'Asset "{key}" does not match the declared sha256.',3)
            else:warnings.append(f'Asset "{key}": sha256 not verified (file above the verification ceiling).')
        resolved.append({'key':key,'role':role,'uploadId':str(row['id']),
          'objectKey':row['object_key'],'mimeType':mime,'size':row['size'],'originalName':row['original_name']})
    return sorted(resolved,key=lambda a:a['key']),warnings

def counts(payload):return {'sections':len(payload['sections']),'questions':len(payload['questions']),
                              'vocabulary':len(payload['vocabulary']),'activities':len(payload.get('studyPack',{}).get('activities',[]))}

async def add_import_record(con,pkg,actor,assets,action,target,version,content_hash,result,filename=None,legacy=False,note=None):
    provenance={'source':pkg['provenance']['source'],'sourceRef':pkg['sourceRef'],
        'module':pkg['module'],'contentType':pkg['contentType'],'schemaVersion':pkg['schemaVersion'],
        'importedBy':str(actor)}
    if filename:provenance['originalFilename']=filename
    row=await con.fetchrow('''INSERT INTO content_imports(module,content_type,schema_version,import_version,source_ref,
     content_hash,content_version,status,target_type,target_id,actor_user_id,original_filename,legacy_runtime,
     assets,provenance,result,note) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16)
     RETURNING id''',pkg['module'],pkg['contentType'],pkg['schemaVersion'],pkg['sourceRef'],content_hash,version,
     action,'listening_test' if pkg['module']=='listening' else 'general_reading_set',uuid.UUID(str(target)),
     actor,filename or pkg['provenance'].get('originalFilename'),legacy,
     json.dumps([{k:x[k] for k in ('key','role','objectKey','mimeType','size')} for x in assets]),
     json.dumps(provenance),json.dumps(result),note)
    return row['id']

async def _reading(con,pkg,actor,publish,dry_run,filename):
    digest=package_hash(pkg)
    previous=await con.fetchrow('''SELECT content_hash,content_version FROM content_imports WHERE module='reading'
      AND content_type='general_set' AND source_ref=$1 ORDER BY content_version DESC LIMIT 1''',pkg['sourceRef'])
    existing=await con.fetchrow('SELECT id FROM general_reading_sets WHERE source_ref=$1',pkg['sourceRef'])
    if previous and previous['content_hash']!=digest and not dry_run:
        raise ImportFailure('source_conflict','This Reading sourceRef already exists with different content. Publishing material is never overwritten silently: use a new sourceRef (for example a version suffix).',4,'sourceRef')
    if existing:
        return {'action':'unchanged','targetId':str(existing['id']),'contentVersion':previous['content_version'] if previous else 1,
        'contentHash':digest,'publicationState':'published' if publish else 'draft','legacyRuntime':False,
        'summary':{'passages':[]},'warnings':['This sourceRef was already imported; no Reading content changed.']}
    bundle={'sourceRef':pkg['sourceRef'],'title':pkg['title'],'publish':publish,
      'passages':pkg['content']['passages'],**{k:pkg['content'][k] for k in ('description','level') if k in pkg['content']}}
    outcome=await import_set(con,bundle)
    target=str(outcome['setId'])
    record=await add_import_record(con,pkg,actor,[],'created',target,1,digest,
            {'action':'created','passages':len(outcome['passages']),'publicationState':'published' if publish else 'draft'},filename)
    await pin(con,'reading','general_set',pkg['sourceRef'],pkg['title'],pkg['content'],actor,
     'published' if publish else 'draft',target_type='general_reading_set',target_id=uuid.UUID(target),
     provenance={'origin':'import','source':pkg['provenance']['source'],'importId':str(record)})
    return {'action':'created','targetId':target,'contentVersion':1,
        'contentHash':digest,'publicationState':'published' if publish else 'draft',
        'legacyRuntime':False,'summary':{'passages':outcome['passages']},'warnings':[]}

async def _listen(con,pkg,actor,assets,publish,acknowledge,filename):
    stored=stored_listening(pkg);digest=package_hash(pkg);audio=next((a for a in assets if a['key']==pkg['content']['audio']['assetKey']),None)
    if not audio:raise ImportFailure('asset_missing','The package recording must be uploaded before it can be imported.',3,'assets')
    previous=await con.fetchrow('''SELECT id,content_version,content_hash FROM content_imports WHERE module='listening'
      AND content_type='full_test' AND source_ref=$1 ORDER BY content_version DESC LIMIT 1''',pkg['sourceRef'])
    row=await con.fetchrow('''SELECT p.test_id,p.payload,p.legacy_runtime,t.publication_state FROM listening_packages p
       JOIN listening_tests t ON t.id=p.test_id WHERE p.source_id=$1''',pkg['sourceRef'])
    programme=stored.get('programme');prev_count=previous['content_version'] if previous else 0
    if programme:
        if stored['collection']!='mcq':raise ImportFailure('semantic_invalid',f'A day of the MCQ programme is authored as an MCQ item (collection "mcq"); this package says "{stored["collection"]}".',2,'content.collection')
        claimed=await con.fetchrow('''SELECT id,title FROM listening_tests WHERE program_ref=$1
            AND program_ordinal=$2 AND ($3::uuid IS NULL OR id<>$3)''',programme['ref'],programme['day'],row['test_id'] if row else None)
        if claimed:raise ImportFailure('source_conflict',f'Day {programme["day"]} of {programme["ref"]} is already item "{claimed["title"]}". Import this material under another day, or update the day it belongs to.',4,'content.programme.day')
    if row and previous and previous['content_hash']==digest:
        return {'action':'unchanged','targetId':str(row['test_id']),'contentVersion':prev_count,'contentHash':digest,
         'publicationState':row['publication_state'],'legacyRuntime':row['legacy_runtime'],'summary':{'counts':counts(stored)},
         'warnings':['This exact package was already imported; nothing was written.']}
    answer=lambda v:'\n'.join(sorted(f'{q["number"]}:{q["key"]}:{"|".join(q["alternatives"])}:{"+".join(map(str,q["pair"]))}' for q in v['questions']))
    target=row['test_id'] if row else None
    question_warnings=[]
    if row:
        old=row['payload'];old=json.loads(old) if isinstance(old,str) else old
        changed=answer(old)!=answer(stored)
        attempts=await con.fetchval('SELECT 1 FROM listening_attempts WHERE test_id=$1 LIMIT 1',target)
        if changed and attempts and not acknowledge:raise ImportFailure('source_conflict',
          'This test already has learner attempts, and the imported package changes the answer key. Import it as a new sourceRef, or confirm that historical grades may change.',4,'content.questions')
        state='published' if publish else row['publication_state']
        await con.execute('''UPDATE listening_tests SET title=$2,transcript=$3,audio_url=$4,
           publication_state=$5 WHERE id=$1''',target,stored['title'],
           '\n\n'.join(s['transcript'] for s in stored['sections']),'/api/resources/'+audio['objectKey'],state)
        if programme:await con.execute('UPDATE listening_tests SET program_ref=$2,program_ordinal=$3 WHERE id=$1',target,programme['ref'],programme['day'])
        await con.execute('''UPDATE listening_packages SET payload=$2::jsonb,audio_object_key=$3,image_object_key=$4,
          source_hash=$5,legacy_runtime=false WHERE test_id=$1''',target,json.dumps(stored,ensure_ascii=False),audio['objectKey'],
           next((a['objectKey'] for a in assets if a['role']=='image'),None),digest)
        question_warnings=await reconcile(con,target,stored)
        known=await con.fetch('SELECT position,object_key FROM resource_blocks WHERE owner_type=\'listening\' AND owner_id=$1',target)
        existing_keys={b['object_key'] for b in known};next_position=max([r['position'] for r in known],default=-1)+1
        for item in assets:
            if item['objectKey'] in existing_keys:continue
            await _resource(con,target,actor,item,next_position);next_position+=1
        action='updated';version=prev_count+1
    else:
        state='published' if publish else 'draft'
        t=await con.fetchrow('''INSERT INTO listening_tests(title,created_by_user_id,audio_type,publication_state,
         transcript,audio_url,program_ref,program_ordinal) VALUES($1,$2,'audio',$3,$4,$5,$6,$7) RETURNING id''',
         stored['title'],actor,state,'\n\n'.join(s['transcript'] for s in stored['sections']),
         '/api/resources/'+audio['objectKey'],programme.get('ref') if programme else None,programme.get('day') if programme else None)
        target=t['id']
        await con.execute('''INSERT INTO listening_packages(test_id,source_id,payload,audio_object_key,image_object_key,source_hash,legacy_runtime)
        VALUES($1,$2,$3::jsonb,$4,$5,$6,false)''',target,stored['testId'],json.dumps(stored,ensure_ascii=False),
        audio['objectKey'],next((a['objectKey'] for a in assets if a['role']=='image'),None),digest)
        await reconcile(con,target,stored)
        for i,a in enumerate(assets):await _resource(con,target,actor,a,i)
        action='created';version=1
    await con.execute('''UPDATE upload_intents SET status='attached',used_at=NOW()
        WHERE id=ANY($1::uuid[]) AND status='finalized' ''',[uuid.UUID(a['uploadId']) for a in assets])
    record=await add_import_record(con,pkg,actor,assets,action,target,version,digest,
             {'action':action,'counts':counts(stored),'publicationState':state},filename)
    await pin(con,'listening','full_test',pkg['sourceRef'],pkg['title'],stored,actor,state,
              target_type='listening_test',target_id=target,
              provenance={'origin':'import','source':pkg['provenance']['source'],'importId':str(record)})
    return {'action':action,'targetId':str(target),'contentVersion':version,'contentHash':digest,
     'publicationState':state,'legacyRuntime':False,'summary':{'counts':counts(stored)},'warnings':question_warnings}

async def _resource(con,target,actor,item,position):
    await con.execute('''INSERT INTO resource_blocks(owner_type,owner_id,position,type,object_key,
      original_name,mime_type,size,created_by_user_id) VALUES('listening',$1,$2,$3,$4,$5,$6,$7,$8)''',
      target,position,'audio' if item['role']=='audio' else 'image' if item['role']=='image' else 'file',
      item['objectKey'],item['originalName'],item['mimeType'],item['size'],actor)

class RollbackDryRun(Exception):
    def __init__(self,result):self.result=result

async def run_import(con,actor,pkg,uploads,dry_run=False,publish=False,acknowledge=False,filename=None):
    # Validate asset intents and writes in the same transaction; dry-run must roll everything back.
    try:
        async with con.transaction():
            resolved,warnings=await claim(con,pkg,uploads,actor['id'])
            wants_publish=publish or pkg['publication']['state'] in ('published','scheduled')
            can_publish=actor['role'] in ('admin','owner')
            real_publish=can_publish and wants_publish
            if wants_publish and not can_publish:
                warnings.append('Publication requires an administrator; the import is saved as a draft.')
            if pkg['module']=='reading':result=await _reading(con,pkg,actor['id'],real_publish,dry_run,filename)
            else:result=await _listen(con,pkg,actor['id'],resolved,real_publish,acknowledge,filename)
            if not dry_run and result['action']!='unchanged':
                await con.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
                 VALUES($1,$2,$3,$4,$5::jsonb)''',actor['id'],
                 'content.import.created' if result['action']=='created' else 'content.import.updated',
                 'listening_test' if pkg['module']=='listening' else 'general_reading_set',result['targetId'],
                 json.dumps({'module':pkg['module'],'contentType':pkg['contentType'],
                   'schemaVersion':pkg['schemaVersion'],'sourceRef':pkg['sourceRef'],'contentHash':result['contentHash'],
                   'contentVersion':result['contentVersion'],'legacyRuntime':False,
                   'publicationState':result['publicationState']}))
            response={'ok':True,'dryRun':dry_run,'module':pkg['module'],'contentType':pkg['contentType'],
              'schemaVersion':pkg['schemaVersion'],'title':pkg['title'],'sourceRef':pkg['sourceRef'],
              **({'migratedFrom':pkg['_migratedFrom']} if '_migratedFrom' in pkg else {}),
              'contentHash':result['contentHash'], 'action':'unchanged' if dry_run else result['action'],
              'targetType':'listening_test' if pkg['module']=='listening' else 'general_reading_set',
              'targetId':result['targetId'],'contentVersion':0 if dry_run else result['contentVersion'],
              'publicationState':'draft' if dry_run else result['publicationState'],
              'legacyRuntime':result['legacyRuntime'],'summary':result['summary'],
              'warnings':warnings+result['warnings'],
              'provenance':{'source':pkg['provenance']['source'],'description':pkg['provenance'].get('note',''),
                            'importedBy':str(actor['id'])},
              'assets':[{k:a[k] for k in ('key','role','mimeType','size')} for a in resolved],
              'preview':preview(pkg)}
            if dry_run:raise RollbackDryRun(response)
            return response
    except RollbackDryRun as ex:return ex.result

async def _route_import(req,user,body):
    pkg=body['package'] if body.get('package') is not None else body.get('raw')
    # JS !pkg considers [] and {} truthy, unlike Python's bool().
    if pkg is None or pkg is False or (type(pkg) in (int,float) and pkg==0) or pkg=='':
        raise ImportFailure('invalid_input','Missing `package`.')
    if not pkg:raise ImportFailure('invalid_input','Missing `package`.')
    try:parsed,warnings=parse_package(pkg)
    except InvalidPackage as ex:return failure(ex)
    if not allowed(user['role'],parsed['module']):
        raise ImportFailure('forbidden',f'Your role cannot import {parsed["module"]} content.',4,'module')
    db=await core.pool()
    async with db.acquire() as con:
        ready=await con.fetchval("SELECT to_regclass('public.content_imports') IS NOT NULL")
        if not ready:raise ImportFailure('schema_not_ready','qa_migration_0040_required')
        uploads={k[:61]:v for k,v in body.get('assetUploads',{}).items()
                 if isinstance(k,str) and isinstance(v,str) and len(v)<=64} if isinstance(body.get('assetUploads'),dict) else {}
        return await run_import(con,user,parsed,uploads,body.get('dryRun') is True,
            body.get('publish') is True,body.get('acknowledgeGradeImpact') is True,
            body.get('originalFilename','')[:255] if isinstance(body.get('originalFilename'),str) else None)

@router.post('/api/admin/content/import')
async def generic_import(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    raw=await req.body()
    if len(raw)>MAX_BYTES:return core.j({'error':'payload_too_large','detail':f'Max {MAX_BYTES} bytes.'},413)
    try:body=json.loads(raw or b'null')
    except (ValueError,UnicodeDecodeError):return core.j({'error':'invalid_json'},400)
    if not isinstance(body,dict):return core.j({'error':'invalid_input','detail':'Body must be a JSON object.'},400)
    pkg=body['package'] if body.get('package') is not None else body.get('raw')
    if pkg is None or pkg is False or (type(pkg) in (int,float) and pkg==0) or pkg=='':
        return core.j({'error':'invalid_input','detail':'Missing `package`.'},400)
    try:
        outcome=await _route_import(req,user,body)
        if not outcome.get('ok'):return core.j(outcome,ERROR_STATUS.get(outcome['code'],400),PRIVATE)
        return core.j(outcome,headers=PRIVATE)
    except ImportFailure as ex:
        return core.j(failure(ex),ERROR_STATUS.get(ex.code,400),PRIVATE)
    except Exception:
        key=str(uuid.uuid4())[:8];logging.exception('content-import failed %s',key)
        return core.j({'error':'unknown','correlationId':key},500)


async def legacy_runtime_import(con,user,payload,audio_id,image_id):
    # Retain the exact JSON authored HTML runtime; it is not converted or executed.
    if payload.get('programme'):
        return {'error':'invalid_package','detail':'A day of the MCQ programme is imported as a canonical package, not as legacy authored material.','status':400}
    assets=[{'key':'audio.full','role':'audio','required':True,'mimeTypes':[
      'audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/x-wav','audio/webm','video/webm','audio/flac'],
      'maxBytes':200*1024*1024}]
    if image_id:assets.append({'key':'image.map','role':'image','required':True,'mimeTypes':['image/png','image/jpeg','image/webp'],
                     'maxBytes':20*1024*1024})
    provenance={'source':'legacy_conversion'}
    envelope={'assets':assets,'provenance':provenance,'module':'listening','contentType':'legacy_runtime',
              'sourceRef':payload['testId'],'schemaVersion':1}
    async with con.transaction():
        claimed,warnings=await claim(con,envelope,{'audio.full':str(audio_id),**({'image.map':str(image_id)} if image_id else {})},user['id'])
        previous=await con.fetchval('SELECT 1 FROM listening_packages WHERE source_id=$1',payload['testId'])
        if previous:raise ImportFailure('source_already_imported','This source identity has already been imported.',4,'sourceRef')
        stored={**payload,'legacyRuntime':True}
        digest=package_hash({'module':'listening','contentType':'legacy_runtime',
               'content':payload.get('keyword1') or payload['sections']})
        audio=next(a for a in claimed if a['role']=='audio')
        state='published'
        target=await con.fetchval('''INSERT INTO listening_tests(title,created_by_user_id,audio_type,publication_state,
           transcript,audio_url) VALUES($1,$2,'audio',$3,$4,$5) RETURNING id''',payload['title'],user['id'],state,
           '\n\n'.join(section['transcript'] for section in payload['sections']),'/api/resources/'+audio['objectKey'])
        await con.execute('''INSERT INTO listening_packages(test_id,source_id,payload,audio_object_key,image_object_key,source_hash,legacy_runtime)
            VALUES($1,$2,$3::jsonb,$4,$5,$6,true)''',target,payload['testId'],json.dumps(stored,ensure_ascii=False),
            audio['objectKey'],next((a['objectKey'] for a in claimed if a['role']=='image'),None),digest)
        for i,a in enumerate(claimed):await _resource(con,target,user['id'],a,i)
        await con.execute("UPDATE upload_intents SET status='attached',used_at=NOW() WHERE id=ANY($1::uuid[])",
            [uuid.UUID(a['uploadId']) for a in claimed])
        from datetime import datetime,timezone
        provenance={'source':'legacy_conversion','sourceRef':payload['testId'],'module':'listening',
             'contentType':'legacy_runtime','schemaVersion':1,'originalFilename':None,
             'importedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'importedBy':str(user['id'])}
        record=await con.fetchval('''INSERT INTO content_imports(module,content_type,schema_version,import_version,source_ref,
          content_hash,content_version,status,target_type,target_id,actor_user_id,legacy_runtime,assets,provenance,result,note)
          VALUES('listening','legacy_runtime',1,1,$1,$2,1,'created','listening_test',$3,$4,true,$5::jsonb,$6::jsonb,$7::jsonb,$8)
          RETURNING id''',payload['testId'],digest,target,user['id'],json.dumps([{
          k:a[k] for k in ('key','role','objectKey','mimeType','size')} for a in claimed]),json.dumps(provenance),
          json.dumps({'action':'created','legacyRuntime':True,'questions':len(payload['questions'])}),
          'Retained authored runtime; conversion to canonical data is pending owner review.')
    return {'id':str(target),'action':'created','legacyRuntime':True,'publicationIssues':[],
            'warnings':['This material still uses the legacy authored runtime; its conversion is pending.']}

def _listening_canonical_zod_issue(body):
    """First Zod 3.23 canonicalInput issue, in its schema field order."""
    def type_of(value):
        if value is None:return 'null'
        if isinstance(value,bool):return 'boolean'
        if isinstance(value,str):return 'string'
        if isinstance(value,(int,float)):return 'number'
        if isinstance(value,list):return 'array'
        return 'object'
    def wrong(expected,actual):return f'Expected {expected}, received {type_of(actual)}'
    uploads=body.get('assetUploads',{})
    if not isinstance(uploads,dict):return wrong('object',uploads)
    for value in uploads.values():
        if not isinstance(value,str):return wrong('string',value)
        if len(value)>64:return 'String must contain at most 64 character(s)'
    for key in ('dryRun','publish','acknowledgeGradeImpact'):
        if key in body and not isinstance(body[key],bool):return wrong('boolean',body[key])
    if 'originalFilename' in body:
        value=body['originalFilename']
        if not isinstance(value,str):return wrong('string',value)
        if len(value)>255:return 'String must contain at most 255 character(s)'
    return None


@router.post('/api/admin/listening/import')
async def listening_import(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if not allowed(user['role'],'listening'):return core.j({'error':'forbidden'},403)
    db=await core.pool()
    async with db.acquire() as con:
        listening_ready=await con.fetchval("SELECT to_regclass('public.listening_packages') IS NOT NULL")
        if not listening_ready:return core.j({'error':'qa_migration_0028_required'},503)
        ready=await con.fetchval("SELECT to_regclass('public.content_imports') IS NOT NULL")
        if not ready:return core.j({'error':'unknown','detail':'qa_migration_0040_required'},503)
    body=await core.payload(req)
    if not isinstance(body,dict):return core.j({'error':'invalid_package','detail':'Required'},400)
    if 'package' in body:
        zod_issue=_listening_canonical_zod_issue(body)
        if zod_issue:
            return core.j({'error':'invalid_package','detail':zod_issue[:200]},400)
        try:outcome=await _route_import(req,user,{k:v for k,v in body.items() if k!='raw'})
        except ImportFailure as ex:outcome=failure(ex)
        except Exception:
            key=str(uuid.uuid4())[:8];logging.exception('listening-import failed %s',key)
            return core.j({'error':'unknown','correlationId':key},500)
        if outcome.get('ok'):return core.j(outcome)
        code=outcome['code'];detail=outcome.get('detail');issues=outcome.get('report',{}).get('issues')
        mapcode={'schema_not_ready':'qa_migration_0040_required','asset_not_owned':'upload_not_owned_or_finalized',
                 'asset_not_finalized':'upload_not_owned_or_finalized','asset_mime_invalid':'invalid_media_type'}
        return core.j({'error':mapcode.get(code,code) if code in ('unauthenticated','forbidden','schema_not_ready','asset_missing',
          'asset_hash_mismatch','asset_not_owned','asset_not_finalized','asset_mime_invalid','duplicate_asset','source_already_imported',
          'source_conflict','unknown') else 'invalid_package','detail':detail,'issues':issues},ERROR_STATUS.get(code,400))
    if 'package' not in body and 'payload' not in body:
        return core.j({'error':'invalid_package'},400)
    # Legacy one-shot requires its own preserved HTML runtime. Never silently turn
    # executable material into a canonical package or claim it is converted.
    p=body.get('payload');audio=core.uuid_value(body.get('audioUploadId'))
    if (not isinstance(p,dict) or not isinstance(body.get('audioUploadId'),str) or not audio
        or 'imageUploadId' not in body or (body['imageUploadId'] is not None and (
           not isinstance(body['imageUploadId'],str) or core.uuid_value(body['imageUploadId']) is None))):
        return core.j({'error':'invalid_package','detail':'Required'},400)
    if bool(p.get('imagePath'))!=bool(body.get('imageUploadId')):return core.j({'error':'missing_map'},400)
    if p.get('authoredRuntime'):
        issues=[]
        parsed=parse(p,legacy_v1_schema,issues=issues)
        if issues:return core.j({'error':'invalid_package','detail':issues[0]['message'][:200]},400)
        if audio==core.uuid_value(body.get('imageUploadId')):return core.j({'error':'duplicate_asset'},400)
        try:
            async with db.acquire() as con:
                result=await legacy_runtime_import(con,user,parsed,audio,core.uuid_value(body.get('imageUploadId')))
        except ImportFailure as ex:
            code='duplicate_asset' if ex.code=='duplicate_asset' else 'upload_not_owned_or_finalized'
            return core.j({'error':code,'detail':ex.detail},400 if code=='duplicate_asset' else 409)
        if result.get('error'):return core.j({k:v for k,v in result.items() if k!='status'},result['status'])
        return core.j(result,201)
    pkg={'package':p,'assetUploads':{'audio.full':str(audio),**({'image.map':body['imageUploadId']} if body.get('imageUploadId') else {})},'publish':True}
    try:outcome=await _route_import(req,user,pkg)
    except ImportFailure as ex:outcome=failure(ex)
    if outcome.get('ok'):
        return core.j({'id':outcome['targetId'],'dryRun':False,'action':outcome['action'],
                     'publicationIssues':[],'warnings':outcome['warnings']},201 if outcome['action']=='created' else 200)
    return core.j({'error':outcome['code'],'detail':outcome.get('detail'),'issues':outcome.get('report',{}).get('issues')},
                  ERROR_STATUS.get(outcome['code'],400))

def install():core.app.include_router(router)
