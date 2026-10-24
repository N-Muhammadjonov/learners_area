"""Pure content-package schema/domain validation port.
Sources: import/core/{parse,envelope,validation,identity}.ts;
import/{reading,listening}/canonical.ts, listening/package.ts and
reading/import-schema.ts. Data-only: scripts and active markup rejected.
"""
from __future__ import annotations
import json,re,hashlib,math,copy
from pathlib import Path

ABSENT=object(); ISSUE_CODE='schema_invalid'
LISTENING_AUDIO=['audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/x-wav','audio/webm','video/webm','audio/flac']
LISTENING_IMAGE=['image/png','image/jpeg','image/webp']
PROVENANCE_LABELS={'owner_authored':'Owner authored','teacher_authored':'Teacher authored','ai_authoring':'AI assisted authoring','legacy_conversion':'Converted from legacy material','third_party':'Third-party material','unknown':'Source not stated'}
READING_TYPES={alias.lower() for name,aliases,storage in json.loads((Path(__file__).parent/'reading_question_types.json').read_text()) for alias in [name,*aliases]}
MISSING=object()
def issue(level,code,msg,path=None,blocking=True):
    d={'level':level,'code':code,'message':msg}
    if path:d['path']=path
    d['blocking']=blocking
    return d
class InvalidPackage(Exception):
    def __init__(self,code,items):super().__init__(code);self.code=code;self.items=items

def spec(kind,default=MISSING,**kw):return {'kind':kind,'default':default,**kw}
def s(min=0,max=None,default=MISSING,trim=False,pattern=None,enum=None):return spec('string',default,min=min,max=max,trim=trim,pattern=pattern,enum=enum)
def n(min=None,max=None,integer=False,default=MISSING):return spec('number',default,min=min,max=max,integer=integer)
def b(default=MISSING):return spec('bool',default)
def ar(item,min=0,max=None,default=MISSING):return spec('array',default,item=item,min=min,max=max)
def ob(fields,strict=False,default=MISSING):return spec('object',default,fields=fields,strict=strict)
def nullable(inner,default=MISSING):return spec('nullable',default,inner=inner)
def opt(inner):return {**inner,'optional':True}
def schema_error(path,text):return issue(1,'schema_invalid',text,path)

def parse(value,desc,path='',issues=None):
    if issues is None:issues=[]
    if value is MISSING:
        if desc.get('default',MISSING) is not MISSING:return copy.deepcopy(desc['default'])
        if desc.get('optional'):return MISSING
        issues.append(schema_error(path,'Required'));return MISSING
    kind=desc['kind']
    if kind=='any':return value
    if kind=='nullable':return None if value is None else parse(value,desc['inner'],path,issues)
    if kind=='string':
        if not isinstance(value,str):issues.append(schema_error(path,'Expected string, received '+('null' if value is None else type(value).__name__)));return MISSING
        if desc.get('trim'):value=value.strip()
        if len(value)<desc.get('min',0):issues.append(schema_error(path,f'String must contain at least {desc["min"]} character(s)'))
        if desc.get('max') is not None and len(value)>desc['max']:issues.append(schema_error(path,f'String must contain at most {desc["max"]} character(s)'))
        if desc.get('pattern') and not re.fullmatch(desc['pattern'],value):issues.append(schema_error(path,'Invalid'))
        if desc.get('enum') and value not in desc['enum']:issues.append(schema_error(path,f"Invalid enum value. Expected {', '.join(map(repr,desc['enum']))}, received {value!r}"))
        return value
    if kind=='number':
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value):issues.append(schema_error(path,'Expected number, received '+type(value).__name__));return MISSING
        if desc.get('integer') and int(value)!=value:issues.append(schema_error(path,'Expected integer, received float'))
        if desc.get('min') is not None and value<desc['min']:issues.append(schema_error(path,f'Number must be greater than or equal to {desc["min"]}'))
        if desc.get('max') is not None and value>desc['max']:issues.append(schema_error(path,f'Number must be less than or equal to {desc["max"]}'))
        return value
    if kind=='bool':
        if not isinstance(value,bool):issues.append(schema_error(path,'Expected boolean, received '+type(value).__name__));return MISSING
        return value
    if kind=='array':
        if not isinstance(value,list):issues.append(schema_error(path,'Expected array, received '+type(value).__name__));return MISSING
        if len(value)<desc.get('min',0):issues.append(schema_error(path,f'Array must contain at least {desc["min"]} element(s)'))
        if desc.get('max') is not None and len(value)>desc['max']:issues.append(schema_error(path,f'Array must contain at most {desc["max"]} element(s)'))
        result=[]
        for i,entry in enumerate(value):
            got=parse(entry,desc['item'],(path+'.' if path else '')+str(i),issues)
            result.append(got if got is not MISSING else None)
        return result
    if kind=='object':
        if not isinstance(value,dict):issues.append(schema_error(path,'Expected object, received '+type(value).__name__));return MISSING
        if desc.get('strict'):
            extra=[k for k in value if k not in desc['fields']]
            if extra:issues.append(schema_error(path,'Unrecognized key(s) in object: '+', '.join(repr(x) for x in extra)))
        if desc.get('dynamic'):
            return {k:parse(v,desc['dynamic'],(path+'.' if path else '')+k,issues) for k,v in value.items()}
        normalized={}
        for k,typ in desc['fields'].items():
            got=parse(value.get(k,MISSING),typ,(path+'.' if path else '')+k,issues)
            if got is not MISSING:normalized[k]=got
        return normalized
    raise ValueError('unknown validator '+str(kind))

