"""Governed original study guides for the Owner's supplied references.

Publisher PDFs stay local. Only original teaching notes/examples are packaged.
Every answer requires the exact current source checksum and unit hash to be
active under normal knowledge governance. Shared rules are stored once.
"""
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re

VERSION = 'riwi-study-library-v1'
MODEL_PREFIX = 'riwi-study-v1:'
SOURCE_TITLES = {'guardian':'RIWI Original Guardian Study Notes v1',
                 'cambridge':'RIWI Original Cambridge Grammar Study Notes v1'}
PROVENANCE = ('Original assistant-authored study notes and examples, aligned to Owner-supplied historical '
              'Guardian/Macmillan lessons and Cambridge Grammar for IELTS (2007). Reference hashes, pages and '
              'levels are recorded. Internal permission covers these original notes only; publisher rights '
              'are not transferred. No copied articles, book exercises, answer keys, external AI or neural training.')


def encode(value): return json.dumps(value,ensure_ascii=False,separators=(',',':'))
def digest(text): return hashlib.sha256(text.encode('utf-8')).hexdigest()
def fingerprint(value): return ':'.join(value[i:i+8] for i in range(0,len(value),8))


@lru_cache(maxsize=1)
def library():
    path = Path(__file__).resolve().parents[1]/'contracts/riwi_study_library_v1.json'
    pack = json.loads(path.read_text(encoding='utf-8'))
    if pack.get('schemaVersion')!=1 or pack.get('version')!=VERSION:
        raise ValueError('invalid_study_library')
    entries={}
    for e in pack['entries']:
        key=e.get('id')
        if not isinstance(key,str) or not re.fullmatch(r'study\.(guardian|cambridge)\.[a-z0-9.-]+',key) or key in entries:
            raise ValueError('invalid_study_entry')
        for field in ('title','explanationUz','explanationEn','tipUz','tipEn','practiceUz','practiceEn'):
            if not isinstance(e.get(field),str) or not e[field].strip():raise ValueError('invalid_study_text')
        if len(e.get('examples',[]))<6 or len({x['en'] for x in e['examples']})!=len(e['examples']):
            raise ValueError('invalid_study_examples')
        if any(not all(isinstance(x.get(k),str) and x[k].strip() for k in ('en','uz')) for x in e['examples']):
            raise ValueError('invalid_study_examples')
        source=e.get('source',{})
        if source.get('publisherTextRedistributed') is not False or not re.fullmatch('[0-9a-f]{64}',source.get('sha256','')):
            raise ValueError('invalid_study_provenance')
        if not source.get('pages') or not all(type(n) is int and n>0 for n in source['pages']):
            raise ValueError('invalid_study_pages')
        entries[key]=e
    if len(entries)!=175:raise ValueError('incomplete_study_library')
    return entries


def compact_entry(entry):
    if entry['id'].startswith('study.cambridge.'):return entry
    return {'id':entry['id'],'focusUz':entry['explanationUz'].split('\n\n')[0],
            'examples':entry['examples'],'pages':entry['source']['pages'],
            'sourceTextFingerprint':fingerprint(entry['source']['sourceTextSha256'])}


@lru_cache(maxsize=2)
def source_records(kind):
    records=[]
    entries=[e for key,e in library().items() if key.startswith('study.'+kind+'.')]
    if kind=='guardian':
        for level in ('elementary','pre-intermediate','intermediate','advanced'):
            sample=next(e for e in entries if e['level']==level)
            records.append({'id':'study.guardian.rules.'+level,'level':level,
              'explanationUz':sample['explanationUz'].split('\n\n',1)[1],
              **{k:sample[k] for k in ('explanationEn','tipUz','tipEn','practiceUz','practiceEn')},
              'reference':{**{k:sample['source'][k] for k in ('book','historical','publisherTextRedistributed')},
                           'sha256Fingerprint':fingerprint(sample['source']['sha256'])}})
    records += [compact_entry(e) for e in entries]
    if not records or len(records)>160 or any(len(encode(r))>4000 for r in records):
        raise ValueError('invalid_study_source')
    return records


