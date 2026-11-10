"""Governed teaching cards from the Owner-supplied original grammar document."""
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
from .riwi_uzbek import normalize_query

VERSION='riwi-grammar-reference-v1'
MODEL_PREFIX='riwi-reference-v1:'
KINDS=('foundation','development','extension')
PROVENANCE=('Teaching rules adapted from the Owner-supplied original grammar document; '
 '580 additional bilingual examples and English explanations authored for RIWI. '
 'Document hash and paragraphs retained internally. No external AI, neural training, '
 'certified CEFR level or IELTS band guarantee. The supplied binary is not redistributed.')

def encode(value):return json.dumps(value,ensure_ascii=False,separators=(',',':'))
def digest(value):return hashlib.sha256(value.encode()).hexdigest()

@lru_cache(maxsize=1)
def pack():
    data=json.loads((Path(__file__).resolve().parents[1]/'contracts/riwi_grammar_reference_v1.json').read_text())
    if data.get('version')!=VERSION or len(data.get('entries',[]))!=290:raise ValueError('invalid_grammar_reference')
    for e in data['entries']:
        if len(e.get('examples',[]))!=3 or len({x['en'] for x in e['examples']})!=3:raise ValueError('invalid_reference_examples')
        for field in ('title','explanationUz','explanationEn','pattern','tipUz'):
            if not isinstance(e.get(field),str) or not e[field].strip():raise ValueError('invalid_reference_text')
        if len(encode(e))>4000:raise ValueError('reference_unit_too_large')
    return data

@lru_cache(maxsize=1)
def library():return {e['id']:e for e in pack()['entries']}

@lru_cache(maxsize=3)
def records(kind):
    if kind not in KINDS:raise ValueError('invalid_reference_pack')
    index=KINDS.index(kind);all_rows=[*pack()['entries'],*pack()['support']]
    result=all_rows[index*110:(index+1)*110]
    if any(len(encode(r))>4000 for r in result):raise ValueError('reference_unit_too_large')
    return result

@lru_cache(maxsize=3)
def source_content(kind):
    content='\n\n'.join('# '+e['id']+'\n\n'+encode(e) for e in records(kind))
    if len(content)>200000:raise ValueError('reference_source_too_large')
    return content

def source_checksum(kind):return digest(source_content(kind))
def installation_payload(kind):
    return {'sourceType':'course_document','title':'RIWI Grammar Reference — '+kind,
      'provenance':PROVENANCE,'rightsClass':'internal_permission','scope':{'kind':'global'},'content':source_content(kind)}

def structured_units(content):
    if not content.startswith('# grammar.reference.'):return None
    for kind in KINDS:
        if content==source_content(kind):
            return [{'ordinal':i,'heading':e['id'],'text':encode(e),'characterCount':len(encode(e))} for i,e in enumerate(records(kind))]
    return None

def is_reference_text(text):return bool(re.match(r'^\{\s*"id"\s*:\s*"grammar\.reference\.',text or ''))

@lru_cache(maxsize=1)
def alias_index():
    result=[]
    for key,e in library().items():
        aliases=[normalize_query(a) for a in e['aliases']]
        result.append((key,[(len(a.split())*10+len(a)/100,re.compile(r'(?<!\w)'+re.escape(a)+r'(?!\w)')) for a in aliases if len(a)>=5]))
    return result

def choose_entry(message):
    query=' '+normalize_query(message)+' ';matches=[]
    for key,aliases in alias_index():
        score=max((score for score,pattern in aliases if pattern.search(query)),default=0)
        if score:matches.append((score,key))
    matches.sort(reverse=True)
    if not matches or len(matches)>1 and matches[0][0]==matches[1][0]:return None
    return matches[0][1]


async def previous_context(conn,actor,conversation_id):
    from .riwi_material_search import previous_context as owned_context
    provider=await owned_context(conn,actor,conversation_id)
    model=provider.get('model','')
    if provider.get('id')!='riwi' or not isinstance(model,str) or not model.startswith(MODEL_PREFIX):return None
    key=model[len(MODEL_PREFIX):]
    if key not in library():return None
    return {'key':key,'variant':provider.get('lessonVariant',0) if type(provider.get('lessonVariant',0)) is int else 0,
      'aliases':[x for x in provider.get('queryAliases',[]) if isinstance(x,str) and 5<=len(x)<=300][:3] if isinstance(provider.get('queryAliases',[]),list) else []}


