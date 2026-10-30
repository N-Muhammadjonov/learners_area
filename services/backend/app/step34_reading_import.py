"""General Reading bundle importer: author-validated, idempotent, transactional.
Includes authored lexical senses and grounded reading occurrences (no guessed senses).
"""
from __future__ import annotations
import json,re,uuid
from pathlib import Path
from fastapi import APIRouter,Request
from . import main as core
from .step30_video_lexical import sense_for,linked_unit,sense_key,forms_of,is_function,spans,sentence_at,example_matches
router=APIRouter()
TYPES=json.loads((Path(__file__).parent/'reading_question_types.json').read_text())
TYPE_MAP={alias.lower():(canonical,aliases,storage) for canonical,aliases,storage in TYPES for alias in [canonical,*aliases]}

class InvalidBundle(Exception):
    def __init__(self,path,msg):self.path,self.msg=path,msg

def string(v,path,minlen=0,maxlen=None):
    if not isinstance(v,str):raise InvalidBundle(path,'Expected string, received '+('null' if v is None else type(v).__name__))
    if len(v)<minlen:raise InvalidBundle(path,f'String must contain at least {minlen} character(s)')
    if maxlen is not None and len(v)>maxlen:raise InvalidBundle(path,f'String must contain at most {maxlen} character(s)')
    return v

def number(v,path,minval,maxval):
    if type(v) is not int:raise InvalidBundle(path,'Expected number, received '+('null' if v is None else type(v).__name__))
    if not minval<=v<=maxval:raise InvalidBundle(path,f'Number must be greater than or equal to {minval}' if v<minval else f'Number must be less than or equal to {maxval}')
    return v

def optional_text(obj,name,path,maximum):
    if name in obj:string(obj[name],path+'.'+name,maxlen=maximum)

def validate_bundle(value):
    if not isinstance(value,dict):raise InvalidBundle('','Required')
    string(value.get('sourceRef'),'sourceRef',1,80);string(value.get('title'),'title',1,200)
    for k,maxlen in [('description',2000),('level',10)]:optional_text(value,k,'',maxlen)
    if 'publish' in value and type(value['publish']) is not bool:raise InvalidBundle('publish','Expected boolean')
    passages=value.get('passages')
    if not isinstance(passages,list) or not 1<=len(passages)<=3:raise InvalidBundle('passages','Array must contain at least 1 element(s)')
    seen=set()
    for n,p in enumerate(passages):
        base=f'passages.{n}'
        if not isinstance(p,dict):raise InvalidBundle(base,'Expected object')
        pn=number(p.get('passageNo'),base+'.passageNo',1,3)
        string(p.get('title'),base+'.title',1,200);string(p.get('body'),base+'.body',1,40000)
        if pn in seen:raise InvalidBundle('passages','passage numbers must be unique')
        seen.add(pn)
        groups=p.get('groups',[]);questions=p.get('questions',[]);vocabulary=p.get('vocabulary',[])
        for name,items,maxi in [('groups',groups,40),('questions',questions,40),('vocabulary',vocabulary,300)]:
            if not isinstance(items,list) or len(items)>maxi:raise InvalidBundle(base+'.'+name,'Expected array')
        keys=set();nums=set()
        for i,g in enumerate(groups):
            gb=f'{base}.groups.{i}'
            if not isinstance(g,dict):raise InvalidBundle(gb,'Expected object')
            key=string(g.get('key'),gb+'.key',1,40);typ=string(g.get('typeCode'),gb+'.typeCode',1,40)
            if typ.lower() not in TYPE_MAP:raise InvalidBundle(gb+'.typeCode','Unknown Reading question type')
            if key in keys:raise InvalidBundle(base+'.groups','Duplicate group key')
            keys.add(key)
            for k,maxlen in [('displayTitle',120),('instructionsText',4000)]:optional_text(g,k,gb,maxlen)
            for k in ('fromQuestionNo','toQuestionNo'):
                if k in g:number(g[k],gb+'.'+k,1,60)
            if 'sharedChoices' in g:
                if not isinstance(g['sharedChoices'],list) or len(g['sharedChoices'])>30:raise InvalidBundle(gb+'.sharedChoices','Expected array')
                for j,v in enumerate(g['sharedChoices']):string(v,f'{gb}.sharedChoices.{j}',0,500)
        for i,q in enumerate(questions):
            qb=f'{base}.questions.{i}'
            if not isinstance(q,dict):raise InvalidBundle(qb,'Expected object')
            num=number(q.get('questionNo'),qb+'.questionNo',1,60)
            typ=string(q.get('type'),qb+'.type',1,40)
            if typ.lower() not in TYPE_MAP:raise InvalidBundle(qb+'.type','Unknown Reading question type')
            if num in nums:raise InvalidBundle(base+'.questions','Duplicate question number')
            nums.add(num)
            if 'groupKey' in q:
                string(q['groupKey'],qb+'.groupKey',maxlen=40)
                if q['groupKey'] and q['groupKey'] not in keys:raise InvalidBundle(qb+'.groupKey','Unknown question group')
            string(q.get('text'),qb+'.text',1,2000);string(q.get('answer'),qb+'.answer',1,300)
            for k,maxlen in [('evidence',1000),('explanation',2000)]:optional_text(q,k,qb,maxlen)
            if 'renderMode' in q and q['renderMode'] not in ('shared_stimulus_slot','inline','standalone'):raise InvalidBundle(qb+'.renderMode','Invalid enum value')
            for name,maxitems,maxlen in [('options',10,300),('accepted',10,300)]:
                if name in q:
                    if not isinstance(q[name],list) or len(q[name])>maxitems:raise InvalidBundle(qb+'.'+name,'Expected array')
                    for j,text in enumerate(q[name]):string(text,f'{qb}.{name}.{j}',1,maxlen)
            if 'answerConstraint' in q:
                c=q['answerConstraint']
                if not isinstance(c,dict):raise InvalidBundle(qb+'.answerConstraint','Expected object')
                for name,limit in [('max_words',100),('selection_count',10)]:
                    if name in c:number(c[name],qb+'.answerConstraint.'+name,1,limit)
                if 'number_allowed' in c and type(c['number_allowed']) is not bool:raise InvalidBundle(qb+'.answerConstraint.number_allowed','Expected boolean')
                if 'allowed_values' in c:
                    if not isinstance(c['allowed_values'],list) or len(c['allowed_values'])>30:raise InvalidBundle(qb+'.answerConstraint.allowed_values','Expected array')
                    for j,x in enumerate(c['allowed_values']):string(x,f'{qb}.answerConstraint.allowed_values.{j}')
        for i,v in enumerate(vocabulary):
            vb=f'{base}.vocabulary.{i}'
            if not isinstance(v,dict):raise InvalidBundle(vb,'Expected object')
            for k,minlen,maxlen in [('word',1,120),('pos',0,30),('def',1,600),('uz',0,300),('ex',0,600)]:
                if k not in v and k in ('pos','uz','ex'):continue
                string(v.get(k),vb+'.'+k,minlen,maxlen)
            if 'surfaces' in v:
                if not isinstance(v['surfaces'],list) or len(v['surfaces'])>10:raise InvalidBundle(vb+'.surfaces','Expected array')
                for j,s in enumerate(v['surfaces']):string(s,f'{vb}.surfaces.{j}',1,120)
    return value

