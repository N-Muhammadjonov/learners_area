"""Private, evidence-bounded language learning, without an external model.

Only explicit learner mappings and confirmed clarification pairs can be kept.
Targets are reviewed control words, social intents or currently active lessons.
Raw answers, documents, personal facts and permissions are never learned here.
"""
from datetime import datetime,timezone
import hashlib
import json
import re
import uuid

from .riwi_uzbek import normalize_query
from .riwi_retention import retention_transaction

MODEL='riwi-private-language-v1'
POLICY='private-reviewed-language-v1'
NAMESPACE=uuid.UUID('cbbd3a97-009e-445e-96ee-e451d025cd70')
MAX_ALIASES=256
SOCIAL_IDS=frozenset(('identity','presence','wellbeing','greeting','thanks-bye'))
CONTROLS=frozenset(('tushuntir','tushunmadim','tushunmayman','bilmayman','soddaroq','batafsil',
    'misol ber','tarjima qil','nima','nega','qanday','farq','men','sen','siz'))
BLOCKED=re.compile(r'parol|password|token|secret|cookie|credential|passport|pasport|telefon|email|manzil|ismim|kasal|tashxis|baho|natija|ballim|bahom|owner|admin|teacher|ruxsat|permission|system|prompt|api|kalit|imtihon|mock|javob kalit',re.I)
QUOTED=re.compile(r'''^\s*(?:men\s+)?[«“"']([^»”"'\n]{2,80})[»”"']\s*(?:deganda|deganim|deb\s+yozsam|aslida)\s*,?\s*[«“"']([^»”"'\n]{2,80})[»”"']\s*(?:degani|demoqchiman|deb\s+tushun|nazarda\s+tutaman)?(?:\s*[,.;].{0,100})?[.!]?\s*$''',re.I)
PLAIN=re.compile(r'^\s*(.{2,80}?)\s+deganim\s+(.{2,80}?)\s+degani[.!]?\s*$',re.I)


def decode(value):
    if isinstance(value,dict):return value
    if isinstance(value,str):
        try:
            data=json.loads(value);return data if isinstance(data,dict) else {}
        except ValueError:pass
    return {}


def phrase(value):
    if not isinstance(value,str) or not 2<=len(value)<=80 or len(value.split())>8:return None
    from .riwi_outbound_guard import contains_secret_material
    if BLOCKED.search(value) or contains_secret_material(value) or re.search(r'https?://|www\.|@|\d|[/\\<>={}]',value,re.I):return None
    if re.search(r'\b(?:mening|my|our|ismim|ismi|oilam|akam|ukam|singlim|dadam|onam|uyim|address|phone|medical)\b',value,re.I):return None
    if not re.fullmatch(r"[\w\s‘’ʻʼ'`?.!,-]+",value,re.UNICODE):return None
    result=normalize_query(value)
    return result if 2<=len(result)<=80 else None


def parse_mapping(message):
    if not isinstance(message,str) or len(message)>300:return None
    match=QUOTED.fullmatch(message) or PLAIN.fullmatch(message)
    if not match:return None
    alias,canonical=(phrase(x.strip()) for x in match.groups())
    return {'alias':alias,'canonical':canonical} if alias and canonical else {'rejected':True}


def source_id(alias):return str(uuid.uuid5(NAMESPACE,alias))


async def canonical_target(conn,actor,canonical):
    """A topic name is allowed; an unverified assertion about that topic is not."""
    from .riwi_questions import match_question
    from .riwi_curriculum import library,choose_entry,EXTRA_ALIASES,retrieve_lesson
    if canonical in CONTROLS:return {'kind':'control','id':canonical}
    entry=match_question(canonical)
    if entry and entry.get('decision')=='answer' and entry.get('responseId') in SOCIAL_IDS:
        return {'kind':'social','id':entry['responseId']}
    # New mappings may point only to exact reviewed intents, never a nearest
    # keyword guess, answer body, role claim or arbitrary user-supplied fact.
    from .riwi_dialogues import indexes as dialogue_indexes
    dialogue = dialogue_indexes()[1].get(normalize_query(canonical))
    if dialogue:return {'kind':'dialogue','id':dialogue['id']}
    from .riwi_help import indexes as help_indexes, permitted
    workflow = help_indexes()[0].get(normalize_query(canonical))
    if workflow and permitted(actor,workflow):return {'kind':'workflow','id':workflow['id']}
    from .riwi_new_questions import exact_index,allowed
    questions = exact_index().get(normalize_query(canonical),[])
    if questions and len({q['id'] for q in questions})==1 and allowed(actor,questions[0]):
        return {'kind':'faq','id':questions[0]['id']}
    topic=entry.get('lessonId') if entry and entry.get('decision')=='answer' else choose_entry(canonical)
    if not topic or topic not in library():return None
    aliases=[normalize_query(x) for x in (*library()[topic]['aliases'],*EXTRA_ALIASES.get(topic,()))]
    exact=canonical in aliases or any(re.fullmatch(re.escape(x)+r' (?:tushuntir|qoidasi|nima)',canonical) for x in aliases)
    if not exact and not (entry and entry.get('lessonId')==topic and not entry.get('semanticMatch')):return None
    if conn is None or not hasattr(conn,'fetchrow'):return None
    lesson=await retrieve_lesson(conn,actor,canonical,None,topic_key=topic)
    return {'kind':'lesson','id':topic} if lesson else None