@lru_cache(maxsize=2)
def source_content(kind):
    if kind not in SOURCE_TITLES:raise ValueError('invalid_study_source')
    content='\n\n'.join('# '+r['id']+'\n\n'+encode(r) for r in source_records(kind))
    if len(content)>200000:raise ValueError('study_source_too_large')
    return content


def source_checksum(kind): return digest(source_content(kind))
def unit_text(entry): return encode(compact_entry(entry))


def installation_payload(kind):
    return {'sourceType':'course_document','title':SOURCE_TITLES[kind],'provenance':PROVENANCE,
            'rightsClass':'internal_permission','scope':{'kind':'global'},'content':source_content(kind)}


def structured_units(content):
    if not content.startswith('# study.'):return None
    for kind in SOURCE_TITLES:
        if content==source_content(kind):
            return [{'ordinal':i,'heading':r['id'],'text':encode(r),'characterCount':len(encode(r))}
                    for i,r in enumerate(source_records(kind))]
    return None


def is_study_text(text):
    match=re.match(r'^\{\s*"id"\s*:\s*"(study\.(?:guardian|cambridge)\.[^"]+)"',text or '')
    return bool(match and (match[1] in library() or match[1].startswith('study.guardian.rules.')))


def choose_entry(message):
    from .riwi_uzbek import normalize_query
    query=' '+normalize_query(message)+' '
    levels=set()
    level_query=query
    if ' pre intermediate ' in level_query:
        levels.add('pre-intermediate');level_query=level_query.replace(' pre intermediate ',' ')
    levels.update(name for name in ('elementary','intermediate','advanced')
                  if re.search(r'(?<!\w)'+re.escape(name)+r'(?!\w)',level_query))
    for number,name in ((1,'elementary'),(2,'intermediate'),(3,'advanced')):
        if re.search(r'\blevel\s*'+str(number)+r'\b',query):levels.add(name)
    if len(levels)>1:return None
    wanted=next(iter(levels),None)
    matches={}
    for key,e in library().items():
        score=max((len(normalize_query(a)) for a in e['aliases'] if
                   re.search(r'(?<!\w)'+re.escape(normalize_query(a))+r'(?!\w)',query)),default=0)
        if score:matches[e['group']]=max(matches.get(e['group'],0),score)
    ordered=sorted(matches.items(),key=lambda x:-x[1])
    if not ordered or len(ordered)>1:return None
    group=ordered[0][0]
    entries=[e for e in library().values() if e['group']==group]
    if group.startswith('cambridge.'):return entries[0]['id']
    if wanted:
        if wanted=='elementary' and len(entries)==3 and not any(e['level']=='elementary' for e in entries):
            wanted='pre-intermediate'
        return next((e['id'] for e in entries if e['level']==wanted),None)
    return next((e['id'] for e in entries if e['level'] in ('elementary','pre-intermediate')),None)