async def lexical_occurrences(con,pid,body,vocab):
    senses={};candidates=[];resolved=0;unresolved=0
    for raw in vocab:
        v={'pos':'','uz':'','ex':'',**raw,'sourceId':str(pid)}
        if is_function(v['word']):continue
        k=sense_key({'term':v['word'],'partOfSpeech':v['pos'],'definitionEn':v['def']})
        if k in senses:continue
        lex=await sense_for(con,v)
        if not lex:continue
        unit=await linked_unit(con,lex)
        senses[k]={'lexeme':lex['id'],'unit':unit,'example':v['ex']}
        candidates.append({'key':k,'forms':[f[0] for f in forms_of(v['word'],v['pos'])]})
    authored=[]
    for v in vocab:
        k=sense_key({'term':v['word'],'partOfSpeech':v.get('pos',''),'definitionEn':v['def']})
        if k not in senses:continue
        for surface in v.get('surfaces',[]):
            offset=0
            while surface:
                at=body.find(surface,offset)
                if at<0:break
                end=at+len(surface)
                if not any(at<b['end'] and end>b['start'] for b in authored):authored.append({'keys':[k],'start':at,'end':end,'surface':surface})
                offset=end
    matched=[v for v in spans(body,candidates) if not any(v['start']<a['end'] and v['end']>a['start'] for a in authored)]
    for span in sorted(authored+matched,key=lambda x:x['start']):
        sentence=sentence_at(body,span['start'],span['end'])
        checked=[k for k in span['keys'] if example_matches(senses[k]['example'],sentence)]
        linked=senses[checked[0]] if len(checked)==1 else None
        ids={senses[k]['unit'] for k in span['keys']};unit=next(iter(ids)) if len(ids)==1 else None
        row=await con.fetchrow('''INSERT INTO lexical_occurrences(source_type,passage_id,lexeme_id,lexical_unit_id,
            surface_form,start_char,end_char,sentence_text,occurrence_type,is_target_vocabulary,resolution_status,resolution_source)
            VALUES('reading',$1,$2,$3,$4,$5,$6,$7,'vocabulary',true,$8,$9)
            ON CONFLICT DO NOTHING RETURNING id''',pid,linked['lexeme'] if linked else None,unit,span['surface'][:120],span['start'],span['end'],sentence,
            'resolved' if linked else 'unresolved','general_reading' if linked else None)
        if row:
            if linked:resolved+=1
            else:unresolved+=1
    return {'resolved':resolved,'unresolved':unresolved}

