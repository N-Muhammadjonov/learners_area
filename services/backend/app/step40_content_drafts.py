"""POST /api/admin/content/drafts: authored content validation and canonical drafts.

Source: src/app/api/admin/content/drafts/route.ts, lib/content/authoring.ts,
lib/content/authors.ts. All DB changes take place in a single transaction.
"""
from __future__ import annotations
import json,re,uuid,hashlib,unicodedata
from urllib.parse import urlparse
from pathlib import Path
from fastapi import APIRouter,Request
from . import main as core
from .step25_content_version import version_hashes,encoded
from .step34_reading_import import TYPE_MAP
from .step29_lesson_revision import validate_blocks

router=APIRouter()
REGISTERED={('listening','full_test'),('listening','section'),('reading','general_set'),('reading','passage'),
 ('writing','task1'),('writing','task2'),('writing','lesson'),('writing','model_text'),('writing','pattern'),('writing','translation_set'),
 ('speaking','part1_question'),('speaking','cue_card'),('speaking','part3_question'),('speaking','material'),
 ('grammar','topic'),('vocabulary','topic_pack'),('lesson','lesson')}
TAXONOMY={'listening':['full_test','section','question_type_practice'],
 'reading':['general_set','full_test','passage','passage_set','question_type_practice'],
 'writing':['task1','task2','lesson','model_text','pattern','translation_set'],
 'speaking':['part1_question','cue_card','part3_question','material'],
 'grammar':['topic','exercise'],'vocabulary':['topic_pack','retention_text'],
 'ted':['video_lesson','audio_lesson'],'lesson':['lesson']}
LABELS={'listening':'Listening','reading':'Reading','writing':'Writing','speaking':'Speaking',
'grammar':'Grammar','vocabulary':'Vocabulary','ted':'TED / Podcast','lesson':'Lesson'}
TRACK={'listening':{'academic','general_training'},'reading':{'academic','general_training'},
 'writing':{'academic','general_training'},'speaking':{'academic','general_training'},
 'grammar':{'unspecified'},'vocabulary':{'unspecified'},'ted':{'unspecified'},'lesson':{'unspecified'}}
LESSON_CATS={'task1','task2','structure','ideas','coherence','vocabulary','grammar','mistakes'}
PATTERN_FUNCS={'collocation','sentence_frame','cohesion','comparison','concession','trend','argument'}
TRANSLATION_TYPES={'opinion','discussion','problem_solution','advantages_disadvantages','two_part'}

# Frozen canonical question registry extracted from src/lib/content/question-types.ts.
_LISTENING_QUESTION_TYPES = json.loads(Path(__file__).with_name('listening_authored_question_types.json').read_text())
_LISTENING_ALIASES = {alias.lower(): entry for entry in _LISTENING_QUESTION_TYPES
                      for alias in [entry['id'], *entry['aliases']]}

def resolve_listening_type(value):
    return _LISTENING_ALIASES.get(value.strip().lower()) if isinstance(value,str) else None

class DraftInvalid(Exception):
    def __init__(self,field,message):self.field=field;self.message=message

def require_str(obj,key,minlen=0,maxlen=None,nullable=False):
    value=obj.get(key)
    if nullable and value is None:return None
    if not isinstance(value,str):raise DraftInvalid(key,'Required' if value is None else 'Expected string, received '+type(value).__name__)
    if len(value)<minlen:raise DraftInvalid(key,f'String must contain at least {minlen} character(s)')
    if maxlen is not None and len(value)>maxlen:raise DraftInvalid(key,f'String must contain at most {maxlen} character(s)')
    return value

def require_num(obj,key,minimum=None,maximum=None,default=None):
    value=obj.get(key,default)
    if not isinstance(value,(int,float)) or isinstance(value,bool):raise DraftInvalid(key,'Required' if value is None else 'Expected number')
    if int(value)!=value:raise DraftInvalid(key,'Expected integer, received float')
    if minimum is not None and value<minimum:raise DraftInvalid(key,f'Number must be greater than or equal to {minimum}')
    if maximum is not None and value>maximum:raise DraftInvalid(key,f'Number must be less than or equal to {maximum}')
    return int(value)

def require_choice(obj,key,choices,default=None):
    v=obj.get(key,default)
    if v not in choices:raise DraftInvalid(key,'Invalid enum value')
    return v

def must_list(obj,key,minimum=0,maximum=None):
    v=obj.get(key)
    if not isinstance(v,list):raise DraftInvalid(key,'Required' if v is None else 'Expected array')
    if len(v)<minimum:raise DraftInvalid(key,f'Array must contain at least {minimum} element(s)')
    if maximum is not None and len(v)>maximum:raise DraftInvalid(key,f'Array must contain at most {maximum} element(s)')
    return v