async def proposal_for_message(conn,actor,message,conversation_id=None):
    mapping=parse_mapping(message)
    if mapping is None and conversation_id:
        match=re.fullmatch(r'\s*(?:men\s+)?(.{2,80}?)\s+(?:demoqchiman|nazarda tutdim)[.!]?\s*',message,re.I)
        if match and phrase(match[1]) and conn is not None and hasattr(conn,'fetchrow'):
            from .riwi_conversation_learning import PAIR_SQL
            row=await conn.fetchrow(PAIR_SQL,conversation_id,actor.id,actor.role)
            if row and decode(row.get('metadata')).get('provenance')=='unavailable':
                alias=phrase(row.get('question',''))
                if alias:mapping={'alias':alias,'canonical':phrase(match[1])}
    if mapping is None:return None
    if mapping.get('rejected'):return {'rejected':True}
    target=await canonical_target(conn,actor,mapping['canonical'])
    if not target:return {'rejected':True}
    # Existing reviewed language cannot be remapped to a conflicting intent.
    known=await canonical_target(conn,actor,mapping['alias'])
    if known and known!=target:return {'rejected':True}
    return {**mapping,'target':target,'alreadyKnown':known==target}


async def learn_proposal(conn,actor,proposal,*,now=None,origin='explicit_correction',observed_at=None):
    if not proposal or proposal.get('rejected'):return {'saved':False,'reason':'unverified'}
    if proposal.get('alreadyKnown'):return {'saved':False,'reason':'already_known'}
    if conn is None or not hasattr(conn,'fetchrow'):return {'saved':False,'reason':'unavailable'}
    current=now or datetime.now(timezone.utc)
    async with retention_transaction(conn) as active:
        eligible=await active.fetchrow('''SELECT u.id::text AS id FROM users u
            WHERE u.id=$1::uuid AND u.role=$2::role AND u.account_status='active'
              AND ($2::text<>'student' OR NOT (
                EXISTS(SELECT 1 FROM reading_attempts WHERE user_id=u.id AND status='in_progress') OR
                EXISTS(SELECT 1 FROM listening_attempts WHERE user_id=u.id AND status='in_progress') OR
                EXISTS(SELECT 1 FROM retention_attempts WHERE user_id=u.id AND status IN ('reading','recall'))))
            FOR UPDATE OF u''',actor.id,actor.role)
        if not eligible:return {'saved':False,'reason':'not_eligible'}
        # Recheck target activation inside the same short transaction.
        if await canonical_target(active,actor,proposal['canonical'])!=proposal['target']:return {'saved':False,'reason':'unverified'}
        key=source_id(proposal['alias'])
        old=await active.fetchrow('''SELECT id::text,candidate_claim,evidence_summary,evidence_hash FROM riwi_learning_signals
            WHERE actor_user_id=$1::uuid AND target_user_id=$1::uuid AND source_id=$2::uuid
              AND signal_type='user_feedback' AND model=$3 AND scope='user' AND state='accepted' FOR UPDATE''',actor.id,key,MODEL)
        prior=decode(old.get('candidate_claim')) if old else {}
        previous_summary=decode(old.get('evidence_summary')) if old else {}
        # Retirement reviews older writing; it must never undo a later correction.
        if old and origin=='retiring_chat':
            try:
                prior_at=datetime.fromisoformat(previous_summary.get('observedAt') or previous_summary['updatedAt'])
                if not isinstance(observed_at,datetime) or prior_at>=observed_at:
                    return {'saved':False,'reason':'newer_interpretation'}
            except (KeyError,TypeError,ValueError):
                return {'saved':False,'reason':'newer_interpretation'}
        if prior.get('target')==proposal['target'] and prior.get('alias')==proposal['alias']:
            return {'saved':True,'changed':False,'revision':prior.get('revision',1)}
        if not old:
            count=await active.fetchrow('''SELECT count(*)::int AS total FROM riwi_learning_signals
                WHERE actor_user_id=$1::uuid AND model=$2 AND scope='user' AND state='accepted' ''',actor.id,MODEL)
            if count and int(count.get('total',0))>=MAX_ALIASES:return {'saved':False,'reason':'capacity'}
        revision=max(0,int(prior.get('revision',0)))+1
        payload={'version':1,'alias':proposal['alias'],'canonical':proposal['canonical'],'target':proposal['target'],'revision':revision}
        history=previous_summary.get('history',[]) if isinstance(previous_summary.get('history'),list) else []
        if prior:history=[*history,{'revision':prior.get('revision',1),'target':prior.get('target'),
            'hash':old.get('evidence_hash'),'at':current.isoformat()}][-3:]
        summary={'policy':POLICY,'origin':origin,'updatedAt':current.isoformat(),
            'observedAt':(observed_at or current).isoformat(),'history':history}
        claim=json.dumps(payload,ensure_ascii=False,separators=(',',':'))
        digest=hashlib.sha256(claim.encode()).hexdigest()
        saved=await active.fetchrow('''INSERT INTO riwi_learning_signals(id,signal_type,state,actor_user_id,actor_role,target_user_id,
              source_id,model,candidate_claim,evidence_summary,evidence_hash,scope,created_at)
            VALUES($1::uuid,'user_feedback','accepted',$2::uuid,$3::role,$2::uuid,$4::uuid,$5,$6,$7,$8,'user',$9::timestamptz)
            ON CONFLICT(actor_user_id,signal_type,source_id) WHERE actor_user_id IS NOT NULL AND source_id IS NOT NULL
            DO UPDATE SET candidate_claim=EXCLUDED.candidate_claim,evidence_summary=EXCLUDED.evidence_summary,
              evidence_hash=EXCLUDED.evidence_hash,actor_role=EXCLUDED.actor_role
            WHERE riwi_learning_signals.model=EXCLUDED.model AND riwi_learning_signals.scope='user'
              AND riwi_learning_signals.target_user_id=EXCLUDED.target_user_id AND riwi_learning_signals.state='accepted'
            RETURNING id::text''',old['id'] if old else str(uuid.uuid4()),actor.id,actor.role,key,MODEL,claim,
            json.dumps(summary,ensure_ascii=False,separators=(',',':')),digest,current)
        if not saved:return {'saved':False,'reason':'conflict'}
        from .riwi_audit import record_riwi_audit
        await record_riwi_audit(active,actor_user_id=actor.id,action='riwi.language_memory.corrected' if old else 'riwi.language_memory.learned',
            target_type='riwi_learning_signal',target_id=saved['id'],metadata={'role':actor.role,'status':'accepted','version':revision,'contentHash':digest,'model':MODEL})
        return {'saved':True,'changed':True,'revision':revision}


