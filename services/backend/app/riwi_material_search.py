"""Bounded title resolution over the same actor-scoped material selectors.

Queries and conversation text never grant access or choose a SQL identifier.
Unclear matches ask for a name instead of guessing a learner's source.
"""
from __future__ import annotations
import json
import re
from .riwi_contracts import UUID_RE
from .riwi_uzbek import normalize_query
from .riwi_materials import KINDS, _base, gate, validate_reference

MODULES = {
    'reading': r'reading|oqish',
    'listening': r'listening|tinglash',
    'writing': r'writing|insho|essay',
    'speaking': r'speaking|gapirish',
    'language-stealing': r'language stealing|pattern|qolip',
    'retention': r'retention',
    'podcast': r'podcast|podkast|ted',
}
STOP = frozenset(('a an the this that these those of in on at to from for with and or how what why '
 'explain help please me my show give study source passage article transcript text model answer '
 'reading listening writing speaking retention podcast podkast ted language stealing pattern '
 'matn matnni matndagi maqola maqolani maqoladagi transkript transkriptni namuna javob javobni javobini '
 'bilan uchun haqida menga men meni shu shuni shunga buni bunga qaysi nima qanday nega tushuntir '
 'tushuntirish tushuntiring izohla izohlab soddaroq sodda misol uchta yana ber bering qilib qil '
 'yordam boyicha mavzu mavzuni testlar masala savol savolni tahlil tarjima oqish tinglash gapirish').split())
CONTROL_WORD = re.compile(r'(?:reading|listening|writing|speaking|retention|podcast|podkast|matn|maqola|transkript|javob|namuna)'
                          r'(?:lari|larini|laridagi|dagi|dan|ni|ning|ga|ini|si|sini|lar)?$')


def terms(message):
    return list(dict.fromkeys(w for w in normalize_query(message).split()
               if w not in STOP and not CONTROL_WORD.fullmatch(w)
               and (len(w)>=3 or w.isdigit() or re.fullmatch('[abc][12]',w))))[:10]


def query_scope(message):
    q=normalize_query(message)
    kinds=[k for k,pattern in MODULES.items() if re.search(r'\b(?:'+pattern+r')(?:dagi|dan|ni|ning|ga)?\b',q)]
    specific=bool(re.search(r'\b(matn\w*|maqola\w*|passage|article|transkript\w*|transcript|model answer|namuna|nomli|titled)\b',q))
    quoted=bool(re.search(r'["“][^"”]{3,160}["”]',message))
    numeric=bool(re.search(r'\b(?:reading|listening)\s*(?:test\s*)?\d{1,3}\b',q))
    if not kinds and re.search(r'\b(transkript\w*|transcript)\b',q):kinds=['listening','podcast']
    return kinds,specific or quoted or numeric


async def previous_context(conn,actor,conversation_id):
    if not conversation_id or not UUID_RE.fullmatch(conversation_id):return {}
    row=await conn.fetchrow('''SELECT m.metadata FROM riwi_conversation_messages m
      JOIN riwi_conversations c ON c.id=m.conversation_id
      WHERE c.id=$1::uuid AND c.user_id=$2::uuid AND c.role_at_creation=$3::role
      AND c.deleted_at IS NULL AND c.expires_at>now() AND m.role='assistant'
      AND m.created_at>=now()-interval '30 days'
      ORDER BY m.created_at DESC,m.id DESC LIMIT 1''',conversation_id,actor.id,actor.role)
    data=row.get('metadata') if row else None
    if isinstance(data,str):
        try:data=json.loads(data)
        except ValueError:return {}
    provider=data.get('provider',{}) if isinstance(data,dict) else {}
    return provider if isinstance(provider,dict) else {}


async def resolve_material(conn,actor,message,conversation_id=None):
    from .riwi_understanding import text_request
    if text_request(message):return None
    if conn is None or not hasattr(conn,'fetch') or not hasattr(conn,'fetchrow'):return None
    from .riwi_curriculum import choose_entry as curriculum, is_followup
    from .riwi_study_library import choose_entry as guide
    kinds,explicit=query_scope(message)
    study=guide(message)
    known=curriculum(message) or study
    if known and (not explicit or study and not kinds):return None
    previous=await previous_context(conn,actor,conversation_id) if conversation_id else {}
    contextual=bool(re.search(r'\b(shu|shuni|buni|this|that|same|matndagi|matnni|maqoladagi|transkriptdagi)\b',normalize_query(message)))
    named=bool(re.search(r'["“][^"”]{3,160}["”]',message)) or bool(kinds and not contextual)
    if previous.get('model')=='riwi-material-v1' and previous.get('material') and not named and (contextual or is_followup(message)):
        try:return validate_reference(previous['material'])
        except ValueError:pass
    pending=previous.get('materialSearchKinds',[]) if previous.get('model')=='riwi-material-resolution-v1' else []
    if not kinds and not known and isinstance(pending,list):
        kinds=[k for k in pending if k in KINDS]
    query=terms(message)
    if not kinds and explicit:kinds=list(KINDS)
    if not kinds or not query:return {'clarification':'name','kinds':kinds} if explicit or pending else None
    # Bare general module questions remain available to the normal tutor.
    if not explicit and not pending and len(query)<2:return None
    candidates=[];overflow=False
    for kind in kinds:
        try:await gate(conn,actor,kind)
        except PermissionError as exc:
            if str(exc)=='forbidden' and len(kinds)>1:continue
            raise
        rows=await conn.fetch(_base(kind)+'''SELECT id::text,title FROM material
          WHERE coalesce(text,'') ~ '[^[:space:]]' AND EXISTS(
            SELECT 1 FROM unnest($3::text[]) token WHERE strpos(lower(title),token)>0)
          ORDER BY title,id LIMIT 61''',actor.id,actor.role,query)
        overflow |= len(rows)>60
        for row in rows[:60]:
            title_terms=set(terms(str(row['title'])))
            hits=len(set(query)&title_terms)
            covered=bool(title_terms) and title_terms<=set(query)
            if hits>=2 or covered and hits==1:
                candidates.append((hits*2+4*covered,kind,str(row['id'])))
    candidates.sort(reverse=True)
    if not overflow and candidates and (len(candidates)==1 or candidates[0][0]>candidates[1][0]):
        return {'kind':candidates[0][1],'id':candidates[0][2]}
    return {'clarification':'ambiguous' if candidates or overflow else 'name','kinds':kinds}


def clarification(reason,locale):
    if reason=='active_exam_lookup_forbidden':
        return ('Faol test yoki eslab qolish mashqi davomida shu materialdan yordam bera olmayman. Avval mashqni yakunlang; keyin birga tahlil qilamiz.' if locale=='uz' else
                'I cannot look up this material during an active test or recall task. Finish it first, then we can review it together.')
    if reason=='forbidden':
        return ('Bu material bo‘yicha ko‘rish ruxsatingiz tasdiqlanmadi. O‘zingizga ochiq mashq nomini yozing.' if locale=='uz' else
                'I could not verify your access to that material. Name a practice item available to your account.')
    return ('Qaysi matn yoki mashqni nazarda tutyapsiz? Nomini aniqroq yoki undan bitta jumlani yozing — mos bo‘lmagan materialni taxmin qilib tanlamayman 🙂' if locale=='uz' else
            'Which text or practice item do you mean? Give its title or one sentence so I can identify it accurately 🙂')
