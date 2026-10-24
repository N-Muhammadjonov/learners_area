"""Strict Retention authoring validation and immutable version lifecycle.
Ported from retention/measurement.ts and data/retention-bank.ts. No client-side
score or version number can influence the server allocations.
"""
from __future__ import annotations
import json,re,unicodedata
from fastapi import APIRouter,Request
from . import main as core
from .retention_admin_port import gate,invalid
router=APIRouter()
RANGES={'A2':(100,125),'B1':(160,195),'B2':(240,285),'C1':(280,330),'C2':(390,450)}
STATUS={'retention_invalid_level':400,'retention_invalid_structure':422,
 'retention_word_count_out_of_range':422,'retention_attempt_not_found':404,
 'retention_conflict':409,'retention_invalid_input':400,'retention_unavailable':500}

class RetentionFault(Exception):
 def __init__(self,code,details=None):self.code=code;self.details=details

def issue(path,code):return {'path':path,'code':code}

def is_js_int(x):return type(x)==int

def counted_words(text):
 # Matches ECMAScript \p{L} | \p{N} after NFKC, preserving joining hyphens.
 stripped=re.sub(r'(?<=\d)[,\u00a0\u202f\u2009](?=\d)','',text)
 norm=unicodedata.normalize('NFKC',stripped)
 count=0;in_word=False
 for i,c in enumerate(norm):
  letter=unicodedata.category(c)[0] in ('L','N')
  if letter and not in_word:count+=1;in_word=True
  elif not letter and c in ("'",'\u2019','-') and in_word and i+1<len(norm) and unicodedata.category(norm[i+1])[0] in ('L','N'):
   pass
  elif not letter:in_word=False
 return count

def shape(obj,required,optional=()):
 return isinstance(obj,dict) and set(required)<=set(obj) and set(obj)<=set(required)|set(optional)

def ident(v):return isinstance(v,str) and 1<=len(v.strip())<=60 and re.fullmatch('[A-Za-z0-9_-]+',v.strip())

