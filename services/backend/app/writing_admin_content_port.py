"""Writing Management creation and edit: exact five-kind schema and draft/audit lifecycle.
Translated from lib/services/writing/admin.ts and writing/admin-schemas.ts.
"""
from __future__ import annotations
import json, math, re
from decimal import Decimal
from fastapi import APIRouter,Request
from . import main as core
from .lesson_writing_port import js_length

router=APIRouter()
KINDS={'lesson','prompt','translation','model-text','pattern'}
CATEGORIES={'task1','task2','structure','ideas','coherence','vocabulary','grammar','mistakes'}
QUESTION_TYPES={'opinion','discussion','problem_solution','advantages_disadvantages','two_part'}
PATTERN_FUNCTIONS={'collocation','sentence_frame','cohesion','comparison','concession','trend','argument'}
TABLE={'lesson':'writing_lessons','prompt':'writing_prompts','translation':'writing_translation_sets',
       'model-text':'writing_model_texts','pattern':'writing_language_patterns'}
COLUMNS={
 'lesson':{'title':'title','category':'category','summary':'summary','body':'body','durationMinutes':'duration_minutes','position':'position'},
 'prompt':{'taskType':'task_type','category':'category','prompt':'prompt','targetWordCount':'target_word_count'},
 'translation':{'title':'title','topic':'topic','questionType':'question_type','taskType':'task_type',
   'targetBand':'target_band','promptText':'prompt_text','provenance':'provenance'},
 'model-text':{'title':'title','taskType':'task_type','topic':'topic','targetBand':'target_band',
   'body':'body','wordCount':'word_count','provenance':'provenance'},
 'pattern':{'pattern':'pattern','function':'function','taskType':'task_type','topic':'topic',
   'targetBand':'target_band','example':'example','usageNote':'usage_note','sourceRef':'source_ref','provenance':'provenance'}}

class Invalid(Exception):pass


def text(v,limit,allow_null=False,minimum=1):
    if allow_null and v is None:return None
    if not isinstance(v,str):raise Invalid()
    v=v.strip()
    if allow_null and not v:return None
    if not minimum<=js_length(v)<=limit:raise Invalid()
    return v


def number(v,integer=True,min_val=None,max_val=None):
    try:
        if v is None:val=0.0
        elif type(v)==bool:val=float(v)
        elif isinstance(v,(int,float,str)) and str(v).strip():val=float(v)
        elif v=='':val=0.
        else:raise Invalid()
        if not math.isfinite(val) or integer and int(val)!=val:raise Invalid()
        if min_val is not None and val<min_val:raise Invalid()
        if max_val is not None and val>max_val:raise Invalid()
        return int(val) if integer else val
    except (ValueError,TypeError,OverflowError):raise Invalid()


def enum(v,options):
    if not isinstance(v,str) or v not in options:raise Invalid()
    return v


def words(s):
    try:
        import regex
        return len(regex.findall(r"[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*",s))
    except ImportError:
        return len(re.findall(r"[^\W_][\w'\u2019-]*",s,re.UNICODE))


def list_text(v,limit,maxcount):
    if not isinstance(v,list) or len(v)>maxcount:raise Invalid()
    return [text(x,limit) for x in v]