def validate(module,typ,p):
    if not isinstance(p,dict):raise DraftInvalid('', 'Expected object, received '+('null' if p is None else type(p).__name__))
    p=dict(p)
    if module=='listening':
        p['audioType']=require_choice(p,'audioType',('video','audio','file','link'),'audio')
        p['difficultyLevel']=require_str(p,'difficultyLevel',2,10) if 'difficultyLevel' in p else 'B2'
        for key in ('audioUrl','transcript'):
            if key in p:require_str(p,key,1 if key=='audioUrl' else 0)
        q=must_list(p,'questions',1,12 if typ=='section' else None)
        if typ=='section':p['sectionNo']=require_num(p,'sectionNo',1,4,1)
        for n,x in enumerate(q):
            if not isinstance(x,dict):raise DraftInvalid(f'questions.{n}','Expected object')
            require_str(x,'type',2,40);require_str(x,'questionText',3);require_str(x,'correctAnswer',1);require_str(x,'explanation',1)
            if not resolve_listening_type(x['type']):
                raise DraftInvalid(f'questions.{n}.type',f'Unknown Listening question type "{x["type"]}".')
            if 'order' in x:require_num(x,'order',1)
            if 'options' in x:
                for v in must_list(x,'options',2,6):
                    if not isinstance(v,str) or not v:raise DraftInvalid(f'questions.{n}.options','String must contain at least 1 character(s)')
            if 'keywords' in x:require_str(x,'keywords',0,400)
            if 'paraphrase' in x:
                if not isinstance(x['paraphrase'],dict):raise DraftInvalid(f'questions.{n}.paraphrase','Expected object')
                require_str(x['paraphrase'],'heard',1);require_str(x['paraphrase'],'asked',1)
    elif module=='reading':
        p['difficultyLevel']=require_str(p,'difficultyLevel',2,10) if 'difficultyLevel' in p else 'B2'
        p['suggestedMinutes']=require_num(p,'suggestedMinutes',5,90,20)
        ps=must_list(p,'passages',1,1 if typ=='passage' else None)
        for i,x in enumerate(ps):
            if not isinstance(x,dict):raise DraftInvalid(f'passages.{i}','Expected object')
            require_str(x,'title',3,200);require_str(x,'bodyText',50)
            groups=x.get('groups',[])
            if not isinstance(groups,list) or len(groups)>40:raise DraftInvalid(f'passages.{i}.groups','Expected array')
            keys=[g.get('key') for g in groups if isinstance(g,dict)]
            if len(keys)!=len(set(keys)):raise DraftInvalid(f'passages.{i}.groups','Duplicate group key')
            for j,q in enumerate(must_list(x,'questions',1)):
                if not isinstance(q,dict):raise DraftInvalid(f'passages.{i}.questions.{j}','Expected object')
                require_str(q,'typeCode',1);require_str(q,'questionText',3);require_str(q,'correctAnswer',1)
                if q['typeCode'].lower() not in TYPE_MAP:raise DraftInvalid(f'passages.{i}.questions.{j}.typeCode',f'Unknown Reading question type "{q["typeCode"]}".')
                if q.get('groupKey') and q['groupKey'] not in keys:raise DraftInvalid(f'passages.{i}.questions.{j}.groupKey','Unknown question group')
    elif module=='writing':
        if typ in ('task1','task2'):
            require_choice(p,'taskType',('task1','task2'));require_str(p,'category',2,60);require_str(p,'prompt',10)
            require_num(p,'targetWordCount',50,600)
            if p['taskType']!=typ:raise DraftInvalid('taskType',f'This author writes {typ} prompts only')
        elif typ=='lesson':
            require_choice(p,'category',LESSON_CATS);require_str(p,'body',20,20000)
            if p.get('summary') is not None:require_str(p,'summary',0,600)
            if p.get('durationMinutes') is not None:require_num(p,'durationMinutes',1,240)
            p['position']=require_num(p,'position',0,10000,0)
        elif typ=='model_text':
            require_choice(p,'taskType',('task1','task2'));require_str(p,'topic',2,120)
            if p.get('targetBand') not in (8,8.5,9):raise DraftInvalid('targetBand','A model text is Band 8, 8.5 or 9.')
            require_str(p,'body',200,8000);require_str(p,'provenance',2,200)
            if len(p['body'].split())< (150 if p['taskType']=='task1' else 250):
                raise DraftInvalid('body','A model text must be a complete answer: at least 150 words for Task 1 and 250 for Task 2.')
        elif typ=='pattern':
            require_str(p,'pattern',3,240);require_choice(p,'function',PATTERN_FUNCS);require_choice(p,'taskType',('task1','task2'))
            require_str(p,'example',5,400);require_str(p,'provenance',2,200)
            for k,m in (('topic',120),('usageNote',600)):
                if p.get(k) is not None:require_str(p,k,0,m)
            if p.get('targetBand') is not None:require_num(p,'targetBand',5,9)
        else:
            require_str(p,'topic',2,120);require_choice(p,'questionType',TRANSLATION_TYPES)
            p['taskType']=require_choice(p,'taskType',('task1','task2'),'task2')
            if p.get('targetBand') not in (6,7,8):raise DraftInvalid('targetBand','A translation set is Band 6, 7 or 8.')
            require_str(p,'promptText',10,2000);require_str(p,'provenance',2,200)
            positions=set()
            for i,s in enumerate(must_list(p,'sentences',0,40)):
                if not isinstance(s,dict):raise DraftInvalid(f'sentences.{i}','Expected object')
                no=require_num(s,'position',1,40);require_str(s,'uzbekSource',2,600);require_str(s,'modelEnglish',2,600)
                if no in positions:raise DraftInvalid('sentences','Two sentences share a position.')
                positions.add(no)
                for k,n,maxlen in (('acceptedAlternatives',10,600),('notes',5,400),('targetLexicalItems',10,80)):
                    s.setdefault(k,[])
                    for value in must_list(s,k,0,n):
                        if not isinstance(value,str) or not 1<=len(value)<=maxlen:raise DraftInvalid(f'sentences.{i}.{k}','Invalid string')
    elif module=='speaking':
        if typ!='material':
            require_choice(p,'part',('part1','part2','part3'));require_str(p,'category',2,60);require_str(p,'promptText',3)
            for k,lo,hi in (('cueCard',0,2000),('topic',0,200)):
                if k in p:require_str(p,k,lo,hi)
            p['prepSeconds']=require_num(p,'prepSeconds',0,600,30)
            p['answerSeconds']=require_num(p,'answerSeconds',15,900,90)
            p.setdefault('followUps',[])
            for v in must_list(p,'followUps',0,12):
                if not isinstance(v,str) or not v:raise DraftInvalid('followUps','Expected nonempty string')
        else:
            for k in p:
                if k not in ('title','category','primaryType','primaryUrl','description'):raise DraftInvalid(k,"Unrecognized key(s) in object")
            require_str(p,'title',3,200);require_choice(p,'category',('part1','part2','part3','general','top_structures'))
            require_choice(p,'primaryType',('link','video','audio','file'))
            if p.get('primaryType')=='link' and not p.get('primaryUrl'):raise DraftInvalid('primaryUrl','A link material needs its URL.')
            if p.get('primaryType')!='link' and p.get('primaryUrl'):raise DraftInvalid('primaryUrl','A file is attached by upload, not by URL.')
            if p.get('primaryUrl'):
                require_str(p,'primaryUrl',1,2000)
                if not urlparse(p['primaryUrl']).scheme:raise DraftInvalid('primaryUrl','Invalid url')
            if 'description' in p:require_str(p,'description',0,4000)
    elif module=='grammar':
        require_str(p,'title',3,200);require_str(p,'explanation',5)
        p['skillArea']=require_choice(p,'skillArea',('writing','speaking'),'writing');p['order']=require_num(p,'order',0,None,0)
        for n,x in enumerate(must_list(p,'exercises',1)):
            if not isinstance(x,dict):raise DraftInvalid(f'exercises.{n}','Expected object')
            require_str(x,'promptText',3);require_str(x,'correctOption',1);require_str(x,'explanation',3)
            for v in must_list(x,'options',2,6):
                if not isinstance(v,str) or not v:raise DraftInvalid(f'exercises.{n}.options','Invalid string')
    elif module=='vocabulary':
        require_str(p,'labelEn',2,120);require_str(p,'slug',2,60)
        for k,m in (('labelUz',120),('topicCode',40),('level',10)):
            if p.get(k) is not None:require_str(p,k,0,m)
        p['position']=require_num(p,'position',0,None,0)
        for n,x in enumerate(must_list(p,'words',1)):
            if not isinstance(x,dict):raise DraftInvalid(f'words.{n}','Expected object')
            require_str(x,'term',1,120);require_str(x,'definitionEn',1,500);require_str(x,'example',1,500)
            x.setdefault('partOfSpeech','');x.setdefault('translationUz','')
            require_str(x,'partOfSpeech',0,30);require_str(x,'translationUz',0,500)
            if 'collocations' in x:require_str(x,'collocations',0,500)
    elif module=='lesson':
        try:uuid.UUID(require_str(p,'unitId',36,36))
        except (ValueError,DraftInvalid):raise DraftInvalid('unitId','Choose the unit this lesson belongs to.')
        require_str(p,'slug',2,60);require_choice(p,'learningArea',('listening','reading','writing','speaking','grammar','vocabulary','general'))
        for k,m in (('summary',2000),('teacherNotes',8000)):
            if p.get(k) is not None:require_str(p,k,0,m)
        if p.get('estimatedMinutes') is not None:require_num(p,'estimatedMinutes',1,600)
        if 'order' in p:require_num(p,'order',0)
        p.setdefault('blocks',[])
        if not isinstance(p['blocks'],list):raise DraftInvalid('blocks','The lesson material could not be read.')
        problems=validate_blocks(p['blocks'])
        if problems:raise DraftInvalid(problems[0].get('field') or 'blocks',problems[0]['message'])
    return p