def structured(raw):
 errors=[]
 def add(path,code):
  if len(errors)<20:errors.append(issue(path,code))
 if not shape(raw,('schemaVersion','maxScore','claims')):
  add('','root_unexpected_field')
  raise RetentionFault('retention_invalid_structure',{'issues':errors})
 if raw['schemaVersion']!=1 or type(raw['schemaVersion'])!=int:add('schemaVersion','schema_version_unsupported')
 if raw['maxScore']!=100 or type(raw['maxScore'])!=int:add('maxScore','max_score_not_100')
 claims=raw['claims']
 if not isinstance(claims,list) or not 1<=len(claims)<=40:
  add('claims','claims_empty' if claims==[] else 'claims_too_many');claims=[]
 accepted=[];claim_total=0;seen=set()
 for ci,c in enumerate(claims):
  p=f'claims.{ci}'
  if not shape(c,('id','label','points','scope','groups'),('acceptedPhrases','rejectPhrases')):
   add(p,'claim_unexpected_field');continue
  cid=c['id']; label=c['label'];pts=c['points'];scope=c['scope']
  if not ident(cid):add(p+'.id','id_required')
  if isinstance(cid,str) and cid in seen:add(p+'.id','claim_id_duplicate')
  seen.add(cid if isinstance(cid,str) else str(cid))
  if not isinstance(label,str) or not 3<=len(label.strip())<=300:add(p+'.label','claim_label_too_short')
  if not is_js_int(pts) or not 1<=pts<=100:add(p+'.points','claim_points_integer')
  if scope not in ('sentence','answer'):add(p+'.scope','claim_scope_unsupported')
  gs=c['groups'];g_seen=set();total=0;canonical_groups=[]
  if not isinstance(gs,list) or not 1<=len(gs)<=20:
   add(p+'.groups','claim_groups_empty');gs=[]
  for gi,g in enumerate(gs):
   q=f'{p}.groups.{gi}'
   if not shape(g,('id','points','kind','anyOf'),('critical',)):
    add(q,'group_unexpected_field');continue
   gid=g['id'];weight=g['points'];kind=g['kind'];alternatives=g['anyOf']
   if not ident(gid):add(q+'.id','id_required')
   if isinstance(gid,str) and gid in g_seen:add(q+'.id','group_id_duplicate')
   g_seen.add(gid if isinstance(gid,str) else str(gid))
   if not is_js_int(weight) or not 1<=weight<=100:add(q+'.points','group_points_integer')
   if kind not in ('concept','entity','number','date'):add(q+'.kind','group_kind_unsupported')
   if not isinstance(alternatives,list) or not 1<=len(alternatives)<=30:
    add(q+'.anyOf','anyof_empty');alternatives=[]
   for ai,v in enumerate(alternatives):
    if not isinstance(v,str) or not 1<=len(v.strip())<=180:add(f'{q}.anyOf.{ai}','anyof_alternative_too_long')
   if 'critical' in g and not isinstance(g['critical'],bool):add(q+'.critical','invalid_type')
   total+=weight if is_js_int(weight) else 0
   canonical_groups.append({'id':gid.strip() if isinstance(gid,str) else gid,'points':weight,'kind':kind,'anyOf':[x.strip() for x in alternatives if isinstance(x,str)],'critical':g.get('critical',False)})
  if is_js_int(pts) and total!=pts:add(p+'.points','claim_group_points_mismatch')
  phrases=[]
  for key,maxn in (('acceptedPhrases',32),('rejectPhrases',20)):
   arr=c.get(key,[])
   if not isinstance(arr,list) or len(arr)>maxn:add(p+'.'+key,'accepted_phrases_too_many');arr=[]
   for pi,v in enumerate(arr):
    if not isinstance(v,str) or not 2<=len(v.strip())<=220:add(f'{p}.{key}.{pi}','phrase_invalid')
   phrases.append([v.strip() for v in arr if isinstance(v,str)])
  claim_total+=pts if is_js_int(pts) else 0
  accepted.append({'id':cid.strip() if isinstance(cid,str) else cid,'label':label.strip() if isinstance(label,str) else label,
   'points':pts,'scope':scope,'groups':canonical_groups,'acceptedPhrases':phrases[0],'rejectPhrases':phrases[1]})
 if claim_total!=100:add('claims','claims_total_not_100')
 if errors:raise RetentionFault('retention_invalid_structure',{'issues':errors})
 return {'schemaVersion':1,'maxScore':100,'claims':accepted}

def valid_shape(b,version=False):
 if not isinstance(b,dict):return False
 required=['bodyText','scoringStructure']
 if not version:required+=['level']
 else:required=[]+required
 allowed=set(required)|({'expectedCurrentVersionId'} if version else set())
 if not set(required)<=set(b):return False
 if not isinstance(b['bodyText'],str) or not 1<=len(b['bodyText'])<=8000:return False
 if not (isinstance(b['scoringStructure'],dict) or isinstance(b['scoringStructure'],str) and len(b['scoringStructure'])<=200000):return False
 if not version:return isinstance(b.get('level'),str) and 1<=len(b['level'])<=4
 return 'expectedCurrentVersionId' not in b or core.uuid_value(b['expectedCurrentVersionId']) is not None

def content(level,body,structure):
 if level not in RANGES:raise RetentionFault('retention_invalid_level')
 text=body.strip()
 count=counted_words(text)
 low,high=RANGES[level]
 if not low<=count<=high:raise RetentionFault('retention_word_count_out_of_range',{'level':level,'wordCount':count,'min':low,'max':high})
 return text,count,structured(structure)

def error_result(exc):
 return core.j({'error':exc.code,**({'details':exc.details} if exc.details is not None else {})},STATUS[exc.code])

@router.post('/api/admin/retention/validate')
async def retention_validate(req:Request):
 u,e=await gate(req)
 if e:return e
 b=await core.payload(req)
 if not valid_shape(b):return invalid()
 try:
  _,count,structure=content(b['level'],b['bodyText'],b['scoringStructure'])
  return core.j({'valid':True,'wordCount':count,'level':b['level'],'claims':len(structure['claims'])})
 except RetentionFault as ex:
  return core.j({'valid':False,'error':ex.code,'details':ex.details})

