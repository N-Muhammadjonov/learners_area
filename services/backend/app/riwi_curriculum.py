"""Owner-authorized original lessons, activated through knowledge governance.

This is a teaching library, not a neural language model or validated examiner.
"""
from __future__ import annotations
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
import unicodedata

VERSION="riwi-original-curriculum-v1"
MODEL_PREFIX="riwi-curriculum-v1:"
SOURCE_TITLE="RIWI Original Learning Library v1"
SOURCE_PROVENANCE=("Original assistant-authored English/Uzbek explanations, examples and practice, "
                   "prepared under the Owner's 2 November 2026 instruction. No copied course text, "
                   "parameter-training claim, or independent examiner band labels.")

def normalize(text):
    from .riwi_uzbek import normalize_query
    return normalize_query(text)

def unit_text(entry):
    return json.dumps({"id":entry["id"],"en":entry["explanationEn"],"uz":entry["explanationUz"],
                       "example":entry["example"],"pitfall":entry["pitfall"],"practice":entry["practice"]},
                      ensure_ascii=False,separators=(",",":"))

@lru_cache(maxsize=1)
def library():
    path=Path(__file__).resolve().parents[1]/"contracts/riwi_original_curriculum_v1.json"
    pack=json.loads(path.read_text(encoding="utf-8"))
    if pack.get("schemaVersion")!=1 or pack.get("version")!=VERSION:
        raise ValueError("invalid_curriculum_version")
    entries=pack.get("entries")
    if not isinstance(entries,list) or not 1<=len(entries)<=150:
        raise ValueError("invalid_curriculum_entries")
    result={}
    for entry in entries:
        if not isinstance(entry,dict) or not re.fullmatch(r"[a-z0-9._-]{3,90}",entry.get("id","")):
            raise ValueError("invalid_curriculum_entry")
        if entry["id"] in result or not isinstance(entry.get("aliases"),list) or not entry["aliases"]:
            raise ValueError("invalid_curriculum_entry")
        for key in ("title","explanationEn","explanationUz","example","pitfall","practice"):
            if not isinstance(entry.get(key),str) or not entry[key].strip():
                raise ValueError("invalid_curriculum_text")
        if any(not isinstance(alias,str) or not normalize(alias) for alias in entry["aliases"]):
            raise ValueError("invalid_curriculum_alias")
        if len(unit_text(entry))>1200:
            raise ValueError("curriculum_unit_too_large")
        result[entry["id"]]=entry
    return result

@lru_cache(maxsize=1)
def library_texts():
    return frozenset(unit_text(entry) for entry in library().values())

def is_library_text(text):
    if not isinstance(text,str):return False
    from .riwi_grammar_reference import is_reference_text
    if is_reference_text(text):return True
    from .riwi_study_library import is_study_text
    if is_study_text(text):return True
    if text in library_texts():return True
    # Supplementary structured lessons must never leak as raw JSON through
    # generic keyword retrieval when their topic was not selected.
    # Generic retrieval truncates snippets. Parsing the entire JSON would fail
    # open for a clipped lesson and expose its raw internal representation.
    identifier=re.match(r'^\{\s*"id"\s*:\s*"([^"]+)"',text)
    if identifier and identifier.group(1) in library():return True
    if text.startswith('{"id":'):
        try:
            item=json.loads(text)
            return item.get('id') in library() and ('examples' in item or 'example' in item)
        except (ValueError,AttributeError):pass
    return False

def source_content():
    return "\n\n".join("# "+entry["id"]+" | "+entry["title"]+"\n\n"+unit_text(entry)
                       for entry in library().values())

def source_checksum():
    return hashlib.sha256(source_content().encode("utf-8")).hexdigest()

def installation_payload():
    return {"sourceType":"course_document","title":SOURCE_TITLE,"provenance":SOURCE_PROVENANCE,
            "rightsClass":"internal_permission","scope":{"kind":"global"},"content":source_content()}

