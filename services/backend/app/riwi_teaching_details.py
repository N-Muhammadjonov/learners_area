"""Original teaching detail pack; exact active-source and unit checks precede use."""
from functools import lru_cache
import hashlib
import json
from pathlib import Path

VERSION='riwi-teaching-details-v1'
SOURCE_TITLE='RIWI Original Teaching Details v1'
SOURCE_PROVENANCE=('Original assistant-authored Uzbek explanations and 552 bilingual examples, prepared under '
 'the Owner instruction of 2 November 2026. Primary references are recorded for factual checks. '
 'No copied book passages, external AI calls, neural training or certified examiner labels.')

@lru_cache(maxsize=1)
def library():
    path=Path(__file__).resolve().parents[1]/'contracts/riwi_teaching_details_v1.json'
    pack=json.loads(path.read_text(encoding='utf-8'))
    if pack.get('schemaVersion')!=1 or pack.get('version')!=VERSION:raise ValueError('invalid_teaching_details')
    result={}
    for entry in pack['entries']:
        key=entry.get('id')
        if not isinstance(key,str) or key in result:raise ValueError('invalid_teaching_id')
        for field in ('explanationUz','tipUz','practiceUz'):
            if not isinstance(entry.get(field),str) or not entry[field].strip():raise ValueError('invalid_teaching_text')
        examples=entry.get('examples')
        if not isinstance(examples,list) or len(examples)<6:raise ValueError('insufficient_teaching_examples')
        if any(not isinstance(e,dict) or not all(isinstance(e.get(k),str) and e[k].strip() for k in ('en','uz')) for e in examples):
            raise ValueError('invalid_teaching_example')
        if len({e['en'] for e in examples})!=len(examples) or len(unit_text(entry))>4000:
            raise ValueError('invalid_teaching_unit')
        result[key]=entry
    base=json.loads((path.parent/'riwi_original_curriculum_v1.json').read_text(encoding='utf-8'))
    if set(result)!={e['id'] for e in base['entries']}:raise ValueError('incomplete_teaching_details')
    return result

def unit_text(entry):return json.dumps(entry,ensure_ascii=False,separators=(',',':'))

@lru_cache(maxsize=1)
def source_content():
    return '\n\n'.join('# '+key+' | Teaching details\n\n'+unit_text(entry) for key,entry in library().items())

def source_checksum():return hashlib.sha256(source_content().encode('utf-8')).hexdigest()

def installation_payload():
    return {'sourceType':'course_document','title':SOURCE_TITLE,'provenance':SOURCE_PROVENANCE,
            'rightsClass':'internal_permission','scope':{'kind':'global'},'content':source_content()}

def structured_units(content):
    """Only this packaged, byte-matched pack uses the schema's 4000-char units.

    General uploads retain their existing 1200-char parser. No approval or
    conflict guard is skipped by recognising this exact authored source.
    """
    if not content.startswith('# grammar.present-simple | Teaching details\n\n') or content!=source_content():return None
    return [{'ordinal':i,'heading':key+' | Teaching details','text':unit_text(e),
             'characterCount':len(unit_text(e))} for i,(key,e) in enumerate(library().items())]

async def retrieve_details(conn,actor,key):
    from .riwi_capabilities import authorize_capability
    if not authorize_capability(actor,'riwi.knowledge.read_approved').allowed:return None
    entry=library().get(key)
    if not entry or conn is None or not hasattr(conn,'fetchrow'):return None
    content=unit_text(entry)
    row=await conn.fetchrow('''
        SELECT s.id::text AS source_id,s.authority,s.version,u.id::text AS unit_id,u.content
        FROM riwi_knowledge_sources s JOIN riwi_knowledge_units u ON u.source_id=s.id
        WHERE s.source_type='course_document' AND s.state='active' AND s.checksum=$1
          AND u.content_hash=$2 AND (s.scope='global' OR (s.scope='role' AND s.scope_role=$3::role)
           OR (s.scope='user' AND s.scope_user_id=$4::uuid))
        ORDER BY s.version DESC,u.ordinal ASC LIMIT 1
        ''',source_checksum(),hashlib.sha256(content.encode('utf-8')).hexdigest(),actor.role,actor.id)
    if not row or row.get('content')!=content:return None
    return {'ref':'K2','sourceId':row['source_id'],'unitId':row['unit_id'],'title':SOURCE_TITLE,
            'text':content,'authority':int(row['authority']),'version':int(row['version']),
            'teachingDetails':entry}

def format_details(unit,message,locale,base_entry,variant=0):
    detail=unit.get('supplement')
    if not detail:return None
    entry=library().get(base_entry['id'])
    if entry is None or detail.get('text')!=unit_text(entry):return None
    from .riwi_uzbek import normalize_query
    query=normalize_query(message)
    uz=locale=='uz'
    intros=('Keling, sodda qilib ko‘rib chiqamiz 🙂','Bu safar boshqa misollar bilan tushuntiraman 🙂','Yana bir tomondan ko‘rib chiqamiz 👇') if uz else (
        'Let’s work through this together 🙂','Here are different examples to make it clearer 🙂','Let’s look at it another way 👇')
    explanation=entry['explanationUz'] if uz else base_entry['explanationEn']
    if uz and any(w in query.split() for w in ('tushunmadim','soddaroq','oddiyroq')):
        parts=explanation.split('. ')
        explanation='\n'.join(f'{i+1}-qadam: {part.rstrip(".")}.' for i,part in enumerate(parts))
    selected=entry['examples'][(variant*3)%len(entry['examples']):][:3]
    if len(selected)<3:selected+=entry['examples'][:3-len(selected)]
    lines=[intros[variant%len(intros)],'📘 '+base_entry['title'],explanation,
           '🧩 3 ta misol:' if uz else '🧩 Three examples:']
    lines.extend(f'{i+1}) {e["en"]}'+('\n   — '+e['uz'] if uz else '') for i,e in enumerate(selected))
    lines.append(('💡 Esda tuting: '+entry['tipUz']) if uz else '💡 Remember: '+base_entry['pitfall'])
    if variant%3==0:practice=entry['practiceUz'] if uz else base_entry['practice'].split('. ',1)[0]
    elif variant%3==1:practice='Yuqoridagi uch misoldan bittasini o‘zingizga moslab o‘zgartiring. Qaysi qoidani saqlaganingizni ham ayting.' if uz else 'Adapt one of these three examples to your own situation and say which rule you kept.'
    else:practice='O‘zingiz bitta yangi misol yozing. Keyin uni yuqoridagi qoida bilan tekshirib, tanlovingizni izohlang.' if uz else 'Write a new example, check it against the rule, and explain your choice.'
    lines.append(('✍️ Kichik mashq: ' if uz else '✍️ A small practice task: ')+practice)
    answer='\n\n'.join(lines)
    if len(answer)>5500:raise ValueError('teaching_answer_too_large')
    return answer