@router.post('/api/admin/retention/texts')
async def retention_create(req:Request):
 u,e=await gate(req)
 if e:return e
 b=await core.payload(req)
 if not valid_shape(b):return invalid()
 try:text,count,structure=content(b['level'],b['bodyText'],b['scoringStructure'])
 except RetentionFault as ex:return error_result(ex)
 db=await core.pool()
 async with db.acquire() as con:
  async with con.transaction():
   await con.fetchval('SELECT pg_advisory_xact_lock(hashtext($1))','retention.label:'+b['level'])
   seq=await con.fetchval('''INSERT INTO retention_sequence_counters(level,last_sequence) VALUES($1,1)
     ON CONFLICT(level) DO UPDATE SET last_sequence=retention_sequence_counters.last_sequence+1 RETURNING last_sequence''',b['level'])
   label=f"{b['level']}-{int(seq):03d}"
   tid=await con.fetchval('''INSERT INTO retention_texts(level,internal_label,sequence,active,created_by_user_id)
     VALUES($1,$2,$3,true,$4) RETURNING id''',b['level'],label,seq,u['id'])
   vid=await con.fetchval('''INSERT INTO retention_text_versions(retention_text_id,version_number,body_text,word_count,scoring_structure,created_by_user_id)
     VALUES($1,1,$2,$3,$4::jsonb,$5) RETURNING id''',tid,text,count,json.dumps(structure),u['id'])
   await con.execute('UPDATE retention_texts SET current_version_id=$2,updated_at=NOW() WHERE id=$1',tid,vid)
   await con.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
    VALUES($1,'retention_text.created','retention_text',$2,$3::jsonb)''',u['id'],tid,
    json.dumps({'level':b['level'],'label':label,'version':1,'wordCount':count}))
 return core.j({'ok':True,'textId':str(tid),'versionId':str(vid),'internalLabel':label,'wordCount':count})

@router.post('/api/admin/retention/texts/{id}/versions')
async def retention_version(req:Request,id:str):
 u,e=await gate(req)
 if e:return e
 b=await core.payload(req)
 if not valid_shape(b,True):return invalid()
 uid=core.uuid_value(id)
 if not uid:return error_result(RetentionFault('retention_unavailable'))
 db=await core.pool()
 async with db.acquire() as con:
  async with con.transaction():
   row=await con.fetchrow('''SELECT id,level,current_version_id,internal_label FROM retention_texts WHERE id=$1 FOR UPDATE''',uid)
   if not row:return error_result(RetentionFault('retention_attempt_not_found'))
   if 'expectedCurrentVersionId' in b and str(row['current_version_id'])!=str(b['expectedCurrentVersionId']):
    return error_result(RetentionFault('retention_conflict',{'currentVersionId':str(row['current_version_id']) if row['current_version_id'] else None}))
   try:text,count,structure=content(row['level'],b['bodyText'],b['scoringStructure'])
   except RetentionFault as ex:return error_result(ex)
   await con.fetchval('SELECT pg_advisory_xact_lock(hashtext($1))','retention.version:'+str(row['id']))
   no=int(await con.fetchval('SELECT coalesce(max(version_number),0)::int FROM retention_text_versions WHERE retention_text_id=$1',uid))+1
   vid=await con.fetchval('''INSERT INTO retention_text_versions(retention_text_id,version_number,body_text,word_count,scoring_structure,created_by_user_id)
     VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id''',uid,no,text,count,json.dumps(structure),u['id'])
   await con.execute('UPDATE retention_texts SET current_version_id=$2,updated_at=NOW() WHERE id=$1',uid,vid)
   await con.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
    VALUES($1,'retention_text.version_created','retention_text',$2,$3::jsonb)''',u['id'],uid,
    json.dumps({'level':row['level'],'label':row['internal_label'],'version':no,'wordCount':count}))
 return core.j({'ok':True,'versionId':str(vid),'versionNumber':no,'wordCount':count,'internalLabel':row['internal_label']})

def install():core.app.include_router(router)
