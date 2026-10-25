"""Admin import preview: validate entire envelope/domain, detect asset gaps,
source revision state and duplicates, never write imported data.
Source: /api/admin/content/validate and lib/import/core/*.
"""
from __future__ import annotations
import json,hashlib
from fastapi import APIRouter,Request
from . import main as core
from .step38_content_validation import InvalidPackage,parse_package,issue,requirements,package_hash,standard_hash,provenance_text

router=APIRouter(); PRIVATE={'Cache-Control':'private, no-store'}

def preview(pkg):
    c=pkg['content'];lines=[{'label':'Source identity','value':pkg['sourceRef']}]
    if pkg['module']=='reading':
        passages=c['passages'];lines.extend([{'label':'Passages','value':str(len(passages))},
            {'label':'Questions','value':str(sum(len(p['questions']) for p in passages))},
            {'label':'Vocabulary items','value':str(sum(len(p['vocabulary']) for p in passages))},
            {'label':'Level','value':c.get('level') or 'not set'},
            {'label':'Publication intent','value':pkg['publication']['state']},
            {'label':'Provenance','value':provenance_text(pkg)}])
        warnings=['At least one passage has no questions: it imports as reading material only.'] if any(not p['questions'] for p in passages) else []
    else:
        questions=c['questions'];sections=c['sections'];day=c.get('programme')
        lines.append({'label':'Collection','value':c['collection']})
        if day:lines += [{'label':'Programme day','value':f'{day["ref"]} · DAY {day["day"]}'},
             {'label':'Questions (needs 5)','value':str(len(questions))},
             {'label':'Options per question','value':' · '.join(str(len(q['options'])) for q in questions) or 'none'},
             {'label':'Answers present','value':str(sum(bool(q['key'].strip()) for q in questions))+'/'+str(len(questions))},
             {'label':'Recording source','value':f'{c["audio"].get("path",c["audio"]["assetKey"])} ({max(1,round(c["audio"]["durationSec"]/60))} min)'}]
        summary={}
        for q in questions:
            type_id=q.get('typeCode') or {'completion':'short_answer','mcq':'mcq_single','map':'map_labeling','matching':'matching'}.get(q.get('kind'),'short_answer')
            summary[type_id]=summary.get(type_id,0)+1
        lines+= [{'label':'Parts','value':str(len(sections))},{'label':'Questions','value':str(len(questions))},
          {'label':'Question types','value':' · '.join(f'{key}: {count}' for key,count in summary.items()) or 'none'},
          {'label':'Transcripts','value':f'{sum(bool(s["transcript"].strip()) for s in sections)}/{len(sections)} parts'},
          {'label':'Evidence timestamps','value':f'{sum(q["evidence"]["at"]>0 for q in questions)}/{len(questions)} questions'},
          {'label':'Recording','value':f'{max(1,round(c["audio"]["durationSec"]/60))} min'},
          {'label':'Map / Plan visual','value':f'present ({len(c["mapDiagram"].get("shapes",[]))} shapes)' if c.get('mapDiagram') else 'an image asset is required' if c.get('image') else 'not in this package'},
          {'label':'Script Completion','value':' · '.join(f'{len(part["gaps"])} gaps (Part {part["part"]})' for part in c.get('studyPack',{}).get('scriptParts',[])) or 'no authored gaps'},
          {'label':'Vocabulary','value':str(len(c['vocabulary']))},
          {'label':'Activities','value':', '.join(c.get('studyPack',{}).get('activities',[])) or 'standard set'},
          {'label':'Publication intent','value':pkg['publication']['state']},
          {'label':'Provenance','value':provenance_text(pkg)}]
        warnings=[]
        if day and len(questions)!=5:warnings.append(f'A published day holds exactly 5 questions; this package carries {len(questions)}.')
        if day and any(not q['key'].strip() for q in questions):warnings.append('Some questions have no answer, so the day could not be graded.')
        if day and any(q['evidence']['at']<=0 for q in questions):warnings.append('Some questions carry no evidence moment, so review cannot point at the recording.')
        if c.get('image'):warnings.append('A map/diagram image is required by this package.')
        if any(not s['transcript'].strip() for s in sections):warnings.append('Some parts have no transcript.')
    return {'title':pkg['title'],'lines':lines,'warnings':warnings}

def semantic_projection(mod,typ,c):
    keys=['questions','sections','audio','image','imagePath','mapDiagram','keyword1','keyword2','collection'] if mod=='listening' else ['passages','questions','timeLimitMinutes']
    return {k:c[k] for k in keys if k in c}