def learning_ack(proposal,result,locale):
    uz=locale=='uz'
    if result.get('reason')=='already_known':return 'Tushundim 🙂 Bu yozuv shaklini allaqachon taniyman.' if uz else 'Understood 🙂 I already recognize that wording.'
    if not result.get('saved'):
        return ('Bu talqinni ishonchli til qoidasi yoki faol dars bilan bog‘lab, xotirada saqlay olmadim. Qaysi ma’noni nazarda tutganingizni aniqroq yozing; tekshirilmagan faktni qoida deb olmayman.' if uz else
            'I could not save that interpretation as a verified language mapping. Clarify the intended meaning; unverified facts do not become rules.')
    if result.get('changed') is False:return 'Bu talqin xotirada bor 🙂 Keyingi suhbatlarda ham shu ma’noda tushunaman.' if uz else 'That interpretation is already remembered 🙂 I can use it in future chats too.'
    alias,canonical=proposal['alias'],proposal['canonical']
    if result.get('revision',1)>1:
        return (f'Tuzatdim 🙂 Siz «{alias}» deganda «{canonical}»ni nazarda tutasiz. Eski talqin o‘rniga shuni ishlataman.' if uz else
            f'Corrected 🙂 For you, “{alias}” means “{canonical}”. I will use this interpretation instead of the previous one.')
    return (f'Eslab qoldim 🙂 Siz «{alias}» deganda «{canonical}»ni nazarda tutasiz. Keyingi suhbatlarda ham shu talqindan foydalanaman.' if uz else
        f'Remembered 🙂 For you, “{alias}” means “{canonical}”. I can use this interpretation in future chats too.')