KEY_PATTERN=r'[a-z0-9][a-z0-9._-]{0,60}'
source_pat=r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}'
asset=ob({'key':s(trim=True,pattern=KEY_PATTERN),'role':s(enum=['audio','image','document']),
  'required':b(True),'label':opt(s(max=200,trim=True)),'mimeTypes':ar(s(max=100,trim=True),min=1,max=20),
  'maxBytes':n(min=1,max=512*1024*1024,integer=True,default=120*1024*1024),
  'sha256':opt(s(pattern=r'[0-9a-f]{64}')),'path':opt(s(max=400,trim=True))},strict=True)
provenance=ob({'source':s(default='unknown',enum=list(PROVENANCE_LABELS)),'note':opt(s(max=1000,trim=True)),
 'attribution':opt(s(max=500,trim=True)),'organization':opt(s(max=300,trim=True)),
 'sourceUrl':opt(s(max=1000,trim=True)),'originalFilename':opt(s(max=255,trim=True)),
 'rights':opt(s(max=300,trim=True))},strict=True,default={'source':'unknown'})
publication=ob({'state':s(default='draft',enum=['draft','scheduled','published','archived']),
 'publishAt':opt(s())},strict=True,default={'state':'draft'})
envelope=ob({'schemaVersion':n(min=1,max=1000,integer=True),'module':s(enum=['listening','reading','writing','grammar','vocabulary','ted','speaking','lesson']),
 'contentType':s(trim=True,pattern=r'[a-z][a-z0-9_]{1,59}'),'sourceRef':s(trim=True,min=1,max=80,pattern=source_pat),
 'title':s(trim=True,min=1,max=200),'language':s(trim=True,min=2,max=12,default='en'),
 'provenance':provenance,'publication':publication,'assets':ar(asset,max=40,default=[]),
 'contentHash':opt(s(pattern=r'[0-9a-f]{64}')),'content':spec('any')},strict=True)
# Domain schemas, with defaults specified by the original Zod leaves.
vocab=ob({'word':s(min=1,max=120),'pos':s(max=30,default=''),'def':s(min=1,max=600),'uz':s(max=300,default=''),'ex':s(max=600,default=''),
 'surfaces':opt(ar(s(min=1,max=120),max=10))})