def is_followup(message):
    query=normalize(message)
    if len(query)>220:return False
    if query in ('yana','davom et','tushunmadim','soddaroq','batafsil','oddiyroq','qanday qilib','nega bunday boldi',
                 'boshqa yoli bormi','keyingisini ber','oxirgi gapingni qaytar','tushunmadim yana ayt','qisqaroq ayta olasanmi'):return True
    if re.search(r'\b(oldingi|yuqoridagi|javobing\w*|shu joyini)\b',query) and re.search(r'\b(qisqartir\w*|sodda\w*|misol\w*|kengaytir\w*|takror\w*|qaytar\w*)\b',query):return True
    return bool(
        re.search(r"\b(example|examples|practice|misol|mashq|simpler|shorter|soddaroq|qisqaroq)\b",query)
        and (re.search(r"\b(this|that|it|another|again|shu|shunga|bunga|buni|yana|mavzu|topic)\b",query)
             or len(query.split())<=7)) or bool(re.search(r'\b(tushunmadim|soddaroq|oddiyroq|batafsil)\b',query))

EXTRA_ALIASES={
 'grammar.quantifiers':('few and a few','few va a few','few vs a few','a little and little','much and many','few nima'),
 'grammar.linking':('although','because','therefore'),
 'grammar.modals':('must not','do not have to','should nima'),
 'grammar.present-simple':('oddiy hozirgi zamon',),
 'grammar.past-simple-vs-present-perfect':('past simple present perfect farq',),
 'grammar.passive':('passive','majhul nisbat'),
 'grammar.articles':('artikl','artikllar'),
 'grammar.subject-verb-agreement':('ega va kesim mosligi','ega fel mosligi'),
 'vocabulary.collocation':('collocations','soz birikmasi','birikmalar'),
 'reading.tfng':('true false va not given','true false ng'),
}

def choose_entry(message):
    query=" "+normalize(message)+" "
    candidates=[]
    matches=[]
    tasks={"grammar.error_correction","grammar.transformation","grammar.fill_gap",
           "grammar.controlled_production","grammar.free_production","grammar.explanation","grammar.retention"}
    for entry in library().values():
        score=0
        for alias in (*entry["aliases"],*EXTRA_ALIASES.get(entry['id'],())):
            phrase=normalize(alias)
            spans=list(re.finditer(r"(?<!\w)"+re.escape(phrase)+r"(?!\w)",query))
            if spans:
                weight=len(phrase.split())*10+min(len(phrase),90)/100
                if entry["id"].startswith("grammar.") and entry["id"] not in tasks:
                    weight+=10
                score=max(score,weight)
                matches.extend((m.start(),m.end(),entry["id"]) for m in spans)
        if score:
            candidates.append((score,entry["id"]))
    # "Explain simply" describes how to answer, not a competing subject.
    # Keep the explicit subject even when the presentation alias is longer.
    presentation={'tutoring.simple_explanation','tutoring.compare_concepts'}
    specific=[candidate for candidate in candidates if candidate[1] not in presentation]
    candidates=specific or candidates
    candidates.sort(reverse=True)
    # Nested names belong to the longer topic (present perfect continuous is
    # not a second request for present perfect). Disjoint grammar topics need
    # their comparison lesson or an open tutoring response, not an arbitrary
    # winner based on the length of a topic name.
    topics={key for start,end,key in matches
            if key.startswith("grammar.") and key not in tasks and
            not any(a<=start and end<=b and (a<start or end<b) and other!=key
                    for a,b,other in matches)}
    if topics=={"grammar.past-simple","grammar.present-perfect"}:
        return "grammar.past-simple-vs-present-perfect"
    if len(topics)>1:
        return None
    if not candidates or (len(candidates)>1 and abs(candidates[0][0]-candidates[1][0])<0.001):
        return None
    return candidates[0][1]