async def upsert(con,table,keyname,keyval,fields,create=None):
    # Identifiers are constant, defined by this module only. Values are always bound.
    found=await con.fetchrow(f'SELECT id FROM {table} WHERE {keyname}=$1 LIMIT 1',keyval)
    if found:
        sets=','.join(f'{name}=${i+2}' for i,name in enumerate(fields))
        await con.execute(f'UPDATE {table} SET {sets} WHERE id=$1',found['id'],*fields.values())
        return found['id']
    values={keyname:keyval,'publication_state':'draft',**(create or {}),**fields}
    cols=','.join(values);params=','.join(f'${i+1}' for i in range(len(values)))
    return await con.fetchval(f'INSERT INTO {table} ({cols}) VALUES ({params}) RETURNING id',*values.values())

async def write_lesson_blocks(con,ident,blocks):
    for i,b in enumerate(blocks):
        ref=b.get('ref') or {};quiz=b.get('quiz') or {}
        await con.execute('''INSERT INTO lesson_blocks(lesson_id,position,type,text_content,link_url,object_key,original_name,mime_type,size,
             ref_module,ref_content_type,ref_source_ref,ref_content_version_id,quiz_question_type,quiz_payload)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)''',
             ident,i+1,b['type'],b.get('text'),b.get('url'),b.get('objectKey'),b.get('originalName'),b.get('mimeType'),b.get('size'),
             ref.get('module'),ref.get('contentType'),ref.get('sourceRef'),uuid.UUID(ref['versionId']) if ref.get('versionId') else None,
             quiz.get('questionType'),json.dumps(quiz) if quiz else None)

