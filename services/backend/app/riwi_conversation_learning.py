"""Private review candidates and conversation-local clarification, never auto-truth."""
import hashlib
import json
import logging
import re
import uuid
from .riwi_contracts import UUID_RE
from .riwi_outbound_guard import redact_external_text,contains_secret_material
from .riwi_uzbek import normalize_query

LOG=logging.getLogger(__name__)
NAMESPACE=uuid.UUID('6f671776-ef72-41ce-bd5b-bf1511376af8')


def safe_question(message):
    q=normalize_query(message)
    # Capture only short educational requests, excluding personal narratives,
    # contacts, credentials and URLs rather than pretending to recognise all PII.
    if not 5<=len(message)<=300 or contains_secret_material(message):return None
    if re.search(r'\b(?:parol\w*|token\w*|secret\w*|passport|pasport\w*|telefon\w*|email\w*|manzil\w*|ismim|kasallig\w*|tashxis\w*|baho\w*|natija\w*|balim|ballim|hisobot\w*)\b',q):return None
    if re.search(r'https?://|www\.|@|\d{5,}',message,re.I):return None
    if re.search(r'\b(?:mening|my|our|oilam|manzilim|akam|ukam|singlim|medical)\b',q):return None
    allowed_caps={'Grammar','Reading','Listening','Writing','Speaking','English','Uzbek','Tarjima','Translate','What','How','Why','Nima','Qanday'}
    if any(word not in allowed_caps for word in re.findall(r'\b[A-Z][a-z]{2,}\b',message)):return None
    if not re.search(r'\b(?:grammar|grammatika|soz\w*|word|meaning|tarjima\w*|translate|tense|zamon\w*|qoid\w*|reading|listening|writing|speaking|lugat\w*|nima degani)\b',q):return None
    clean=redact_external_text(message,300)
    if clean!=message:return None
    return normalize_query(clean)


PAIR_SQL='''SELECT u.content AS question,a.metadata FROM riwi_conversation_messages a
  JOIN riwi_conversations c ON c.id=a.conversation_id
  JOIN riwi_conversation_messages u ON u.conversation_id=a.conversation_id AND u.role='user'
    AND u.metadata->>'correlationId'=a.metadata->>'correlationId'
  WHERE c.id=$1::uuid AND c.user_id=$2::uuid AND c.role_at_creation=$3::role
    AND c.deleted_at IS NULL AND c.expires_at>now() AND a.role='assistant'
    AND a.created_at>=now()-interval '30 days'
  ORDER BY a.created_at DESC,a.id DESC LIMIT 1'''


async def attach_clarification_alias(conn,actor,conversation_id,message,provider):
    if not (conn is not None and hasattr(conn,'fetchrow') and conversation_id and UUID_RE.fullmatch(conversation_id)):
        return provider
    if not provider.get('model','').startswith('riwi-curriculum-v1:'):return provider
    if not re.search(r'\b(?:nazarda|demoqchi|demokchi|i mean|i meant)\b',normalize_query(message)):return provider
    row=await conn.fetchrow(PAIR_SQL,conversation_id,actor.id,actor.role)
    if not row:return provider
    meta=row.get('metadata',{})
    if isinstance(meta,str):
        try:meta=json.loads(meta)
        except ValueError:return provider
    if not isinstance(meta,dict) or meta.get('provenance')!='unavailable':return provider
    prior=meta.get('provider',{})
    if not isinstance(prior,dict) or prior.get('model') not in ('deterministic-v1','riwi-understanding-v1'):return provider
    alias=safe_question(row.get('question',''))
    if not alias:return provider
    # The association means only "this learner meant this topic in this chat".
    # A recognised explicit topic always wins over an alias during retrieval.
    return {**provider,'queryAliases':list(dict.fromkeys([*provider.get('queryAliases',[]),alias]))[-3:]}


async def capture_unknown_question(conn,actor,conversation_id,message):
    question=safe_question(message)
    if not question or conn is None or not hasattr(conn,'fetchrow') or not UUID_RE.fullmatch(conversation_id or ''):return None
    source=str(uuid.uuid5(NAMESPACE,actor.id+':'+question))
    claim='Unanswered learning question (unverified, not a factual claim): '+question
    evidence='gateway unknown; assistant answer and full transcript omitted; private review candidate; never auto-promote'
    digest=hashlib.sha256(json.dumps([claim,evidence],separators=(',',':')).encode()).hexdigest()
    # One atomic statement verifies current identity, conversation ownership and
    # expiry, uses the existing partial unique index, and never writes knowledge.
    row=await conn.fetchrow('''WITH eligible AS (
      SELECT u.id FROM users u JOIN riwi_conversations c ON c.user_id=u.id
      WHERE u.id=$1::uuid AND u.role=$2::role AND u.account_status='active'
        AND c.id=$3::uuid AND c.role_at_creation=u.role AND c.deleted_at IS NULL AND c.expires_at>now()
        AND ($2::text<>'student' OR NOT (
          EXISTS(SELECT 1 FROM reading_attempts WHERE user_id=u.id AND status='in_progress') OR
          EXISTS(SELECT 1 FROM listening_attempts WHERE user_id=u.id AND status='in_progress') OR
          EXISTS(SELECT 1 FROM retention_attempts WHERE user_id=u.id AND status IN ('reading','recall'))))
        AND (SELECT count(*) FROM riwi_learning_signals s WHERE s.actor_user_id=u.id
          AND s.model='riwi-private-question-v1' AND s.created_at>now()-interval '1 day')<20
    ), inserted AS (
      INSERT INTO riwi_learning_signals(id,signal_type,state,actor_user_id,actor_role,target_user_id,source_id,
          model,candidate_claim,evidence_summary,evidence_hash,scope)
      SELECT $4::uuid,'retrieval_failure','candidate',id,$2::role,id,$5::uuid,
          'riwi-private-question-v1',$6,$7,$8,'user' FROM eligible
      ON CONFLICT(actor_user_id,signal_type,source_id) WHERE actor_user_id IS NOT NULL AND source_id IS NOT NULL DO NOTHING
      RETURNING id::text,state::text
    ) SELECT id,state,true AS created FROM inserted UNION ALL
      SELECT s.id::text,s.state::text,false AS created FROM riwi_learning_signals s JOIN eligible e ON e.id=s.actor_user_id
      WHERE s.actor_user_id=$1::uuid AND s.signal_type='retrieval_failure' AND s.source_id=$5::uuid LIMIT 1''',
      actor.id,actor.role,conversation_id,str(uuid.uuid4()),source,claim,evidence,digest)
    if not row:return None
    if row.get('created'):
        from .riwi_audit import record_riwi_audit
        await record_riwi_audit(conn,actor_user_id=actor.id,action='riwi.learning.signal.created',
            target_type='riwi_learning_signal',target_id=row['id'],metadata={'status':'candidate','scope':'user','producer':'gateway','rawTranscript':'omitted'})
    return {'recorded':True,'state':row['state'],'scope':'user'}


async def capture_safely(conn,actor,conversation_id,message):
    try:return await capture_unknown_question(conn,actor,conversation_id,message)
    except Exception as exc:
        # A review-queue outage must not turn an already-saved chat into a failed
        # send. Log the error class only: no text, identifiers or exception data.
        LOG.warning('RIWI private review capture unavailable: %s',type(exc).__name__)
        return {'recorded':False}