async def read_record(conn,actor,key):
    from .riwi_capabilities import authorize_capability
    if conn is None or not hasattr(conn,'fetchrow') or not authorize_capability(actor,'riwi.knowledge.read_approved').allowed:return None
    for kind in KINDS:
        entry=next((r for r in records(kind) if r['id']==key),None)
        if entry:break
    if not entry:return None
    text=encode(entry)
    row=await conn.fetchrow('''SELECT s.id::text source_id,s.authority,s.version,u.id::text unit_id,u.content
      FROM riwi_knowledge_sources s JOIN riwi_knowledge_units u ON u.source_id=s.id
      WHERE s.state='active' AND s.source_type='course_document' AND s.checksum=$1 AND u.content_hash=$2
      AND (s.scope='global' OR s.scope='role' AND s.scope_role=$3::role OR s.scope='user' AND s.scope_user_id=$4::uuid)
      ORDER BY s.version DESC,u.ordinal LIMIT 1''',source_checksum(kind),digest(text),actor.role,actor.id)
    if not row or row['content']!=text:return None
    return {'ref':'G1','sourceId':row['source_id'],'unitId':row['unit_id'],'authority':int(row['authority']),
      'version':int(row['version']),'title':entry.get('title','Grammar practice'),'text':text,'entry':entry}


async def retrieve_lesson(conn,actor,message,conversation_id=None,*,key=None):
    if conn is None or not hasattr(conn,'fetchrow'):return None
    from .riwi_curriculum import is_followup,choose_entry as core
    selected=key or choose_entry(message)
    previous=await previous_context(conn,actor,conversation_id) if conversation_id else None
    if not selected and previous and (is_followup(message) or normalize_query(message) in previous['aliases']):selected=previous['key']
    if not selected:return None
    # Keep the already expanded core lessons for broad familiar subjects.
    # Specific advanced constructions can use this reference directly.
    core_topic=core(message)
    if not key and core_topic and core_topic not in ('grammar.explanation','grammar.error_correction','tutoring.simple_explanation','tutoring.compare_concepts'):
        return None
    unit=await read_record(conn,actor,selected)
    if not unit:return None
    return {**unit,'referenceId':selected,'lessonVariant':previous['variant']+1 if previous and previous['key']==selected else 0,
      'queryAliases':previous['aliases'] if previous and previous['key']==selected else []}


def format_lesson(unit,message,locale):
    e=unit['entry'];uz=locale=='uz';variant=unit.get('lessonVariant',0)
    starts=('Keling, tuzilmani bosqichma-bosqich ko‘ramiz 🙂','Endi ma’no va shaklni solishtiramiz 👇','Shu qoidani gapda ishlatib ko‘ramiz 🙂') if uz else (
      'Let’s work through the pattern 🙂','Compare the meaning and form 👇','Let’s use the rule in a sentence 🙂')
    lines=[starts[variant%3],'📘 '+e['title'],e['explanationUz' if uz else 'explanationEn'],
      ('Tuzilma: ' if uz else 'Pattern: ')+e['pattern']]
    practice=bool(re.search(r'\b(mashq\w*|exercise\w*|quiz)\b',normalize_query(message)))
    examples=e['examples'][variant%3:]+e['examples'][:variant%3]
    if practice:
        lines.append('✍️ Uch gapni inglizchaga o‘giring. Avval o‘zingiz urinib ko‘ring; keyin model bilan solishtiramiz.' if uz else
                     '✍️ Translate these three prompts into English, using the pattern. Try before asking for the model answers.')
        lines.extend(f'{i}) {x["uz"]}' for i,x in enumerate(examples,1))
    else:
        lines.append('🧩 3 ta misol:' if uz else '🧩 Three examples:')
        lines.extend(f'{i}) {x["en"]}'+('\n— '+x['uz'] if uz else '') for i,x in enumerate(examples,1))
        lines.append(('💡 E’tibor: '+e['tipUz']) if uz else '💡 Compare the rule and the pattern before changing a verb form or word order.')
        lines.append('✍️ Endi shu tuzilma bilan o‘z hayotingizdan bitta gap yozing. Qaysi ma’noni nazarda tutganingizni ham ayting.' if uz else
                     '✍️ Write one personal example with this pattern and explain the meaning you intend.')
    return '\n\n'.join(lines)[:5800]


@lru_cache(maxsize=1)
def example_index():
    index={}
    for key,e in library().items():
        for x in e['examples']:
            index.setdefault(sentence_key(x['en']),[]).append((key,x,'uz'))
            index.setdefault(sentence_key(x['uz']),[]).append((key,x,'en'))
    return index


async def translate_example(conn,actor,value):
    matches=example_index().get(sentence_key(value),[])
    if not matches:return None
    key,example,target=matches[0]
    unit=await read_record(conn,actor,key)
    if not unit:return None
    return {'translation':example[target],'unit':unit,'target':target}


def sentence_key(value):
    import unicodedata
    value=unicodedata.normalize('NFKC',value).casefold().translate(str.maketrans('','',"'‘’ʻʼ`´"))
    return ' '.join(re.findall(r'[^\W_]+',value))


async def correction_example(conn,actor,check):
    if not check or check.get('reasons'):return check
    for support in pack()['support']:
        if support.get('kind')!='error_patterns':continue
        for wrong,right,why in support['rows']:
            if normalize_query(wrong)!=normalize_query(check['original']):continue
            if not await read_record(conn,actor,support['id']):return check
            return {**check,'corrected':right.split(' / ')[0],
              'reasons':[{'uz':why,'en':'Compare the corrected form with the governing grammar pattern.'}],
              'topic':'grammar.error_correction'}
    return check