async def resolve_private_language(conn,actor,message):
    from .riwi_understanding import text_request
    from .riwi_internal_tutor import correction_request
    if conn is None or not hasattr(conn,'fetch') or text_request(message) or correction_request(message):return None
    rows=await conn.fetch('''SELECT s.candidate_claim FROM riwi_learning_signals s JOIN users u ON u.id=s.actor_user_id
        WHERE s.actor_user_id=$1::uuid AND s.target_user_id=$1::uuid AND s.model=$2 AND s.scope='user' AND s.state='accepted'
          AND u.role=$3::role AND u.account_status='active' ORDER BY s.created_at DESC,s.id DESC LIMIT 256''',actor.id,MODEL,actor.role)
    q=normalize_query(message);spans=[]
    for row in rows:
        payload=decode(row.get('candidate_claim'));alias=payload.get('alias');canonical=payload.get('canonical');target=payload.get('target')
        if payload.get('version')!=1 or phrase(alias)!=alias or phrase(canonical)!=canonical or not isinstance(target,dict):continue
        if target.get('kind') in ('social','lesson','dialogue','workflow','faq'):
            if alias==q and await canonical_target(conn,actor,canonical)==target:
                known=await canonical_target(conn,actor,alias)
                if not known or known==target:return canonical
        elif target.get('kind')=='control' and target.get('id') in CONTROLS and canonical==target['id']:
            if alias in CONTROLS and alias!=canonical:continue
            for match in re.finditer(r'(?<!\w)'+re.escape(alias)+r'(?!\w)',q):spans.append((match.start(),match.end(),canonical))
    selected=[]
    for start,end,value in sorted(spans,key=lambda x:(-(x[1]-x[0]),x[0])):
        if not any(start<b and a<end for a,b,_ in selected):selected.append((start,end,value))
        if len(selected)==4:break
    mapped=q
    for start,end,value in sorted(selected,reverse=True):mapped=mapped[:start]+value+mapped[end:]
    if mapped==q:return None
    from .riwi_contracts import assess_riwi_intent
    return mapped if not assess_riwi_intent(mapped).is_adversarial else None


async def review_retiring_conversations(conn,actor,current,conversation_id=None):
    """Catch up on explicit useful language before retired raw chats are deleted."""
    if conn is None or not hasattr(conn,'fetch'):return {'selected':0,'saved':0}
    rows=await conn.fetch('''SELECT m.content,m.created_at FROM riwi_conversation_messages m JOIN riwi_conversations c ON c.id=m.conversation_id
        WHERE c.user_id=$1::uuid AND c.role_at_creation=$2::role AND c.deleted_at IS NULL AND c.expires_at>$3::timestamptz
          AND ($4::uuid IS NULL OR c.id=$4::uuid) AND m.role='user' AND char_length(m.content)<=300
          AND NOT EXISTS(SELECT 1 FROM riwi_conversation_messages first WHERE first.conversation_id=c.id
            AND first.metadata ? 'riwiLearningReviewedAt')
          AND EXISTS(SELECT 1 FROM riwi_conversation_messages a WHERE a.conversation_id=c.id AND a.role='assistant'
            AND a.metadata->>'correlationId'=m.metadata->>'correlationId'
            AND a.metadata->'provider'->>'id'='riwi' AND a.metadata->'provider'->>'model' NOT IN ('riwi-document-v1','riwi-material-v1','riwi-material-resolution-v1')
            AND a.metadata->>'provenance' IN ('unavailable','deterministic_learning_data','approved_knowledge'))
        ORDER BY m.created_at DESC,m.id DESC LIMIT 200''',actor.id,actor.role,current,conversation_id)
    count=selected=0;seen=set()
    for row in rows:
        message=row.get('content')
        if not isinstance(message,str) or parse_mapping(message) is None:continue
        proposal=await proposal_for_message(conn,actor,message)
        if not proposal or proposal.get('rejected') or proposal.get('alias') in seen:continue
        seen.add(proposal['alias']);selected+=1
        result=await learn_proposal(conn,actor,proposal,now=current,origin='retiring_chat',observed_at=row.get('created_at'))
        count+=bool(result.get('saved'))
        if selected==20:break
    return {'selected':selected,'saved':count}