async def persist(con,module,typ,p,ctx):
    source,title,actor=ctx['sourceRef'],ctx['title'],ctx['actor']
    if module=='listening':
        row=await con.fetchrow('SELECT id,publication_state FROM listening_tests WHERE source_ref=$1',source)
        v={'title':title,'audio_type':p['audioType'],'audio_url':p.get('audioUrl'),
           'transcript':p.get('transcript'),'difficulty_level':p['difficultyLevel']}
        if row and row['publication_state'] in ('published','scheduled'):ident=row['id']
        else:ident=await upsert(con,'listening_tests','source_ref',source,v,{'created_by_user_id':actor})
        content={'audioType':p['audioType'],'audioUrl':p.get('audioUrl'),'transcript':p.get('transcript'),
         'difficultyLevel':p['difficultyLevel'],'questions':[
         {'order':q.get('order',i+1),'type':resolve_listening_type(q['type'])['id'],'storageType':resolve_listening_type(q['type'])['storageType'],
           'questionText':q['questionText'],'options':q.get('options'),'correctAnswer':q['correctAnswer'],
           'explanation':q['explanation'],**({'keywords':q['keywords']} if q.get('keywords') else {}),
           **({'paraphrases':[q['paraphrase']]} if q.get('paraphrase') else {})} for i,q in enumerate(p['questions'])]}
        if typ=='section':content={'sectionNo':p['sectionNo'],**content}
        return 'listening_test',ident,content,f'Listening {"test" if typ=="full_test" else "section "+str(p["sectionNo"])} with {len(p["questions"])} question(s)'
    if module=='writing':
        if typ in ('task1','task2'):
            ident=await upsert(con,'writing_prompts','source_ref',source,{k:v for k,v in [('task_type',typ),('category',p['category']),('prompt',p['prompt']),('target_word_count',p['targetWordCount'])]})
            return 'writing_prompt',ident,{'prompt':p['prompt'],'taskType':typ,'wordMinimum':p['targetWordCount'],'category':p['category']},f'Writing {typ} prompt'
        if typ=='lesson':
            ident=await upsert(con,'writing_lessons','source_ref',source,{'title':title,'category':p['category'],'summary':p.get('summary'),'body':p['body'],'duration_minutes':p.get('durationMinutes'),'position':p['position']})
            return 'writing_lesson',ident,{'title':title,'category':p['category'],'summary':p.get('summary'),'body':p['body'],'durationMinutes':p.get('durationMinutes')},'Writing lesson'
        if typ=='model_text':
            count=len(p['body'].split());ident=await upsert(con,'writing_model_texts','source_ref',source,{'title':title,'task_type':p['taskType'],'topic':p['topic'],'target_band':str(p['targetBand']),'body':p['body'],'word_count':count,'provenance':p['provenance']})
            content={'title':title,'taskType':p['taskType'],'topic':p['topic'],'targetBand':p['targetBand'],'body':p['body'],'wordCount':count,'provenance':p['provenance']}
            return 'writing_model_text',ident,content,f'Model text at Band {p["targetBand"]} ({count} words)'
        if typ=='pattern':
            prior=await con.fetchval("SELECT target_id FROM content_versions WHERE module='writing' AND content_type='pattern' AND source_ref=$1 ORDER BY version_no DESC LIMIT 1",source)
            vals={'pattern':p['pattern'],'function':p['function'],'task_type':p['taskType'],'topic':p.get('topic'),'target_band':p.get('targetBand'),'example':p['example'],'usage_note':p.get('usageNote'),'provenance':p['provenance']}
            if prior and await con.fetchval('SELECT 1 FROM writing_language_patterns WHERE id=$1',prior):
                sets=','.join(f'{k}=${i+2}' for i,k in enumerate(vals));await con.execute(f'UPDATE writing_language_patterns SET {sets} WHERE id=$1',prior,*vals.values());ident=prior
            else:
                cols=','.join((*vals,'publication_state'));params=','.join(f'${i+1}' for i in range(len(vals)+1));ident=await con.fetchval(f'INSERT INTO writing_language_patterns({cols}) VALUES({params}) RETURNING id',*vals.values(),'draft')
            return 'writing_pattern',ident,{k: p.get(k) for k in ('pattern','function','taskType','topic','example','usageNote')},f'Pattern “{p["pattern"]}”'
        if typ=='translation_set':
            vals={'title':title,'topic':p['topic'],'question_type':p['questionType'],'task_type':p['taskType'],'target_band':p['targetBand'],'prompt_text':p['promptText'],'provenance':p['provenance']}
            ident=await upsert(con,'writing_translation_sets','source_ref',source,vals)
            await con.execute('DELETE FROM writing_translation_sentences WHERE set_id=$1',ident)
            for x in p['sentences']:
                await con.execute('''INSERT INTO writing_translation_sentences(set_id,position,uzbek_source,model_english,accepted_alternatives,notes,target_lexical_items)
                 VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)''',ident,x['position'],x['uzbekSource'],x['modelEnglish'],json.dumps(x['acceptedAlternatives']),json.dumps(x['notes']),json.dumps(x['targetLexicalItems']))
            return 'writing_translation_set',ident,{'title':title,'topic':p['topic'],'questionType':p['questionType'],'taskType':p['taskType'],'targetBand':p['targetBand'],'promptText':p['promptText'],'sentences':p['sentences']},f'Translation set with {len(p["sentences"])} sentence(s)'
    if module=='speaking':
        if typ!='material':
            part={'part1_question':'part1','cue_card':'part2','part3_question':'part3'}[typ]
            if p['part']!=part:raise DraftInvalid('part',f'speaking:{typ} author received {p["part"]}')
            vals={'part':part,'category':p['category'],'prompt_text':p['promptText'],'cue_card':p.get('cueCard'),'prep_seconds':p['prepSeconds'],'answer_seconds':p['answerSeconds'],
             'follow_ups':json.dumps(p['followUps']),'topic':p.get('topic',title)}
            ident=await upsert(con,'speaking_prompts','external_id',source,vals)
            return 'speaking_prompt',ident,{'part':part,'promptText':p['promptText'],'cueCard':p.get('cueCard'),'followUps':p['followUps'],'prepSeconds':p['prepSeconds'],'answerSeconds':p['answerSeconds']},f'Speaking {part} prompt'
        prior=await con.fetchval("SELECT target_id FROM content_versions WHERE module='speaking' AND content_type='material' AND source_ref=$1 ORDER BY version_no DESC LIMIT 1",source)
        old=await con.fetchrow('SELECT id,primary_object_key,primary_url FROM speaking_materials WHERE id=$1',prior) if prior else None
        if old and old['primary_object_key'] and p['primaryType']=='link':raise ValueError('speaking:material is upload-backed; its primary is replaced through the upload flow, not by a URL')
        vals={'title':p['title'],'category':p['category'],'primary_type':p['primaryType'],'primary_url':p.get('primaryUrl') if p['primaryType']=='link' else old['primary_url'] if old else None}
        if old:
            sets=','.join(f'{k}=${i+2}' for i,k in enumerate(vals));await con.execute(f'UPDATE speaking_materials SET {sets} WHERE id=$1',old['id'],*vals.values());ident=old['id']
        else:
            ident=await con.fetchval('''INSERT INTO speaking_materials(created_by_user_id,title,category,primary_type,primary_url,publication_state)
              VALUES($1,$2,$3,$4,$5,'draft') RETURNING id''',actor,p['title'],p['category'],p['primaryType'],vals['primary_url'])
        return 'speaking_material',ident,{'title':p['title'],'category':p['category'],'primaryType':p['primaryType'],'primaryUrl':p.get('primaryUrl') if p['primaryType']=='link' else None,'description':p.get('description')},f'Speaking material ({p["category"]})'
    if module=='grammar':
        ident=await upsert(con,'grammar_topics','source_ref',source,{'title':p['title'],'explanation':p['explanation'],'skill_area':p['skillArea'],'"order"':p['order']})
        await con.execute('DELETE FROM grammar_exercises WHERE topic_id=$1',ident)
        for i,x in enumerate(p['exercises']):
            await con.execute('''INSERT INTO grammar_exercises(topic_id,"order",prompt_text,options,correct_option,explanation)
              VALUES($1,$2,$3,$4::jsonb,$5,$6)''',ident,i+1,x['promptText'],json.dumps(x['options']),x['correctOption'],x['explanation'])
        return 'grammar_topic',ident,{'title':p['title'],'explanation':p['explanation'],'exercises':p['exercises']},f'Grammar topic with {len(p["exercises"])} exercise(s)'
    if module=='reading':
        # Each revision owns NEW physical rows. Historical answer FKs remain intact.
        await con.execute('SELECT pg_advisory_xact_lock(hashtext($1))','reading-version:'+source)
        set_id=None
        if typ=='general_set':
            set_id=await con.fetchval("INSERT INTO general_reading_sets(title,difficulty_level,publication_state) VALUES($1,$2,'draft') RETURNING id",title,p['difficultyLevel'])
        ids=[];count=0
        for i,x in enumerate(p['passages']):
            pid=await con.fetchval('''INSERT INTO reading_passages(title,body_text,difficulty_level,suggested_minutes,publication_state,source_ref,passage_no)
                 VALUES($1,$2,$3,$4,'draft',$5,$6) RETURNING id''',x['title'],x['bodyText'],p['difficultyLevel'],p['suggestedMinutes'],source,i+1)
            ids.append(pid)
            if set_id:
                await con.execute('INSERT INTO general_reading_passages(set_id,passage_id,passage_no) VALUES($1,$2,$3)',set_id,pid,i+1)
            groups={}
            for j,g in enumerate(x.get('groups',[])):
                groups[g['key']]=await con.fetchval('''INSERT INTO reading_question_groups(passage_id,position,type_code,display_title,instructions_text,shared_choices,from_question_no,to_question_no)
                VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING id''',pid,j+1,g['typeCode'],g.get('displayTitle'),g.get('instructionsText'),json.dumps(g.get('sharedChoices',[])),g.get('fromQuestionNo'),g.get('toQuestionNo'))
            for j,q in enumerate(x['questions']):
                canonical,aliases,storage=TYPE_MAP[q['typeCode'].lower()]
                typ_store='true_false_not_given' if canonical=='true_false_not_given' else 'yes_no_not_given' if canonical=='yes_no_not_given' else 'multiple_choice' if storage=='multiple_choice' else 'short_answer'
                await con.execute('''INSERT INTO reading_questions(passage_id,"order",question_no,type,type_code,question_text,options,correct_answer,group_id,accepted_answers,
                  answer_constraint,render_mode,evidence_quote,explanation) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)''',
                  pid,q.get('order',j+1),q.get('questionNo',j+1),typ_store,canonical,q['questionText'],json.dumps(q.get('options')),
                  q['correctAnswer'],groups.get(q.get('groupKey')),json.dumps(q.get('acceptedAnswers',[])),json.dumps(q.get('answerConstraint')),q.get('renderMode'),q.get('evidenceQuote'),q.get('explanation',''))
                count+=1
        content={'canonicalPassageIds':[str(pid) for pid in ids],'canonicalSetId':str(set_id) if set_id else None,
            'passages':[{'title':x['title'],'bodyText':x['bodyText'],'groups':x.get('groups',[]),
             'questions':[{**q,'typeCode':TYPE_MAP[q['typeCode'].lower()][0]} for q in x['questions']]} for x in p['passages']],
            'timeLimitMinutes':p['suggestedMinutes']}
        return 'general_reading_set' if set_id else 'reading_passage',set_id or ids[0],content,f'Reading item with {len(ids)} passage(s) and {count} question(s)'
    if module=='vocabulary':
        # Identity of a sense uses term + POS + full meaning, not only spelling.
        clean=lambda v: ' '.join(unicodedata.normalize('NFKC',v or '').lower().replace('’',"'").split()).strip().rstrip('.')
        existing=await con.fetchrow('SELECT id,publication_state FROM vocabulary_topic_packs WHERE source_ref=$1',source)
        if existing and existing['publication_state']=='published':
            raise DraftInvalid('','A published pack is frozen: revise it into a draft first.')
        vals={'slug':re.sub('-+','-',re.sub('[^a-z0-9._-]+','-',p['slug'].lower().strip())).strip('-')[:60],
             'label_en':p['labelEn'].strip(),'label_uz':p.get('labelUz'),'topic_code':p.get('topicCode'),'level':p.get('level'),'position':p['position']}
        ident=await upsert(con,'vocabulary_topic_packs','source_ref',source,vals,{'created_by_user_id':actor})
        await con.execute('DELETE FROM vocabulary_topic_pack_words WHERE pack_id=$1',ident)
        for i,w in enumerate(p['words']):
            norm_term=clean(w['term']);norm_pos=clean(w['partOfSpeech']);norm_meaning=clean(w['definitionEn'])
            sk='v2:'+hashlib.sha256(json.dumps([norm_term,norm_pos,norm_meaning],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
            lid=await con.fetchval('SELECT id FROM lexemes WHERE sense_key=$1',sk)
            if not lid:
                lid=await con.fetchval('''INSERT INTO lexemes(term,part_of_speech,definition_en,translation_uz,example_sentence,collocations,sense_key,provenance)
                   VALUES($1,$2,$3,$4,$5,$6,$7,'topic_pack') RETURNING id''',w['term'],w['partOfSpeech'],w['definitionEn'],w['translationUz'],w['example'],w.get('collocations'),sk)
            await con.execute('INSERT INTO vocabulary_topic_pack_words(pack_id,lexeme_id,position) VALUES($1,$2,$3)',ident,lid,i+1)
        return 'vocabulary_topic_pack',ident,{'labelEn':p['labelEn'],
          'words':[{'term':w['term'],'partOfSpeech':w['partOfSpeech'],'definitionEn':w['definitionEn']} for w in p['words']]},f'Vocabulary pack with {len(p["words"])} word(s)'
    if module=='lesson':
        prev=await con.fetchrow('SELECT id,publication_state FROM lessons WHERE source_ref=$1',source)
        vals={'unit_id':uuid.UUID(p['unitId']),'slug':p['slug'],'title':title,'summary':p.get('summary'),
         'learning_area':p['learningArea'],'teacher_notes':p.get('teacherNotes') or None,'estimated_minutes':p.get('estimatedMinutes')}
        if prev:
            ident=prev['id']
            if prev['publication_state'] not in ('published','scheduled'):
                sets=','.join(f'{k}=${i+2}' for i,k in enumerate(vals))
                await con.execute(f'UPDATE lessons SET {sets} WHERE id=$1',ident,*vals.values())
                await con.execute('DELETE FROM lesson_blocks WHERE lesson_id=$1',ident)
                await write_lesson_blocks(con,ident,p['blocks'])
        else:
            ident=await con.fetchval('''INSERT INTO lessons(unit_id,slug,title,summary,learning_area,teacher_notes,estimated_minutes,"order",source_ref,publication_state,created_by_user_id,default_state)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,'locked') RETURNING id''',
                 uuid.UUID(p['unitId']),p['slug'],title,p.get('summary'),p['learningArea'],p.get('teacherNotes') or None,p.get('estimatedMinutes'),p.get('order',0),source,actor)
            await write_lesson_blocks(con,ident,p['blocks'])
        snap=[]
        for i,b in enumerate(p['blocks']):
            snap.append({'position':i+1,'type':b.get('type'),'text':b.get('text'),'url':b.get('url'),
              'objectKey':b.get('objectKey'),'originalName':b.get('originalName'),'mimeType':b.get('mimeType'),'size':b.get('size'),
              'ref':b.get('ref'),'quiz':b.get('quiz')})
        content={'unitId':p['unitId'],'slug':p['slug'],'order':p.get('order'),'learningArea':p['learningArea'],
         'summary':p.get('summary'),'teacherNotes':p.get('teacherNotes') or None,
         'estimatedMinutes':p.get('estimatedMinutes'),'blocks':snap}
        return 'lesson',ident,content,f'Lesson with {len(snap)} block(s)'
    # Complex author families must be implemented through the canonical domain service
    # rather than writing a parallel generic JSON-only store.
    raise NotImplementedError(f'Canonical {module}:{typ} author service is not ported')

async def pin_draft(con,ctx,content,target_type,target_id,summary):
    from .step25_content_version import version_hashes
    module,typ,source,title,track=ctx['module'],ctx['contentType'],ctx['sourceRef'],ctx['title'],ctx['track']
    latest=await con.fetchrow('''SELECT * FROM content_versions WHERE module=$1 AND content_type=$2 AND source_ref=$3
      ORDER BY version_no DESC LIMIT 1 FOR UPDATE''',module,typ,source)
    hashes=version_hashes(module,typ,content)
    if ctx.get('versionId') and latest and str(latest['id'])==ctx['versionId'] and latest['status']=='draft' and latest['publication_state']=='draft':
        await con.execute('''UPDATE content_versions SET title=$2,track=$3,content_hash=$4,semantic_hash=$5,answer_key_hash=$6,
          content_snapshot=$7::jsonb,provenance=$8::jsonb,note=$9 WHERE id=$1''',latest['id'],title,track,*hashes.values(),encoded(content),json.dumps({'origin':'authored','summary':summary}),ctx.get('note'))
        return latest['id'],latest['version_no'],False
    semantic=not latest or latest['semantic_hash']!=hashes['semantic_hash']
    force=module=='reading'
    if latest and not semantic and not force:
        await con.execute('''UPDATE content_versions SET title=$2,track=$3,publication_state='draft',note=$4 WHERE id=$1''',latest['id'],title,track,ctx.get('note'))
        return latest['id'],latest['version_no'],False
    num=(latest['version_no'] if latest else 0)+1
    row=await con.fetchrow('''INSERT INTO content_versions(module,content_type,source_ref,version_no,status,title,track,content_hash,semantic_hash,
        answer_key_hash,content_snapshot,publication_state,target_type,target_id,created_by_user_id,change_kind,provenance,note)
        VALUES($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10::jsonb,'draft',$11,$12,$13,$14,$15::jsonb,$16) RETURNING id''',
        module,typ,source,num,title,track,*hashes.values(),encoded(content),target_type,target_id,ctx['actor'],
        'created' if not latest else 'answer_key' if latest['answer_key_hash']!=hashes['answer_key_hash'] else 'semantic',
        json.dumps({'origin':'authored','summary':summary}),ctx.get('note'))
    return row['id'],num,True

@router.post('/api/admin/content/drafts')
async def content_drafts(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('owner','admin','teacher'):return core.j({'error':'forbidden'},403)
    raw=await core.payload(req)
    if not isinstance(raw,dict):return core.j({'error':'Required'},400)
    try:
        module=require_str(raw,'module',2,20);typ=require_str(raw,'contentType',2,40)
        source=require_str(raw,'sourceRef',1,80);title=require_str(raw,'title',1,200)
        track=require_choice(raw,'track',('academic','general_training','unspecified'),'unspecified')
        if 'payload' not in raw:raise DraftInvalid('payload','Required')
        if raw.get('note') is not None:require_str(raw,'note',0,500)
        if raw.get('versionId') is not None:
            try:uuid.UUID(require_str(raw,'versionId',36,36))
            except ValueError:raise DraftInvalid('versionId','Invalid uuid')
    except DraftInvalid as e:return core.j({'error':e.message},400)
    if (module,typ) not in REGISTERED or (user['role']=='teacher' and (module,typ) not in {('lesson','lesson'),('speaking','material')}):
        return core.j({'error':'forbidden'},403)
    issues=[]
    if module not in TAXONOMY:issues.append({'code':'unknown_module','message':f'Unknown module "{module}".','field':'module'})
    elif typ not in TAXONOMY[module]:issues.append({'code':'unknown_content_type','message':f'"{typ}" is not a content type of the {LABELS[module]} module ({", ".join(TAXONOMY[module])}).','field':'contentType'})
    if source.strip()!=source or not re.fullmatch('[a-z0-9._-]+',source) or '--' in source:
        issues.append({'code':'unstable_source_ref','message':'A source reference must be lower-case a–z, 0–9, dot, dash or underscore (it identifies the item forever, so a title will not do).','field':'sourceRef'})
    if issues:return core.j({'ok':False,'issues':issues},422)
    try:parsed=validate(module,typ,raw['payload'])
    except DraftInvalid as e:return core.j({'ok':False,'issues':[{'code':'invalid_payload','message':e.message,**({'field':e.field} if e.field else {})}]},422)
    ctx={'module':module,'contentType':typ,'sourceRef':source,'title':title.strip(),'track':track,
          'versionId':raw.get('versionId'),'note':raw.get('note'),'actor':user['id']}
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            if ctx['versionId']:
                row=await con.fetchrow('SELECT id,module,content_type,source_ref,status FROM content_versions WHERE id=$1',uuid.UUID(ctx['versionId']))
                if not row:return core.j({'ok':False,'issues':[{'code':'version_not_found','message':'Unknown content version.'}]},422)
                if row['status'] in ('published','archived'):
                    return core.j({'ok':False,'issues':[{'code':'published_is_immutable','message':'A published revision is immutable: revise it into a new version instead of rewriting history.'}]},422)
                if (row['module'],row['content_type'],row['source_ref'])!=(module,typ,source):
                    return core.j({'ok':False,'issues':[{'code':'version_identity_mismatch','message':'That revision belongs to different content.'}]},422)
            try:
                target,ident,content,summary=await persist(con,module,typ,parsed,ctx)
                version,no,created=await pin_draft(con,ctx,content,target,ident,summary)
            except DraftInvalid as e:
                # Validation happens before any writes for this exception type.
                return core.j({'ok':False,'issues':[{'code':'invalid_payload','message':e.message,'field':e.field}]},422)
    return core.j({'ok':True,'versionId':str(version),'versionNo':no,'created':created,'targetId':str(ident)},201 if created else 200)

def install():core.app.include_router(router)