def validate(kind,raw):
    if not isinstance(raw,dict):raise Invalid()
    def shape(required,optional=()):
        if not set(required)<=set(raw) or set(raw)-set(required)-set(optional):raise Invalid()
    def t(name,maxlen):return text(raw[name],maxlen)
    def optional(name,maxlen):return text(raw.get(name),maxlen,True)
    def task():return enum(raw['taskType'],{'task1','task2'})
    if kind=='lesson':
        shape(('title','category','body'),('summary','durationMinutes','position'))
        data={'title':t('title',200),'category':enum(raw['category'],CATEGORIES),'summary':optional('summary',600),
              'body':t('body',20000),'durationMinutes':None if raw.get('durationMinutes') is None else number(raw['durationMinutes'],min_val=1,max_val=240),
              'position':number(raw.get('position',0),min_val=0,max_val=10000)}
    elif kind=='prompt':
        shape(('taskType','category','prompt','targetWordCount'))
        data={'taskType':task(),'category':t('category',60),'prompt':text(raw['prompt'],2000,minimum=10),
             'targetWordCount':number(raw['targetWordCount'],min_val=50,max_val=500)}
    elif kind=='translation':
        shape(('title','topic','questionType','targetBand','promptText','provenance','sentences'),('taskType',))
        sentences=raw['sentences']
        if not isinstance(sentences,list) or len(sentences)>40:raise Invalid()
        parts=[]
        for s in sentences:
            if not isinstance(s,dict) or not {'position','uzbekSource','modelEnglish'}<=set(s) or set(s)-{'position','uzbekSource','modelEnglish','acceptedAlternatives','notes','targetLexicalItems'}:raise Invalid()
            parts.append({'position':number(s['position'],min_val=1,max_val=40),'uzbekSource':text(s['uzbekSource'],600),
            'modelEnglish':text(s['modelEnglish'],600),'acceptedAlternatives':list_text(s.get('acceptedAlternatives',[]),600,10),
            'notes':list_text(s.get('notes',[]),400,5),'targetLexicalItems':list_text(s.get('targetLexicalItems',[]),80,10)})
        data={'title':t('title',200),'topic':t('topic',120),'questionType':enum(raw['questionType'],QUESTION_TYPES),
        'taskType':enum(raw.get('taskType','task2'),{'task1','task2'}),'targetBand':number(raw['targetBand']),
        'promptText':t('promptText',2000),'provenance':t('provenance',200),'sentences':parts}
    elif kind=='model-text':
        shape(('title','taskType','topic','targetBand','body','provenance'))
        body=text(raw['body'],8000,minimum=200)
        data={'title':t('title',200),'taskType':task(),'topic':t('topic',120),
              'targetBand':number(raw['targetBand'],integer=False),
              'body':body,'provenance':t('provenance',200),'wordCount':words(body)}
    else:
        shape(('pattern','function','taskType','example','provenance'),('topic','targetBand','usageNote','sourceRef'))
        src=raw.get('sourceRef')
        if src is not None and not core.uuid_value(src):raise Invalid()
        band=None if raw.get('targetBand') is None else number(raw['targetBand'],min_val=5,max_val=9)
        data={'pattern':t('pattern',240),'function':enum(raw['function'],PATTERN_FUNCTIONS),'taskType':task(),
              'topic':optional('topic',120),'targetBand':band,'example':t('example',400),
              'usageNote':optional('usageNote',600),'sourceRef':src,'provenance':t('provenance',200)}
    if kind=='translation' and data['targetBand'] not in (6,7,8):raise Invalid()
    if kind=='model-text' and data['targetBand'] not in (8,8.5,9):raise Invalid()
    return data