async def import_set(con,bundle):
    existing=await con.fetchrow('SELECT id FROM general_reading_sets WHERE source_ref=$1 LIMIT 1',bundle['sourceRef'])
    if existing:return {'setId':str(existing['id']),'created':False,'passages':[]}
    state='published' if bundle.get('publish',False) else 'draft'
    new=await con.fetchrow('''INSERT INTO general_reading_sets(title,description,difficulty_level,publication_state,source_ref)
       VALUES($1,$2,$3,$4,$5) RETURNING id''',bundle['title'],bundle.get('description'),bundle.get('level'),state,bundle['sourceRef'])
    results=[]
    for p in sorted(bundle['passages'],key=lambda x:x['passageNo']):
        pid=await con.fetchval('''INSERT INTO reading_passages(title,body_text,publication_state,source_ref) VALUES($1,$2,$3,$4) RETURNING id''',
              p['title'],p['body'],state,bundle['sourceRef'][:80])
        await con.execute('INSERT INTO general_reading_passages(passage_id,set_id,passage_no) VALUES($1,$2,$3)',pid,new['id'],p['passageNo'])
        groups={}
        for i,g in enumerate(p.get('groups',[])):
            canonical,aliases,stored=TYPE_MAP[g['typeCode'].lower()]
            groupcode=next(a for a in aliases if len(a)<=16)
            groups[g['key']]=await con.fetchval('''INSERT INTO reading_question_groups(passage_id,position,type_code,display_title,instructions_text,
                shared_choices,from_question_no,to_question_no) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id''',
                pid,i+1,groupcode,g.get('displayTitle'),g.get('instructionsText'),json.dumps(g.get('sharedChoices',[])),g.get('fromQuestionNo'),g.get('toQuestionNo'))
        for i,q in enumerate(p.get('questions',[])):
            canonical,aliases,stored=TYPE_MAP[q['type'].lower()]
            evidence=q.get('evidence');at=p['body'].find(evidence) if evidence else -1
            await con.execute('''INSERT INTO reading_questions(passage_id,"order",question_no,type,type_code,question_text,group_id,
                 answer_constraint,render_mode,options,correct_answer,accepted_answers,explanation,evidence_quote,evidence_start_char,
                 evidence_end_char,evidence_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16,$17)''',
                 pid,i+1,q['questionNo'],stored,canonical,q['text'],groups.get(q.get('groupKey')),
                 json.dumps(q.get('answerConstraint')) if 'answerConstraint' in q else None,q.get('renderMode'),json.dumps(q['options']) if 'options' in q else None,
                 q['answer'],json.dumps(q.get('accepted',[])),q.get('explanation',''),evidence,at if at>=0 else None,
                 at+len(evidence) if at>=0 else None,'source_marker' if at>=0 else 'missing_source' if evidence else None)
        lex=await lexical_occurrences(con,pid,p['body'],p.get('vocabulary',[]))
        results.append({'passageNo':p['passageNo'],'passageId':str(pid),**lex})
    return {'setId':str(new['id']),'created':True,'passages':results}

@router.post('/api/admin/reading/import')
async def reading_import(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401)
    if user['role'] not in ('admin','owner'):return core.j({'error':'forbidden'},403)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            ready=await con.fetchval("SELECT to_regclass('public.general_reading_sets') IS NOT NULL")
            if not ready:return core.j({'error':'schema_not_ready'},503)
        body=await core.payload(req)
        try:bundle=await core.run_blocking(validate_bundle,body.get('bundle') if isinstance(body,dict) else None)
        except InvalidBundle as e:
            detail=(e.path+': '+e.msg)[:200]
            return core.j({'error':'invalid_bundle','detail':detail},400)
        async with db.acquire() as con:
            if isinstance(body,dict) and body.get('dryRun') is True:
                async with con.transaction() as tr:
                    outcome=await import_set(con,bundle)
                    await tr.rollback()
                return core.j({**outcome,'dryRun':True})
            async with con.transaction():outcome=await import_set(con,bundle)
        return core.j({**outcome,'dryRun':False},201 if outcome['created'] else 200)
    except Exception as e:
        import logging,uuid
        correlation=str(uuid.uuid4())[:8]
        logging.getLogger(__name__).exception('reading import failed: %s',correlation)
        return core.j({'error':'unknown','correlationId':correlation},500)

def install():core.app.include_router(router)