TERM_EN={
 'subject':'the clause element typically identifying who or what the clause is about',
 'predicate':'the part of a clause making a predication about its subject',
 'object':'a complement selected by a verb, often an affected or perceived participant',
 'complement':'an element selected to complete a grammatical construction',
 'adjunct':'an added circumstance such as time, place or manner',
 'clause':'a unit organised around a predication, finite or non-finite',
 'main clause':'a clause that is not subordinate within the construction',
 'subordinate clause':'a clause functioning as a dependent part of a larger construction',
 'finite':'a verb form anchored for tense or grammatical agreement',
 'non-finite':'an infinitival, gerund-participial or participial form without its own finite anchoring',
 'aspect':'the grammatical viewpoint on a situation, such as progression or prior relevance',
 'tense':'a grammatical time distinction, separate from all the times a sentence can refer to',
 'voice':'the construction relating grammatical roles to participants, such as active and passive',
 'mood':'grammatical distinctions related to modality or the status of a proposition',
 'determiner':'an expression specifying a noun phrase’s reference or quantity',
 'quantifier':'an expression indicating quantity or the extent of a set',
 'referent':'the person, thing or idea an expression refers to',
 'antecedent':'an expression supplying the interpretation of a later dependent reference',
 'register':'language choices suited to a situation, audience or purpose',
 'hedging':'expressing a claim with commitment proportionate to the evidence',
 'inversion':'a departure from an ordinary order, such as auxiliary before subject',
 'ellipsis':'omission of material recoverable from context',
}


async def lookup_term(conn,actor,term,locale):
    match=next((r for r in pack()['support'] if r.get('kind')=='terminology'),None)
    row=next((r for r in match['rows'] if normalize_query(r[0])==normalize_query(term)),None) if match else None
    if not row or not await read_record(conn,actor,match['id']):return None
    meaning=row[1] if locale=='uz' else TERM_EN.get(row[0],row[1])
    return {'resolved':True,'summary':row[0]+': '+meaning,'provenance':'deterministic_learning_data'}


async def answer_support(conn,actor,message,locale):
    q=normalize_query(message);uz=locale=='uz'
    if re.search(r'\b(?:12\s+(?:ta\s+)?(?:zamon|tense)|zamon(?:lar)?\s+jadval\w*|tense\s+(?:aspect\s+)?table)\b',q):
        support=next(r for r in pack()['support'] if r['kind']=='tense_map')
        unit=await read_record(conn,actor,support['id'])
        if not unit:return None
        intro=('Bu 12 ta o‘quv shakli jadvali: tense, aspect va kelajak ifodalari birga beriladi. Buni ingliz tilida morfologik jihatdan aynan 12 zamon bor degan qat’iy da’vo deb olmang.' if uz else
               'This teaching table combines twelve tense-aspect and future constructions; it is not a claim that English has twelve morphological tenses.')
        lines=[intro,*[f'{r[0]}: {r[1]} | {r[2]} | {r[3]}' for r in support['rows']]]
    else:
        found=[]
        for support in pack()['support']:
            if support.get('kind')!='verb_forms':continue
            for row in support['rows']:
                base=row[0].split(' ')[0]
                if re.search(r'\b'+re.escape(base)+r'(?:ning|ni)?\s+(?:felining\s+)?(?:v[123]|uch\s+shakl\w*|shakllari)',q) or re.search(r'\b(?:forms? of|v[123] of)\s+'+re.escape(base)+r'\b',q):
                    found.append((support,row))
        if len(found)!=1:return None
        support,row=found[0];unit=await read_record(conn,actor,support['id'])
        if not unit:return None
        lines=[('Fe’l shakllari 🙂' if uz else 'Verb forms 🙂'),
               row[0]+(' — '+row[3] if uz else ''),f'V1: {row[0]}\nV2: {row[1]}\nV3: {row[2]}',
               'V2 o‘tgan zamon darak gapida, V3 esa have/has/had yoki tegishli passive tuzilmasida ishlatiladi.' if uz else
               'V2 is used in past-simple statements; V3 is the past participle used in perfect or appropriate passive constructions.']
        if row[0].startswith('lie'):
            lines.append('Bu yotmoq ma’nosi. Yolg‘on gapirmoq ma’nosida lie — lied — lied.' if uz else
                         'These forms mean recline. Lie meaning tell an untruth is regular: lie—lied—lied.')
    return {'answer':'\n\n'.join(lines),'provenance':'deterministic_learning_data',
      'provider':{'id':'riwi','model':'riwi-reference-support-v1'},
      'citations':[{k:unit[k] for k in ('ref','sourceId','unitId','title','authority','version')}]}