async def retrieve_lesson(conn,actor,message,conversation_id=None):
    from .riwi_capabilities import authorize_capability
    from .riwi_contracts import UUID_RE
    from .riwi_curriculum import is_followup
    if conn is None or not hasattr(conn,'fetchrow') or not authorize_capability(actor,'riwi.knowledge.read_approved').allowed:return None
    key=choose_entry(message);variant=0
    if conversation_id and UUID_RE.fullmatch(conversation_id) and (key or is_followup(message)):
        row=await conn.fetchrow('''SELECT m.metadata FROM riwi_conversation_messages m
          JOIN riwi_conversations c ON c.id=m.conversation_id
          WHERE c.id=$1::uuid AND c.user_id=$2::uuid AND c.role_at_creation=$3::role
          AND c.deleted_at IS NULL AND c.expires_at>now() AND m.role='assistant'
          AND m.created_at>now()-interval '7 days'
          ORDER BY m.created_at DESC,m.id DESC LIMIT 1''',conversation_id,actor.id,actor.role)
        metadata=row.get('metadata') if row else None
        if isinstance(metadata,str):
            try:metadata=json.loads(metadata)
            except ValueError:metadata=None
        provider=metadata.get('provider',{}) if isinstance(metadata,dict) else {}
        previous=provider.get('model','') if isinstance(provider,dict) else ''
        if isinstance(previous,str) and previous.startswith(MODEL_PREFIX):
            previous=previous[len(MODEL_PREFIX):]
            if previous in library() and (key==previous or not key and is_followup(message)):
                key=previous
                prior=provider.get('lessonVariant',0)
                variant=(prior if type(prior) is int and 0<=prior<1000000 else 0)+1
    if not key:return None
    entry=library()[key];kind=key.split('.')[1];content=unit_text(entry)
    row=await conn.fetchrow('''SELECT s.id::text AS source_id,u.id::text AS unit_id,s.authority,s.version,u.content
      FROM riwi_knowledge_sources s JOIN riwi_knowledge_units u ON u.source_id=s.id
      WHERE s.state='active' AND s.source_type='course_document' AND s.checksum=$1 AND u.content_hash=$2
      AND (s.scope='global' OR (s.scope='role' AND s.scope_role=$3::role) OR (s.scope='user' AND s.scope_user_id=$4::uuid))
      ORDER BY s.version DESC LIMIT 1''',source_checksum(kind),digest(content),actor.role,actor.id)
    if not row or row.get('content')!=content:return None
    return {'ref':'K3','sourceId':row['source_id'],'unitId':row['unit_id'],'title':entry['title'],
            'authority':row['authority'],'version':int(row['version']),'text':content,
            'studyId':key,'lessonVariant':variant}


def format_lesson(unit,message,locale):
    from .riwi_curriculum import is_followup
    from .riwi_uzbek import normalize_query
    entry=library()[unit['studyId']];uz=locale=='uz';variant=unit.get('lessonVariant',0)
    query=normalize_query(message)
    simpler=bool(re.search(r'\b(soddaroq|oddiyroq|tushunmadim|simpler|simply|shorter)\b',query))
    examples_only=variant>0 and not simpler and is_followup(message) and bool(re.search(r'\b(example|examples|misol)\b',query))
    intros=('Keling, shu mavzuni birga ko‘rib chiqamiz 🙂','Endi boshqa misollar bilan mashq qilamiz 🙂','Yana bir qadam oldinga o‘tamiz 👇') if uz else (
            'Let’s study this topic together 🙂','Let’s practise with different examples 🙂','Let’s take the next step 👇')
    chosen=entry['examples'][3*(variant%2):3*(variant%2)+3]
    # Bibliographic identity stays in governed metadata, outside learner prose.
    title=entry['title'].split(': ',1)[-1] if entry['id'].startswith('study.cambridge.') else entry['title']
    explanation=entry['explanationUz' if uz else 'explanationEn']
    lines=[('Bitta qoidadan boshlab, qadam-baqadam ko‘ramiz 🙂' if uz else 'Let’s take one rule at a time 🙂') if simpler else intros[variant%3],'📘 '+title]
    if simpler:
        # Change the presentation without dropping qualifications or inventing
        # an unapproved paraphrase. Each step is an intact approved sentence.
        parts=[p.strip() for p in re.split(r'(?<=[.!?])\s+|\n+',explanation) if p.strip()]
        lines.append('\n'.join((f'{i+1}-qadam: ' if uz else f'Step {i+1}: ')+part for i,part in enumerate(parts)))
    elif not examples_only:
        lines.append(explanation)
    lines.extend([('🧩 3 ta misol:' if uz else '🧩 Three examples:')+'\n'+
           '\n'.join(f'{i+1}) {x["en"]}'+('\n   — '+x['uz'] if uz else '') for i,x in enumerate(chosen)),
           '✍️ '+entry['practiceUz' if uz else 'practiceEn']])
    if entry['source'].get('historical'):
        lines.append('⏳ Bu tarixiy matn. Undagi raqam, mansabdor, qonun yoki tibbiy da’voni bugungi fakt deb olmang.' if uz else
                     '⏳ This is a historical text. Its figures, officeholders, laws and medical claims are not verified current facts.')
    answer='\n\n'.join(lines)
    if len(answer)>5500:raise ValueError('study_answer_too_long')
    return answer
