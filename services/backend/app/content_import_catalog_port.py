"""Source-generated import capability descriptors and canonical JSON templates.

Fixtures evaluated from the original TypeScript's pure template functions using
an isolated Node VM during conversion, then frozen as Python package data.
Runtime never requires Node, TypeScript, a frontend or executing HTML.
"""
from __future__ import annotations
import json
from pathlib import Path
from fastapi import APIRouter,Request
from fastapi.responses import Response
from . import main as core

router=APIRouter()
DESCRIPTORS=[{'module':'listening','contentType':'full_test','schemaVersion':2,
 'label':'Listening full test','status':'active','key':'listening:full_test:v2'},
 {'module':'reading','contentType':'general_set','schemaVersion':1,
 'label':'General Reading set','status':'active','key':'reading:general_set:v1'}]
IMPORTERS=[{'module':'listening','contentType':'full_test','targetType':'listening_test'},
 {'module':'reading','contentType':'general_set','targetType':'general_reading_set'}]
TEMPLATES=json.loads(Path(__file__).with_name('import_templates_source.json').read_text())

@router.get('/api/admin/content/template')
async def content_template(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    module=req.query_params.get('module','');content_type=req.query_params.get('contentType','')
    kind='example' if req.query_params.get('kind')=='example' else 'template'
    match=next((x for x in DESCRIPTORS if x['module']==module and x['contentType']==content_type),None)
    if not match:return core.j({'error':'unknown_content_type'},404)
    fixture=({'listeningTemplate':TEMPLATES['listeningTemplate'],'listeningExample':TEMPLATES['listeningExample']}
      if module=='listening' else {'readingTemplate':TEMPLATES['readingTemplate']})
    key=module+kind.title()
    if key not in fixture:
        return core.j({'error':'asset_missing','detail':f'No {kind} is published for this content type.'},404)
    data=fixture[key]
    encoded=(json.dumps(data,indent=2,ensure_ascii=False)+'\n').encode('utf-8')
    name=f'{module}-{content_type}-{kind}-v{match["schemaVersion"]}.json'
    return Response(encoded,media_type='application/json; charset=utf-8',headers={
       'Content-Disposition':f'attachment; filename="{name}"','Cache-Control':'private, no-store'})

@router.get('/api/admin/content/import')
async def import_capabilities(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    result=[{**d,'template':TEMPLATES['listeningTemplate' if d['module']=='listening' else 'readingTemplate']} for d in DESCRIPTORS]
    return core.j({'capabilities':result,'importers':IMPORTERS},headers={'Cache-Control':'private, no-store'})


def install():core.app.include_router(router)