async def content_status(con,pkg):
    mod=pkg['module'];typ=pkg['contentType'];source=pkg['sourceRef'];digest=package_hash(pkg)
    latest=await con.fetchrow('''SELECT content_hash,content_version FROM content_imports
         WHERE module=$1 AND content_type=$2 AND source_ref=$3 ORDER BY content_version DESC LIMIT 1''',mod,typ,source)
    if latest:
        return {'status':'identical' if latest['content_hash']==digest else 'changed','detail':f'v{latest["content_version"]}'}
    if mod=='listening':domain=await con.fetchrow('SELECT 1 FROM listening_packages WHERE source_id=$1 LIMIT 1',source)
    else:
        ready=await con.fetchval("SELECT to_regclass('public.general_reading_sets') IS NOT NULL")
        domain=await con.fetchrow('SELECT 1 FROM general_reading_sets WHERE source_ref=$1 LIMIT 1',source) if ready else None
    return {'status':'changed','detail':'existing_material_without_import_record'} if domain else {'status':'new'}
async def duplicates(con,pkg):
    m=pkg['module'];typ=pkg['contentType'];source=pkg['sourceRef'];content=pkg['content'];full=standard_hash({'module':m,'contentType':typ,'content':content})
    semantic=standard_hash({'module':m,'contentType':typ,'semester':'assessment-semantics/v1','content':semantic_projection(m,typ,content)})
    rows=await con.fetch('''SELECT module,content_type,source_ref,version_no,status,content_hash,semantic_hash FROM content_versions
      WHERE module=$1 AND content_type=$2 AND source_ref<>$3''',m,typ,source)
    result={}
    for row in rows:
        evidence='identical_content' if row['content_hash']==full else 'identical_semantics' if row['semantic_hash']==semantic else None
        if not evidence:continue
        key=row['source_ref']
        if key not in result or row['version_no']>result[key]['versionNo']:
            result[key]={'module':row['module'],'contentType':row['content_type'],'sourceRef':key,
              'versionNo':row['version_no'],'status':row['status'],'evidence':evidence}
    return [result[key] for key in sorted(result)]

@router.post('/api/admin/content/validate')
async def content_validate(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    raw=(await req.body())
    if len(raw)>2*1024*1024:return core.j({'error':'payload_too_large'},413)
    try:body=json.loads(raw or b'null')
    except Exception:return core.j({'error':'invalid_json'},400)
    candidate=body.get('package') if isinstance(body,dict) and 'package' in body else body
    try:pkg,warnings=parse_package(candidate)
    except InvalidPackage as exc:
        return core.j({'ok':False,'code':exc.code,'issues':[x for x in exc.items if x['blocking']],
             'warnings':[x for x in exc.items if not x['blocking']]},400,PRIVATE)
    if user['role'] not in ('owner','admin'):return core.j({'ok':False,'error':'forbidden'},403)
    db=await core.pool()
    async with db.acquire() as con:
        source=await content_status(con,pkg)
        duplicate=await duplicates(con,pkg)
    r=requirements(pkg);declared={x['key']:x for x in pkg['assets']}
    missing=[x['key'] for x in r if x['required'] and x['key'] not in declared]
    issues=[issue(3,'asset_missing',f'Asset "{key}" is required.','assets') for key in missing]
    return core.j({'ok':not issues,'module':pkg['module'],'contentType':pkg['contentType'],'schemaVersion':pkg['schemaVersion'],
         'importerVersion':2 if pkg['module']=='listening' else 1,'title':pkg['title'],'sourceRef':pkg['sourceRef'],
         **({'migratedFrom':pkg['_migratedFrom']} if '_migratedFrom' in pkg else {}),
         'contentHash':pkg.get('contentHash'),'capabilities':{'key':f'{pkg["module"]}:{pkg["contentType"]}:v{pkg["schemaVersion"]}',
           'label':'Listening full test' if pkg['module']=='listening' else 'General Reading set'},
         'requiredAssets':[{'key':r0['key'],'role':r0['role'],'required':r0['required'],'label':r0.get('label'),
           'mimeTypes':r0['mimeTypes'],'maxBytes':r0['maxBytes'],'declared':r0['key'] in declared,
           'path':declared.get(r0['key'],{}).get('path')} for r0 in r],
         'missingAssetKeys':missing,'sourceStatus':source,'duplicates':duplicate,'preview':preview(pkg),
         'issues':issues,'warnings':[w['message'] for w in warnings]},headers=PRIVATE)
def install():core.app.include_router(router)