constraint=ob({'max_words':opt(n(min=1,max=100,integer=True)),'number_allowed':opt(b()),'selection_count':opt(n(min=1,max=10,integer=True)),
 'allowed_values':opt(ar(s(),max=30))})
group=ob({'key':s(min=1,max=40),'typeCode':s(min=1,max=40),'displayTitle':opt(s(max=120)),
 'instructionsText':opt(s(max=4000)),'sharedChoices':opt(ar(s(max=500),max=30)),
 'fromQuestionNo':opt(n(min=1,max=60,integer=True)),'toQuestionNo':opt(n(min=1,max=60,integer=True))})
reading_question=ob({'questionNo':n(min=1,max=60,integer=True),'type':s(min=1,max=40),
 'groupKey':opt(s(max=40)),'answerConstraint':opt(constraint),'renderMode':opt(s(enum=['shared_stimulus_slot','inline','standalone'])),
 'text':s(min=1,max=2000),'options':opt(ar(s(min=1,max=300),max=10)),'answer':s(min=1,max=300),
 'accepted':ar(s(min=1,max=300),max=10,default=[]),'evidence':opt(s(max=1000)),'explanation':s(max=2000,default='')})
passage=ob({'passageNo':n(min=1,max=3,integer=True),'title':s(min=1,max=200),'body':s(min=1,max=40000),
 'groups':opt(ar(group,max=40)),'questions':ar(reading_question,max=40,default=[]),'vocabulary':ar(vocab,max=300,default=[])})
reading_content=ob({'description':opt(s(max=2000)),'level':opt(s(max=10)),'passages':ar(passage,min=1,max=3)},strict=True)
clip=ob({'q':n(min=1,max=200,integer=True),'part':opt(n(min=1,max=4,integer=True)),'sourceQuestion':opt(n(min=1,max=40,integer=True)),
 'at':n(min=0),'end':n(min=.000000001),'heard':s(min=1,max=12000,trim=True),'link':s(min=1,max=12000,trim=True)})
section=ob({'number':n(min=1,max=4,integer=True),'title':s(min=1,max=12000,trim=True),
 'transcript':s(max=100000,default=''),'reviewRequired':b(False)})
question=ob({'number':n(min=1,max=40,integer=True),'section':n(min=1,max=4,integer=True),
 'text':s(min=1,max=12000,trim=True),'instruction':s(max=2000),'kind':opt(s(enum=['completion','mcq','matching','map'])),
 'typeCode':opt(s(min=3,max=40,trim=True)),'options':ar(s(max=2000),max=12),'key':s(min=1,max=12000,trim=True),
 'alternatives':ar(s(max=500),max=20),'pair':ar(n(min=1,max=40,integer=True),max=2),
 'evidence':ob({'at':n(min=0),'end':opt(n(min=.000000001)),'why':s(max=12000)})})
listening_vocab=ob({'word':s(min=1,max=120),'pos':s(max=30),'uz':s(max=500),'def':s(min=1,max=500),
 'ex':s(max=500),'also':ar(s(max=120),max=20),'quiz':opt(ob({'q':s(min=1,max=12000,trim=True),'options':ar(s(min=1,max=12000,trim=True),min=2,max=8),'correct':n(min=0,integer=True)}))})
keyword2=ob({**clip['fields'],'options':opt(ar(s(min=1,max=12000,trim=True),min=2,max=8)),
 'correct':opt(n(min=0,integer=True)),'answer':opt(s(min=1,max=12000,trim=True))})
study=ob({'kind':s(enum=['research-practice']),'activities':opt(ar(s(enum=['exam','review','script','mcq','recall','vocab','matching','completion','map','retry']),min=1,max=10)),
 'partRanges':{**ob({}),'dynamic':ar(n(min=0),min=2,max=2)}, 'scriptParts':opt(ar(ob({'part':n(min=1,max=4,integer=True),'transcript':s(min=1,max=12000,trim=True),
 'gaps':ar(ob({'q':n(min=1,max=200,integer=True),'match':s(min=1,max=12000,trim=True),'answer':s(min=1,max=12000,trim=True)}),max=200)}),max=4)),
 'recall':ar(ob({'part':n(min=1,max=4,integer=True),'title':s(min=1,max=12000,trim=True),
 'points':ar(s(min=1,max=12000,trim=True),min=1,max=20)}),max=4,default=[])})