async def save_content(kind,ident,raw,user):
    try:data=validate(kind,raw)
    except Invalid:return {'ok':False,'issues':['invalid_fields']}
    if kind=='translation' and len({s['position'] for s in data['sentences']})!=len(data['sentences']):
        return {'ok':False,'issues':['duplicate_position']}
    if kind=='model-text' and data['wordCount']<({'task1':150,'task2':250}[data['taskType']]):
        return {'ok':False,'issues':['model_too_short']}
    db=await core.pool();table=TABLE[kind]
    async with db.acquire() as con:
        if kind=='pattern' and data['sourceRef']:
            if not await con.fetchval('SELECT id FROM writing_model_texts WHERE id=$1',data['sourceRef']):
                return {'ok':False,'issues':['unknown_source']}
        if ident:
            exists=await con.fetchval(f'''SELECT id FROM {table} t WHERE id=$1 AND NOT EXISTS (
             SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:'||t.id::text)::uuid
              AND e.type='CONTENT_DELETED')''',ident)
            if not exists:return {'ok':False,'issues':['not_found']}
        mapped={col:data[key] for key,col in COLUMNS[kind].items()}
        if kind=='lesson' or kind=='translation':mapped['updated_at']='__now__'
        if kind=='model-text':mapped['target_band']=Decimal(str(mapped['target_band']))
        names=list(mapped)
        values=[mapped[x] for x in names if mapped[x]!='__now__']
        def ph(x):
            return 'NOW()' if mapped[x]=='__now__' else ('$'+str([y for y in names if mapped[y]!='__now__'].index(x)+1)+'::jsonb' if x in ('accepted_alternatives','notes','target_lexical_items') else '$'+str([y for y in names if mapped[y]!='__now__'].index(x)+1))
        try:
            async with con.transaction():
                if ident:
                    updates=', '.join(f'{x}={ph(x)}' for x in names)
                    await con.execute(f'UPDATE {table} SET {updates} WHERE id=${len(values)+1}',*values,ident)
                    saved_id=ident
                else:
                    cols=','.join(names+['publication_state'])
                    params=','.join([ph(x) for x in names]+["'draft'"])
                    saved_id=await con.fetchval(f'INSERT INTO {table} ({cols}) VALUES ({params}) RETURNING id',*values)
                if kind=='translation':
                    await con.execute('DELETE FROM writing_translation_sentences WHERE set_id=$1',saved_id)
                    for item in data['sentences']:
                        await con.execute('''INSERT INTO writing_translation_sentences(set_id,position,uzbek_source,model_english,
                             accepted_alternatives,notes,target_lexical_items) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)''',
                             saved_id,item['position'],item['uzbekSource'],item['modelEnglish'],json.dumps(item['acceptedAlternatives']),json.dumps(item['notes']),json.dumps(item['targetLexicalItems']))
        except Exception:
            return {'ok':False,'issues':['write_failed']}
        await con.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
          VALUES($1,'content.updated',$2,$3,$4::jsonb)''',user['id'],'writing_'+kind.replace('-','_'),saved_id,
          json.dumps({'operation':'edit' if ident else 'create'}))
        return {'ok':True,'id':str(saved_id)}

@router.post('/api/admin/writing-prompts')
async def legacy_prompt(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if u['role'] not in ('owner','admin'):return core.j({'error':'forbidden'},403)
    r=await save_content('prompt',None,await core.payload(req),u)
    if not r['ok']:return core.j({'error':'invalid_input','issues':r['issues']},400)
    return core.j(r)

@router.post('/api/admin/writing/{kind}')
async def create_writing(req:Request,kind:str):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':{'code':'unauthenticated'}},401)
    if u['role'] not in ('owner','admin'):return core.j({'error':{'code':'forbidden'}},403)
    if kind not in KINDS:return core.j({'error':{'code':'not_found'}},404)
    r=await save_content(kind,None,await core.payload(req),u)
    if not r['ok']:return core.j({'error':{'code':'invalid','issues':r['issues']}},500 if 'write_failed' in r['issues'] else 400)
    return core.j(r)

@router.put('/api/admin/writing/{kind}/{id}')
async def update_writing(req:Request,kind:str,id:str):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':{'code':'unauthenticated'}},401)
    if u['role'] not in ('owner','admin'):return core.j({'error':{'code':'forbidden'}},403)
    if kind not in KINDS or not core.uuid_value(id):return core.j({'error':{'code':'not_found'}},404)
    r=await save_content(kind,id,await core.payload(req),u)
    if not r['ok']:return core.j({'error':{'code':'invalid','issues':r['issues']}},404 if 'not_found' in r['issues'] else 500 if 'write_failed' in r['issues'] else 400)
    return core.j(r)

def install():core.app.include_router(router)
