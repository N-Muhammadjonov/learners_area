"""Legacy Listening authored-frame importer kept distinct from canonical packages.

Mirrors importLegacyListeningRuntime() in src/lib/import/listening/importer.ts.
HTML authoredRuntime is retained as JSON for the isolated legacy viewer, never
executed by this endpoint. All upload claims, test, package and provenance rows
are committed together; a failure rolls back the entire import.
"""
from __future__ import annotations
import hashlib,json,re,uuid
from datetime import datetime,timezone
from .step39_content_import import ImportFailure,claim,_resource

AUDIO_MIME=['audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/x-wav','audio/webm','video/webm','audio/flac']
IMAGE_MIME=['image/png','image/jpeg','image/webp']

def _canonical(value):
    if isinstance(value,str):return value.strip()
    if isinstance(value,list):return [_canonical(x) for x in value]
    if isinstance(value,dict):return {k:_canonical(v) for k,v in sorted(value.items())}
    return value

def legacy_hash(payload):
    content=payload['keyword1'] if payload['keyword1'] else payload['sections']
    raw=json.dumps(_canonical({'module':'listening','contentType':'legacy_runtime','content':content}),ensure_ascii=False,separators=(',',':'))
    return hashlib.sha256(raw.encode()).hexdigest()

def _safe_path(path):
    return isinstance(path,str) and 0<len(path)<=400 and not re.search(r'[\x00-\x1f\x7f\\:*?"<>|]',path) and not path.startswith('/') and '..' not in path.split('/') and '//' not in path

def valid_legacy(p):
    """Check legacy identity/shape before allocating uploads or canonical rows."""
    if not isinstance(p,dict) or p.get('schemaVersion')!=1 or p.get('category')!='full':return False
    if not isinstance(p.get('authoredRuntime'),dict):return False
    if not isinstance(p.get('testId'),str) or not re.fullmatch(r'[a-z0-9-]{1,80}',p['testId']):return False
    if not isinstance(p.get('title'),str) or not 1<=len(p['title'].strip())<=200:return False
    audio=p.get('audio')
    if not isinstance(audio,dict) or not _safe_path(audio.get('path')):return False
    if not isinstance(audio.get('durationSec'),(int,float)) or isinstance(audio['durationSec'],bool) or not 0<audio['durationSec']<=7200:return False
    if p.get('imagePath') is not None and not _safe_path(p.get('imagePath')):return False
    for k,maximum,minimum in [('sections',4,1),('questions',40,0),('keyword1',200,0),('keyword2',40,0),('vocabulary',40,0)]:
        if not isinstance(p.get(k),list) or not minimum<=len(p[k])<=maximum:return False
    if not all(isinstance(s,dict) and isinstance(s.get('transcript'),str) for s in p['sections']):return False
    if not isinstance(p.get('provenance'),str):return False
    if p.get('collection') is not None and p['collection'] not in ('essential','academic','general','question_types','mcq'):return False
    return True

async def import_legacy(con,payload,actor,upload_ids,original_filename=None):
    if payload.get('programme'):
        raise ImportFailure('invalid_input','A day of the MCQ programme is imported as a canonical package, not as legacy authored material.',1,'content.programme')
    specs=[{'key':'audio.full','role':'audio','required':True,'mimeTypes':AUDIO_MIME,'maxBytes':200*1024*1024}]
    if payload.get('imagePath'):
        specs.append({'key':'image.map','role':'image','required':True,'mimeTypes':IMAGE_MIME,'maxBytes':20*1024*1024})
    envelope={'assets':specs}
    async with con.transaction():
        assets,_=await claim(con,envelope,upload_ids,actor)
        audio=next((a for a in assets if a['role']=='audio'),None)
        if not audio:raise ImportFailure('asset_missing','The package recording must be uploaded before it can be imported.',3,'assets')
        if await con.fetchval('SELECT 1 FROM listening_packages WHERE source_id=$1',payload['testId']):
            raise ImportFailure('source_already_imported','This source identity has already been imported.',4,'sourceRef')
        digest=legacy_hash(payload)
        test=await con.fetchrow('''INSERT INTO listening_tests(title,created_by_user_id,audio_type,publication_state,transcript,audio_url)
             VALUES($1,$2,'audio','published',$3,$4) RETURNING id''',payload['title'],actor,
             '\n\n'.join(s['transcript'] for s in payload['sections']),'/api/resources/'+audio['objectKey'])
        if not test:raise ImportFailure('unknown','The Listening test row could not be created.',4)
        target=test['id']; image=next((a for a in assets if a['role']=='image'),None)
        stored={**payload,'legacyRuntime':True}
        await con.execute('''INSERT INTO listening_packages(test_id,source_id,payload,audio_object_key,image_object_key,source_hash,legacy_runtime)
             VALUES($1,$2,$3::jsonb,$4,$5,$6,true)''',target,payload['testId'],json.dumps(stored,ensure_ascii=False),audio['objectKey'],image['objectKey'] if image else None,digest)
        for i,a in enumerate(assets):await _resource(con,target,actor,a,i)
        await con.execute("UPDATE upload_intents SET status='attached',used_at=NOW() WHERE id=ANY($1::uuid[]) AND status='finalized'",
                          [uuid.UUID(a['uploadId']) for a in assets])
        now=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
        provenance={'source':'legacy_conversion','sourceRef':payload['testId'],'module':'listening',
                    'contentType':'legacy_runtime','schemaVersion':1,'originalFilename':original_filename,
                    'importedAt':now,'importedBy':str(actor)}
        packed=[{k:a[k] for k in ('key','role','objectKey','mimeType','size')} for a in assets]
        result={'action':'created','legacyRuntime':True,'questions':len(payload['questions'])}
        await con.execute('''INSERT INTO content_imports(module,content_type,schema_version,import_version,source_ref,
            content_hash,content_version,status,target_type,target_id,actor_user_id,original_filename,
            legacy_runtime,assets,provenance,result,note)
            VALUES('listening','legacy_runtime',1,1,$1,$2,1,'created','listening_test',$3,$4,$5,true,
            $6::jsonb,$7::jsonb,$8::jsonb,$9)''',payload['testId'],digest,target,actor,original_filename,
            json.dumps(packed),json.dumps(provenance),json.dumps(result),
            'Retained authored runtime; conversion to canonical data is pending owner review.')
        return {'id':str(target),'action':'created','legacyRuntime':True,'publicationIssues':[],
                'warnings':['This material still uses the legacy authored runtime; its conversion is pending.']}