listening_content=ob({'collection':s(enum=['essential','academic','general','question_types','mcq'],default='academic'),
 'programme':opt(ob({'ref':s(pattern=r'[a-z0-9][a-z0-9-]{0,79}',default='listening-mcq-program'),'day':n(min=1,max=400,integer=True)},strict=True)),
 'audio':ob({'durationSec':n(min=.00000001,max=7200),'assetKey':s(pattern=KEY_PATTERN,default='audio.full'),'path':opt(s(max=200))},strict=True),
 'image':opt(nullable(ob({'assetKey':s(pattern=KEY_PATTERN,default='image.map')},strict=True))),
 'imagePath':opt(nullable(s(max=200))),
 'mapDiagram':opt(spec('any')),
 'sections':ar(section,min=1,max=4),'questions':ar(question,max=40),
 'keyword1':ar(ob({**clip['fields'],'text':s(min=1,max=12000,trim=True)}),max=200,default=[]),
 'keyword2':ar(keyword2,max=40,default=[]),'vocabulary':ar(listening_vocab,max=40,default=[]),'studyPack':opt(study)},strict=True)

def standard_hash(obj):
    def norm(v):
        if isinstance(v,str):return v.strip()
        if isinstance(v,float) and v.is_integer():return int(v)
        if isinstance(v,list):return [norm(x) for x in v]
        if isinstance(v,dict):return {k:norm(v[k]) for k in sorted(v)}
        return v
    return hashlib.sha256(json.dumps(norm(obj),ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def package_hash(pkg):return standard_hash({'module':pkg['module'],'contentType':pkg['contentType'],'content':pkg['content']})
def provenance_text(pkg):
    p=pkg['provenance'];parts=[PROVENANCE_LABELS[p['source']]]
    for k in ('organization','attribution','note','sourceUrl','originalFilename','rights'):
        if p.get(k):parts.append(('file: ' if k=='originalFilename' else '')+p[k])
    return '; '.join(parts)[:12000]
def executable(value,path='content'):
    issues=[]
    def visit(x,p):
        if isinstance(x,str):
            if re.search(r'<\s*(script|iframe|object|embed|style)\b|javascript:|<\s*/\s*script',x,re.I) or re.search(r'\son[a-z]+\s*=\s*["\']',x,re.I):
                issues.append(issue(2,'executable_markup','Executable markup is not allowed in educational data',p))
            elif re.search(r'(^|[;{]\s*)(color|background|font-family|margin|padding|display|position)\s*:',x,re.I):
                issues.append(issue(2,'executable_markup','Style/CSS declarations are not allowed in educational data',p,False))
        if isinstance(x,list):
            for i,v in enumerate(x):visit(v,p+'.'+str(i))
        if isinstance(x,dict):
            for k,v in x.items():visit(v,p+'.'+k)
    visit(value,path);return issues

def reading_issues(pkg):
    issues=[];seen=set()
    for p in pkg['content']['passages']:
        no=p['passageNo'];questions=p['questions']
        if no in seen:issues.append(issue(2,'semantic_invalid',f'Passage {no} is declared twice.','content.passages'))
        seen.add(no)
        qnos=[q['questionNo'] for q in questions]
        if len(set(qnos))!=len(qnos):issues.append(issue(2,'semantic_invalid',f'Passage {no}: question numbers must be unique.','content.passages'))
        for q in questions:
            if q['type'].lower() not in READING_TYPES:issues.append(issue(1,'schema_invalid','Unknown Reading question type','content.passages'))
            if q['type']=='multiple_choice' and len(q.get('options',[]))<2:
                issues.append(issue(2,'semantic_invalid',f'Passage {no} Q{q["questionNo"]}: a multiple-choice question needs at least two options.','content.passages'))
            if q.get('evidence') and q['evidence'] not in p['body']:
                issues.append(issue(2,'semantic_invalid',f'Passage {no} Q{q["questionNo"]}: the evidence quote is not present in the passage text.','content.passages',False))
            if q.get('groupKey') and q['groupKey'] not in [g['key'] for g in p.get('groups',[])]:issues.append(issue(1,'schema_invalid','Unknown question group','content.passages'))
        groups=p.get('groups',[]);keys=[g['key'] for g in groups]
        if len(set(keys))!=len(keys):issues.append(issue(1,'schema_invalid','Duplicate group key','content.passages'))
        for g in groups:
            if g['typeCode'].lower() not in READING_TYPES:issues.append(issue(1,'schema_invalid','Unknown Reading question type','content.passages'))
    return issues

def listening_issues(pkg):
    x=pkg['content'];issues=[];day=x.get('programme');duration=x['audio']['durationSec']
    def add(message,path,blocking=True):issues.append(issue(2,'semantic_invalid',message,path,blocking))
    if x['collection']!='mcq' and duration<60:add('A full Listening recording must be at least 60 seconds.','content.audio.durationSec')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}',pkg['sourceRef']):add('A Listening sourceRef must be lowercase letters, digits and dashes (it becomes the stable test identity).','sourceRef')
    if not x['questions'] and not day:add('A Listening test needs at least one question.','content.questions')
    if not day and len(x['sections'])!=4:add('A full Listening test normally has 4 parts.','content.sections',False)
    if day:
        if x['collection']!='mcq':add(f'A day of the MCQ programme is authored as an MCQ item (collection "mcq"); this package says "{x["collection"]}".','content.collection')
        if len(x['questions'])!=5:add(f'A published day holds exactly 5 questions; this package carries {len(x["questions"])}, so it will import as a draft that cannot be published yet.','content.questions',False)
        if len(x['sections'])>1:add(f'Day {day["day"]} declares {len(x["sections"])} parts; a day is one recording with its own five questions.','content.sections',False)
    sectionNos=[q['number'] for q in x['sections']];qnos=[q['number'] for q in x['questions']]
    if len(set(sectionNos))<len(sectionNos):add('Duplicate section','content.sections')
    if len(set(qnos))<len(qnos):add('Duplicate question number','content.questions')
    if not x['questions']:add('Missing questions','content.questions')
    for q in x['questions']:
        no=q['number'];ev=q['evidence'];at=ev['at'];end=ev.get('end');path=f'content.questions.{no}'
        if q.get('kind')=='mcq' and len(q['options'])<2:add(f'Q{no}: a multiple-choice question needs at least two options.',path,False)
        if end is not None and end<at:add(f'Q{no}: its evidence window ends ({end}s) before it starts ({at}s).',path)
        if at>duration:add(f'Q{no}: its evidence window starts at {at}s, past the end of the recording ({duration}s).',path)
        if end is not None and end>duration:add(f'Q{no}: its evidence window ends at {end}s, past the end of the recording ({duration}s).',path)
        if q['section'] not in sectionNos:add(f'Q{no}: wrong section',path)
        if at>=duration:add(f'Q{no}: evidence outside audio',path)
        for number in q['pair']:
            paired=next((other for other in x['questions'] if other['number']==number and no in other['pair']),None)
            if number==no or not paired:add('Invalid answer pair',path)
    for group in ('keyword1','keyword2'):
        seen=set()
        for clip in x[group]:
            if clip['q'] in seen:add('Duplicate keyword question','content.'+group)
            seen.add(clip['q'])
            if clip['end']<=clip['at'] or clip['end']>duration:add('Clip outside audio','content.'+group)
            if group=='keyword2' and 'correct' in clip and (clip['correct']>=len(clip.get('options',[]))):add('Invalid Keyword II key','content.keyword2')
    for path in [x['audio'].get('path'),x.get('imagePath')]:
        if path and (re.search(r'[\x00-\x1f\x7f\\:*?"<>|]',path) or path.startswith('/') or '..' in path.split('/') or '//' in path):add('Unsafe asset path','content.audio')
    for section in x['sections']:
        if not section['transcript'].strip():add(f'Part {section["number"]} has no transcript (allowed, shown as missing in preview).','content.sections',False)
    return issues

def requirements(pkg):
    if pkg['module']!='listening':return []
    x=pkg['content'];audio=x['audio']
    result=[{'key':audio['assetKey'],'role':'audio','required':True,'label':'Full test recording','mimeTypes':LISTENING_AUDIO,'maxBytes':200*1024*1024,'usedBy':'content.audio'}]
    if x.get('image') or x.get('imagePath'):
        result.append({'key':x.get('image',{}).get('assetKey','image.map') if x.get('image') else 'image.map','role':'image','required':True,'label':'Map / diagram image',
         'mimeTypes':LISTENING_IMAGE,'maxBytes':20*1024*1024,'usedBy':'content.image'})
    return result


# The Listening v1 package is a BARE stored package, not a v2 envelope.
# Import framework's upgradeListeningPackage(v1) validates it before building
# a canonical v2 envelope and never accepts authored executable runtimes.
legacy_v1_schema=ob({'schemaVersion':n(min=1,max=1,integer=True),'testId':s(pattern=r'[a-z0-9-]{1,80}'),
 'title':s(trim=True,min=1,max=200),'category':s(enum=['full']),
 'provenance':s(trim=True,min=1,max=12000),
 'audio':ob({'path':s(max=200),'durationSec':n(min=.00000001,max=7200)}),
 'imagePath':nullable(s(max=200)),
 'mapDiagram':opt(spec('any')),'sections':ar(section,min=1,max=4),
 'questions':ar(question,min=0,max=40),
 'keyword1':ar(ob({**clip['fields'],'text':s(min=1,max=12000,trim=True)}),max=200),
 'keyword2':ar(keyword2,max=40),'vocabulary':ar(listening_vocab,max=40),
 'collection':opt(s(enum=['essential','academic','general','question_types','mcq'])),
 'programme':opt(ob({'ref':s(pattern=r'[a-z0-9][a-z0-9-]{0,79}'),'day':n(min=1,max=400,integer=True)},strict=True)),
 'studyPack':opt(study),'legacyRuntime':opt(b()),'authoredRuntime':opt(spec('any'))})

def upgrade_bare_v1(raw):
    issues=[]
    old=parse(raw,legacy_v1_schema,issues=issues)
    if issues or raw.get('authoredRuntime'):
        return None
    # Validate the stored-package domain before attributing source identity.
    c={k:old[k] for k in ('collection','programme','audio','imagePath','mapDiagram','sections',
        'questions','keyword1','keyword2','vocabulary','studyPack') if k in old}
    c.setdefault('collection','academic')
    c['audio']={'durationSec':old['audio']['durationSec'], 'assetKey':'audio.full','path':old['audio']['path']}
    c['image']={'assetKey':'image.map'} if old['imagePath'] else None
    c.setdefault('keyword1',[]);c.setdefault('keyword2',[]);c.setdefault('vocabulary',[])
    p={'module':'listening','contentType':'full_test','sourceRef':old['testId'],'content':c}
    if any(i['blocking'] for i in listening_issues(p)):
        return None
    assets=[{'key':'audio.full','role':'audio','mimeTypes':LISTENING_AUDIO,'path':old['audio']['path']}]
    if old['imagePath']:
        assets.append({'key':'image.map','role':'image','mimeTypes':LISTENING_IMAGE,'path':old['imagePath']})
    envelope={'schemaVersion':2,'module':'listening','contentType':'full_test','sourceRef':old['testId'],
        'title':old['title'],'language':'en','provenance':{'source':'legacy_conversion',
         'note':old['provenance'] or 'Upgraded from a version 1 Listening payload.'},
        'publication':{'state':'draft'},'assets':assets,'content':c}
    return envelope

def parse_package(raw):
    if not isinstance(raw,dict):raise InvalidPackage('invalid_input',[issue(1,'invalid_input','The package must be a JSON object.')])
    migrated_from=None
    if 'module' not in raw:
        if not isinstance(raw.get('schemaVersion'),int) or isinstance(raw.get('schemaVersion'),bool):
            raise InvalidPackage('schema_invalid',[issue(1,'schema_invalid','Missing `schemaVersion`. This is not a Learners Area content package.')])
        upgraded=upgrade_bare_v1(raw) if raw['schemaVersion']==1 else None
        if upgraded is None:
            raise InvalidPackage('invalid_input',[issue(1,'invalid_input','The file has no `module` field and does not match any supported package format. Add `module`, `contentType` and `schemaVersion`.')])
        raw=upgraded;migrated_from=1
    # Exact Zod preprocessing: authoring aliases are converted before leaf parsing.
    raw=copy.deepcopy(raw)
    if raw.get('module')=='listening' and isinstance(raw.get('content'),dict):
        for q in raw['content'].get('questions',[]) if isinstance(raw['content'].get('questions'),list) else []:
            if not isinstance(q,dict):continue
            if 'key' not in q and 'answer' in q:q['key']=q['answer']
            if 'kind' not in q and 'type' in q:q['kind']=q['type']
            q.pop('answer',None);q.pop('type',None)
            if isinstance(q.get('evidence'),dict):
                ev=q['evidence']
                if 'at' not in ev and 'timestamp' in ev:ev['at']=ev['timestamp']
                ev.pop('timestamp',None)
    issues=[];pkg=parse(raw,envelope,issues=issues)
    if issues:raise InvalidPackage('schema_invalid',issues)
    module=pkg['module'];typ=pkg['contentType'];version=pkg['schemaVersion']
    if (module,typ) not in (('listening','full_test'),('reading','general_set')):
        raise InvalidPackage('unknown_content_type',[issue(1,'unknown_content_type',f'No importer is registered for {module}:{typ}.','contentType')])
    expected=2 if module=='listening' else 1
    if version!=expected:
        raise InvalidPackage('unsupported_schema_version',[issue(1,'unsupported_schema_version',f'schemaVersion {version} is not supported for {module}:{typ} (supported: {", ".join(map(str,sorted([1,expected])))}).','schemaVersion')])
    problems=[];content=parse(pkg['content'],listening_content if module=='listening' else reading_content,'',problems)
    if problems:raise InvalidPackage('schema_invalid',problems)
    pkg['content']=content;problems=[];warnings=[]
    keys=[]
    for declared in pkg['assets']:
        if declared['key'] in keys:problems.append(issue(1,'duplicate_asset',f'Asset key "{declared["key"]}" is declared more than once.','assets'))
        keys.append(declared['key'])
    problems.extend(listening_issues(pkg) if module=='listening' else reading_issues(pkg))
    problems.extend(executable(content))
    declared={a['key']:a for a in pkg['assets']}
    for r in requirements(pkg):
        a=declared.get(r['key'])
        if not a:problems.append(issue(3,'asset_missing',f'Asset "{r["key"]}" is required by the content but not declared in "assets".','assets'))
        elif a['role']!=r['role']:problems.append(issue(3,'asset_mime_invalid',f'Asset "{r["key"]}" is declared as {a["role"]} but the content uses it as {r["role"]}.','assets'))
    digest=package_hash(pkg)
    if pkg.get('contentHash') and pkg['contentHash']!=digest:problems.append(issue(1,'content_hash_mismatch',f'The declared contentHash does not match the package content (canonical hash: {digest}).','contentHash'))
    blockers=[p for p in problems if p['blocking']];warnings=[p for p in problems if not p['blocking']]
    if blockers:raise InvalidPackage(blockers[0]['code'],blockers+warnings)
    if migrated_from is not None:pkg['_migratedFrom']=migrated_from
    return pkg,warnings