async def previous_lesson_context(conn,actor,conversation_id):
    from .riwi_contracts import UUID_RE
    if not isinstance(conversation_id,str) or not UUID_RE.fullmatch(conversation_id):
        return None
    row=await conn.fetchrow("""
        SELECT m.metadata FROM riwi_conversation_messages m
        JOIN riwi_conversations c ON c.id=m.conversation_id
        WHERE c.id=$1::uuid AND c.user_id=$2::uuid AND c.role_at_creation=$3::role
          AND c.deleted_at IS NULL AND c.expires_at>now() AND m.role='assistant'
          AND m.created_at>=now()-interval '30 days'
        ORDER BY m.created_at DESC,m.id DESC LIMIT 1
        """,conversation_id,actor.id,actor.role)
    if not row:
        return None
    metadata=row["metadata"]
    if isinstance(metadata,str):
        try:metadata=json.loads(metadata)
        except ValueError:return None
    if not isinstance(metadata,dict):
        return None
    provider=metadata.get("provider")
    if not isinstance(provider,dict) or provider.get("id")!="riwi":
        return None
    model=provider.get("model")
    if not isinstance(model,str) or not model.startswith(MODEL_PREFIX):
        return None
    key=model[len(MODEL_PREFIX):]
    if key not in library():return None
    variant=provider.get('lessonVariant',0)
    aliases=provider.get('queryAliases',[])
    return {'key':key,'variant':variant if type(variant) is int and 0<=variant<=1000000 else 0,
            'aliases':[x for x in aliases if isinstance(x,str) and 5<=len(x)<=300][:3] if isinstance(aliases,list) else []}

async def previous_topic(conn,actor,conversation_id):
    context=await previous_lesson_context(conn,actor,conversation_id)
    return context['key'] if context else None

async def retrieve_lesson(conn,actor,message,conversation_id=None,*,topic_key=None):
    from .riwi_capabilities import authorize_capability
    if conn is None or not hasattr(conn,"fetchrow") or not authorize_capability(actor,"riwi.knowledge.read_approved").allowed:
        return None
    key=topic_key if topic_key in library() else choose_entry(message)
    previous=await previous_lesson_context(conn,actor,conversation_id) if conversation_id else None
    if key is None and previous and (is_followup(message) or normalize(message) in previous['aliases']):key=previous['key']
    if key is None:
        return None
    entry=library()[key]
    content=unit_text(entry)
    row=await conn.fetchrow("""
        SELECT s.id::text AS source_id,s.title,s.authority,s.version,
               u.id::text AS unit_id,u.content
        FROM riwi_knowledge_sources s JOIN riwi_knowledge_units u ON u.source_id=s.id
        WHERE s.source_type='course_document' AND s.state='active' AND s.checksum=$1
          AND u.content_hash=$2 AND
          (s.scope='global' OR (s.scope='role' AND s.scope_role=$3::role)
           OR (s.scope='user' AND s.scope_user_id=$4::uuid))
        ORDER BY s.version DESC,u.ordinal ASC LIMIT 1
        """,source_checksum(),hashlib.sha256(content.encode("utf-8")).hexdigest(),actor.role,actor.id)
    if not row or row["content"]!=content:
        return None
    from .riwi_teaching_details import retrieve_details
    supplement=await retrieve_details(conn,actor,key)
    return {"ref":"K1","sourceId":row["source_id"],"unitId":row["unit_id"],"title":entry["title"],
            "text":content,"authority":int(row["authority"]),"version":int(row["version"]),
            "curriculumId":key,'supplement':supplement,
            'lessonVariant':previous['variant']+1 if previous and previous['key']==key else 0,
            'queryAliases':previous['aliases'] if previous and previous['key']==key else []}

def format_lesson(unit,message,locale):
    key=unit.get("curriculumId")
    entry=library().get(key)
    if entry is None or unit.get("text")!=unit_text(entry):
        return None
    from .riwi_teaching_details import format_details
    expanded=format_details(unit,message,locale,entry,unit.get('lessonVariant',0))
    if expanded:return expanded
    uz=locale=="uz"
    practice=entry["practice"].split(". ",1)
    practice_text=practice[-1] if uz and len(practice)==2 else practice[0]+("." if len(practice)==2 else "")
    example_only=is_followup(message) and bool(re.search(r"\b(example|examples|misol)\b",normalize(message)))
    lines=[entry["title"]]
    if not example_only:
        lines.append(entry["explanationUz"] if uz else entry["explanationEn"])
    lines.append(("Misol: " if uz else "Example: ")+entry["example"])
    if not uz and not example_only:
        lines.append("Check: "+entry["pitfall"])
    lines.append(("Mashq: " if uz else "Practice: ")+practice_text)
    return "\n\n".join(lines)[:5500]
