"""Individually checked translations of Learners Area API endpoints.

Source: cb6b3cdf. No generic /api/{path} fallback, no synthetic responses:
only endpoints with translated business logic are routed here.
"""
from __future__ import annotations
import asyncio
from .admin_validation import parse as parse_admin

import math
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request

from . import main as core
from .db import row_to_dict
from .security import write_cookie

router = APIRouter()
PRIVATE = {'Cache-Control': 'private, no-store'}
_UUID = re.compile(r'^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$', re.I)
_LEX_APOS = str.maketrans({char: "'" for char in '\u2018\u2019\u02bb\u02bc`\u00b4\u2032'})
_WORD_COUNT = re.compile(r"[^\W_]+(?:['\u2019-][^\W_]+)*", re.UNICODE)


def _uuid(s: Any) -> uuid.UUID | None:
    return uuid.UUID(s) if isinstance(s, str) and _UUID.fullmatch(s) else None


def _number(v):
    """Implement z.coerce.number for JSON scalars accepted by JS Number()."""
    if isinstance(v, (dict, list)):
        if v == []: return 0.0
        if isinstance(v, list) and len(v) == 1: return _number(v[0])
        return float('nan')
    if v is None: return 0.0
    if v is True: return 1.0
    if v is False: return 0.0
    if isinstance(v, str) and not v.strip(): return 0.0
    try: return float(v)
    except (ValueError, OverflowError, TypeError): return float('nan')


def _onboarding_values(body):
    required = {'preferredLanguage', 'currentLevel', 'targetBand', 'dailyStudyMinutes',
                'strongestSkill', 'weakestSkill'}
    permitted = required | {'examDate', 'currentBand'}
    if not isinstance(body, dict) or not required <= body.keys() or body.keys() - permitted:
        return None
    if body.get('preferredLanguage') not in ('en', 'uz') or not isinstance(body.get('currentLevel'), str) or not 1 <= len(body['currentLevel']) <= 40:
        return None
    if body.get('strongestSkill') not in ('listening', 'reading', 'writing', 'speaking') or body.get('weakestSkill') not in ('listening', 'reading', 'writing', 'speaking'):
        return None
    target = _number(body['targetBand'])
    current = _number(body['currentBand']) if 'currentBand' in body else None
    study = _number(body['dailyStudyMinutes'])
    if not (math.isfinite(target) and 0 <= target <= 9 and (target * 2).is_integer()
            and (current is None or (math.isfinite(current) and 0 <= current <= 9 and (current * 2).is_integer()))
            and math.isfinite(study) and study.is_integer() and 5 <= study <= 600):
        return None
    exam = body.get('examDate')
    exam_date = None
    if 'examDate' in body and exam is not None:
        # z.string().regex + calendar-date validity
        if not isinstance(exam, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', exam): return None
        try: exam_date = datetime.strptime(exam, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        except ValueError: return None
        if exam_date.strftime('%Y-%m-%d') != exam: return None
    elif 'examDate' in body and exam is None:
        return None
    return (body['currentLevel'], current, target, exam_date, int(study),
            body['strongestSkill'], body['weakestSkill'], body['preferredLanguage'])


@router.patch('/api/profile/study')
async def study_patch(req: Request):
    # Origin is verified by main.middleware, mirroring the route's own gate.
    user = await core.current_user(req, active=True)
    if not user: return core.auth_error()
    values = _onboarding_values(await core.payload(req))
    if values is None: return core.j({'error': 'invalid_input'}, 400)
    db = await core.pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            await conn.execute('''INSERT INTO onboarding_profiles
              (user_id,current_level,current_band,target_band,exam_date,daily_study_minutes,strongest_skill,weakest_skill)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id) DO UPDATE SET
              current_level=EXCLUDED.current_level,current_band=EXCLUDED.current_band,
              target_band=EXCLUDED.target_band,exam_date=EXCLUDED.exam_date,
              daily_study_minutes=EXCLUDED.daily_study_minutes,strongest_skill=EXCLUDED.strongest_skill,
              weakest_skill=EXCLUDED.weakest_skill''', user['id'], *values[:7])
            await conn.execute('UPDATE users SET locale=$2 WHERE id=$1', user['id'], values[7])
    response = core.j({'ok': True}, headers=PRIVATE)
    write_cookie(response, req, 'la_locale', values[7], 365 * 86400)
    return response


@router.get('/api/vocabulary/summary')
async def vocabulary_summary(req: Request):
    user = await core.current_user(req, active=True)
    if not user: return core.j({'error':'unauthenticated'}, 401, PRIVATE)
    try:
        db = await core.pool()
        async with db.acquire() as conn:
            rows = await conn.fetch('''SELECT mastery,source_type,count(*)::int AS total,
             count(*) FILTER(WHERE next_review_at<=now())::int AS due,
             min(next_review_at) FILTER(WHERE next_review_at<=now()) AS next_due_at
             FROM user_vocabulary WHERE user_id=$1 GROUP BY mastery,source_type''', user['id'])
        mastery = dict.fromkeys(('new','learning','known','active','mastered'), 0)
        sources: dict[str,int] = {}
        total = due = 0
        next_due = None
        for r in rows:
            total += int(r['total']); due += int(r['due'])
            if r['mastery'] in mastery: mastery[r['mastery']] += int(r['total'])
            src = r['source_type'] if r['source_type'] is not None else 'manual'
            sources[src] = sources.get(src, 0) + int(r['total'])
            if r['next_due_at'] and (next_due is None or r['next_due_at'] < next_due): next_due = r['next_due_at']
        return core.j({'ok': True, 'summary':{'total':total,'due':due,'byMastery':mastery,'bySource':sources,
                                             'nextDueAt': row_to_dict({'value':next_due})['value']}}, headers=PRIVATE)
    except Exception:
        return core.j({'ok':False,'error':'temporarily_unavailable'}, 503, PRIVATE)


_LIBRARY_SQL = '''SELECT v.id,l.term,l.accepted_translations,l.part_of_speech,l.definition_en,
  l.translation_uz,l.example_sentence,l.collocations,v.mastery,v.srs_stage,v.interval_days,
  v.next_review_at,v.correct_count,v.incorrect_count,v.active_use_count,
  v.folder_id,v.topic_pack,v.source_type,v.source_snapshot,v.created_at
  FROM user_vocabulary v INNER JOIN lexemes l ON l.id=v.lexeme_id
  WHERE v.user_id=$1 AND v.next_review_at <= now()
  ORDER BY v.next_review_at ASC,l.term ASC LIMIT $2'''


def _library_item(row):
    data = row_to_dict(row)
    return {
      'id': data['id'], 'term': data['term'], 'acceptedTranslations': data['accepted_translations'] or [],
      'partOfSpeech': data['part_of_speech'], 'definitionEn': data['definition_en'],
      'translationUz': data['translation_uz'], 'exampleSentence': data['example_sentence'],
      'collocations': data['collocations'], 'mastery': data['mastery'], 'srsStage': data['srs_stage'],
      'intervalDays': data['interval_days'], 'nextReviewAt': data['next_review_at'],
      'correctCount': data['correct_count'], 'incorrectCount': data['incorrect_count'],
      'activeUseCount': data['active_use_count'], 'folderId': data['folder_id'],
      'topicPack': data['topic_pack'], 'sourceType': data['source_type'],
      'sourceSnapshot': data['source_snapshot'], 'createdAt': data['created_at'],
    }


@router.get('/api/vocabulary/due')
async def vocabulary_due(req: Request):
    user = await core.current_user(req, active=True)
    if not user: return core.j({'error':'unauthenticated'}, 401, PRIVATE)
    raw = req.query_params.get('limit', '40')
    try:
        limit_f = _number(raw)
        limit = min(40, max(1, math.floor(limit_f))) if math.isfinite(limit_f) else 40
    except (ValueError, OverflowError): limit = 40
    try:
        db = await core.pool()
        async with db.acquire() as conn: rows = await conn.fetch(_LIBRARY_SQL, user['id'], limit)
        return core.j({'ok':True, 'due': [_library_item(row) for row in rows]}, headers=PRIVATE)
    except Exception:
        return core.j({'ok': False, 'error': 'temporarily_unavailable'}, 503, PRIVATE)


def _revisit(snapshot):
    if snapshot.get('sourceType') == 'retention' and snapshot.get('retentionAttemptId'): return '/app/reading/retention'
    if snapshot.get('sourceType') == 'video' and snapshot.get('videoLessonId'): return f"/app/video-lessons/{snapshot['videoLessonId']}"
    if snapshot.get('sourceType') == 'listening' and snapshot.get('listeningTestId'):
        sn = snapshot.get('sectionNumber')
        qs = f'?section={sn}' if isinstance(sn,(int,float)) and not isinstance(sn,bool) and 1<=sn<=4 else ''
        return f"/app/listening/tests/{snapshot['listeningTestId']}/study{qs}"
    if snapshot.get('sourceType') == 'reading' and snapshot.get('generalSetId'):
        pn = snapshot.get('passageNo')
        qs = f'?passage={pn}' if isinstance(pn,(int,float)) and not isinstance(pn,bool) and 1<=pn<=3 else ''
        return f"/app/reading/general/{snapshot['generalSetId']}{qs}"
    if snapshot.get('attemptId'): return f"/app/reading/attempts/{snapshot['attemptId']}"
    return None


@router.get('/api/vocabulary/{id}/contexts')
async def vocabulary_contexts(req: Request, id: str):
    user = await core.current_user(req, active=True)
    if not user: return core.j({'error':'unauthenticated'}, 401, PRIVATE)
    voc_id = _uuid(id)
    if not voc_id: return core.j({'error':'invalid_input'}, 400, PRIVATE)
    db = await core.pool()
    async with db.acquire() as conn:
        item = await conn.fetchrow('''SELECT id,seen_count,first_seen_at,last_seen_at FROM user_vocabulary
                                     WHERE id=$1 AND user_id=$2 LIMIT 1''', voc_id, user['id'])
        if not item: return core.j({'error':'not_found'}, 404, PRIVATE)
        contexts = await conn.fetch('''SELECT id,source_type,seen_at,snapshot FROM user_vocabulary_contexts
                                        WHERE user_vocabulary_id=$1 AND user_id=$2 ORDER BY seen_at DESC''', voc_id, user['id'])
    item_dict = row_to_dict(item)
    results = []
    for r in contexts:
        snapshot = r['snapshot']
        snapshot = snapshot if isinstance(snapshot, dict) else {}
        d = row_to_dict(r)
        results.append({'id':d['id'], 'sourceType':d['source_type'], 'seenAt':d['seen_at'],
                        'sourceTitle':snapshot.get('sourceTitle'), 'surfaceForm':snapshot.get('surfaceForm'),
                        'sentenceText':snapshot.get('sentenceText'), 'sectionNumber':snapshot.get('sectionNumber'),
                        'startMs':snapshot.get('startMs'), 'endMs':snapshot.get('endMs'),
                        'revisitHref':_revisit(snapshot)})
    return core.j({'seenCount':item_dict['seen_count'],'firstSeenAt':item_dict['first_seen_at'],
                   'lastSeenAt':item_dict['last_seen_at'],'contexts':results}, headers=PRIVATE)


@router.delete('/api/dictionary/recent')
async def dictionary_recent_clear(req: Request):
    user = await core.current_user(req, active=True)
    if not user: return core.auth_error()
    try:
        db = await core.pool()
        async with db.acquire() as conn:
            await conn.execute('DELETE FROM dictionary_recent_searches WHERE user_id=$1', user['id'])
        return core.j({'ok': True}, headers=PRIVATE)
    except Exception:
        return core.j({'error': 'temporarily_unavailable'}, 503, PRIVATE)


def install():
    core.app.include_router(router)


def _js_round_positive(value: float) -> int:
    return math.floor(value + 0.5)


def _word_count(s: str) -> int:
    if not isinstance(s, str) or not s: return 0
    s = re.sub(r'(?<=\d)[,\u00a0\u202f\u2009](?=\d)', '', s)
    return len(_WORD_COUNT.findall(unicodedata.normalize('NFKC',s)))


@router.get('/api/retention/summary')
async def retention_summary(req: Request):
    user = await core.current_user(req, active=True)
    if not user: return core.auth_error()
    try:
        db = await core.pool()
        async with db.acquire() as conn:
            levels = await conn.fetch('''SELECT level,count(*)::int AS attempts,
              max(score)::int AS best,round(avg(score))::int AS average
              FROM retention_attempts WHERE user_id=$1 AND status IN ('completed','timed_out')
              AND score IS NOT NULL GROUP BY level''',user['id'])
            latest = await conn.fetch('''SELECT score FROM retention_attempts WHERE user_id=$1
              AND status IN ('completed','timed_out') AND score IS NOT NULL
              ORDER BY created_at DESC,id DESC LIMIT 10''', user['id'])
        indexed = {row['level']:row for row in levels}
        by_level = [{'level':lv,'attempts':int(indexed[lv]['attempts']) if lv in indexed else 0,
                     'bestScore':indexed[lv]['best'] if lv in indexed else None,
                     'averageScore':indexed[lv]['average'] if lv in indexed else None}
                    for lv in ('A2','B1','B2','C1','C2')]
        scores = [row['score'] for row in latest if isinstance(row['score'], (int,float))]
        bests = [r['bestScore'] for r in by_level if isinstance(r['bestScore'],(int,float))]
        return core.j({'completedCount':sum(r['attempts'] for r in by_level),
                       'bestScore':max(bests) if bests else None,
                       'lastTenAverage':_js_round_positive(sum(scores)/len(scores)) if scores else None,
                       'lastTenCount':len(scores),'perLevel':by_level})
    except Exception:
        return core.j({'error':'retention_unavailable'}, 500)


@router.get('/api/retention/history')
async def retention_history(req: Request):
    user = await core.current_user(req, active=True)
    if not user: return core.auth_error()
    raw = req.query_params.get('page', '1')
    # JS: Number(raw)||1; Math.floor; clamp at 1.
    converted = _number(raw)
    page = max(1, math.floor(converted)) if math.isfinite(converted) and converted else 1
    size = 10
    try:
        db = await core.pool()
        async with db.acquire() as conn:
            rows = await conn.fetch('''SELECT a.id AS attempt_id,a.level,a.status,a.score,a.recall_text,
              a.completed_at,a.created_at,a.rotation_cycle,
              coalesce(a.retention_label_snapshot,
                  (SELECT t.internal_label FROM retention_texts t WHERE t.id=a.retention_text_id),'') AS label,
              count(*) OVER()::int AS total
              FROM retention_attempts a WHERE a.user_id=$1 AND a.status IN ('completed','timed_out')
              ORDER BY a.created_at DESC,a.id DESC LIMIT $2 OFFSET $3''',
              user['id'],size,(page-1)*size)
        total = rows[0]['total'] if rows else 0
        result = []
        for row in rows:
            r = row_to_dict(row)
            result.append({'attemptId':r['attempt_id'], 'level':r['level'],'label':r['label'],
                           'status':r['status'],'score':r['score'],
                           'recallWordCount':_word_count(r['recall_text'] or ''),
                           'completedAt':r['completed_at'],'createdAt':r['created_at'],
                           'rotationCycle':r['rotation_cycle']})
        return core.j({'rows':result,'page':page,'pageSize':size,'total':total,
                       'pageCount':max(1, math.ceil(total / size))})
    except Exception:
        return core.j({'error':'retention_unavailable'}, 500)


def _normalize_lexical(s: str) -> str:
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC',s or '').lower().translate(_LEX_APOS)).strip()


def _search_rank(row, normal):
    term = _normalize_lexical(row['term'])
    if term == normal: return 100, 'term_exact'
    if term.startswith(normal): return 80, 'term_prefix'
    if any(x.startswith(normal) for x in re.split(r'[\s\-/]+',term) if x): return 60, 'word_prefix'
    if row.get('definition_en') and normal in _normalize_lexical(row['definition_en']): return 40, 'definition'
    if row.get('translation_uz') and normal in _normalize_lexical(row['translation_uz']): return 30, 'translation'
    if normal in term: return 20, 'word_prefix'
    return 0, ''


@router.get('/api/vocabulary/search')
async def vocabulary_search(req: Request):
    user = await core.current_user(req, active=True)
    if not user: return core.auth_error()
    query = req.query_params.get('q', '')[:80]
    if not query.strip():return core.j({'ok':True,'results':[]})
    db = await core.pool()
    async with db.acquire() as conn:
        rows = await conn.fetch('''SELECT v.id,l.term,l.definition_en,l.translation_uz,
          v.mastery,v.srs_stage,v.next_review_at FROM user_vocabulary v
          JOIN lexemes l ON l.id=v.lexeme_id WHERE v.user_id=$1''', user['id'])
    normalized = _normalize_lexical(query)
    results = []
    for r in rows:
        data = dict(r)
        score, match = _search_rank(data, normalized)
        if score:
            results.append((score,data['term'],match,data))
    # JS localeCompare on ties is ICU-based; common English and Uzbek strings
    # compare identically when case/accent are normalized. Exotic ICU ties need DB QA.
    results.sort(key=lambda x:(-x[0], _normalize_lexical(x[1]), x[1]))
    return core.j({'ok':True,'query':query,'results':[
      {'id':str(x[3]['id']),'term':x[3]['term'],'definitionEn':x[3]['definition_en'],
       'translationUz':x[3]['translation_uz'],'mastery':x[3]['mastery'],
       'srsStage':x[3]['srs_stage'],
       'nextReviewAt':row_to_dict({'next_review_at':x[3]['next_review_at']})['next_review_at'],
       'match':x[2]} for x in results[:12]]})


@router.get('/api/vocabulary/folders')
async def vocabulary_folders(req: Request):
    user = await core.current_user(req, active=True)
    if not user: return core.j({'error':'unauthenticated'}, 401, PRIVATE)
    try:
        db = await core.pool()
        async with db.acquire() as conn:
            rows = await conn.fetch('''SELECT f.id,f.name,f.created_at,
              count(v.id)::int AS count FROM vocab_folders f
              LEFT JOIN user_vocabulary v ON v.folder_id=f.id AND v.user_id=$1
              WHERE f.user_id=$1 GROUP BY f.id,f.name,f.created_at ORDER BY f.name ASC''',user['id'])
        folders = [{'id':row_to_dict(r)['id'],'name':r['name'],'createdAt':row_to_dict(r)['created_at'],
                    'count':r['count']} for r in rows]
        return core.j({'ok':True,'folders':folders},headers=PRIVATE)
    except Exception:
        return core.j({'ok':False,'error':'temporarily_unavailable'},503,PRIVATE)


@router.post('/api/vocabulary/folders')
async def vocabulary_folders_post(req: Request):
    user = await core.current_user(req, active=True)
    if not user: return core.j({'error':'unauthenticated'}, 401, PRIVATE)
    body = await core.payload(req)
    if not isinstance(body,dict):return core.j({'error':'invalid_input'},400)
    if 'action' in body:
        from .vocabulary_folders import manage_folder
        return await manage_folder(user,body)
    ids = body.get('entryIds')
    if isinstance(ids,list) and 1 <= len(ids) <= 200 and all(_uuid(x) for x in ids) and ('folderId' in body) and (body['folderId'] is None or _uuid(body['folderId'])):
        folder_id = _uuid(body['folderId']) if body['folderId'] is not None else None
        db = await core.pool()
        async with db.acquire() as conn:
            if folder_id is not None:
                found = await conn.fetchval('SELECT id FROM vocab_folders WHERE id=$1 AND user_id=$2 LIMIT 1',folder_id,user['id'])
                if not found:return core.j({'error':'folder_not_found'},404)
            updated = await conn.fetch('''UPDATE user_vocabulary SET folder_id=$3
              WHERE user_id=$1 AND id=ANY($2::uuid[]) RETURNING id''', user['id'], [_uuid(x) for x in ids],folder_id)
        return core.j({'ok':True,'moved':len(updated)})
    name = body.get('name')
    if not isinstance(name,str) or not 1 <= len(name.strip()) <= 80:
        return core.j({'error':'invalid_input'},400)
    name = name.strip()
    db = await core.pool()
    async with db.acquire() as conn:
        inserted = await conn.fetchrow('''INSERT INTO vocab_folders(user_id,name) VALUES($1,$2)
                ON CONFLICT(user_id,name) DO NOTHING RETURNING id,name''',user['id'],name)
        if inserted:
            return core.j({'ok':True,'folder':{'id':str(inserted['id']),'name':inserted['name']},'existing':False})
        existing = await conn.fetchrow('SELECT id,name FROM vocab_folders WHERE user_id=$1 AND name=$2 LIMIT 1',user['id'],name)
        if not existing:return core.j({'error':'server_error'},400)
        return core.j({'ok':True,'folder':{'id':str(existing['id']),'name':existing['name']},'existing':True})


@router.get('/api/vocabulary/sentences')
async def vocabulary_sentences(req: Request):
    user = await core.current_user(req, active=True)
    if not user: return core.j({'error':'unauthenticated'},401,PRIVATE)
    view = req.query_params.get('view')
    limit_value = _number(req.query_params.get('limit','100'))
    word_limit = min(100,max(1,math.floor(limit_value))) if math.isfinite(limit_value) else 100
    folder = req.query_params.get('folderId') or None
    offset_f = _number(req.query_params.get('offset','0'))
    if (folder and not _uuid(folder)) or not math.isfinite(offset_f) or not offset_f.is_integer() or not 0 <= offset_f <= 100000:
        return core.j({'ok':False,'error':'invalid_input'},400,PRIVATE)
    try:
        db = await core.pool()
        async with db.acquire() as conn:
            sentences = []
            if view != 'words':
                history = await conn.fetch('''SELECT u.id,u.sentence,u.origin,u.riwi_accepted,u.points_awarded,
                  u.evaluation_id,u.created_at,l.term FROM vocabulary_usages u
                  INNER JOIN user_vocabulary v ON u.user_vocabulary_id=v.id
                  INNER JOIN lexemes l ON v.lexeme_id=l.id
                  WHERE u.user_id=$1 ORDER BY u.created_at DESC LIMIT 30''',user['id'])
                for row in history:
                    r = row_to_dict(row)
                    sentences.append({'id':r['id'],'sentence':r['sentence'],'origin':r['origin'],
                                      'accepted':r['riwi_accepted'],'pointsAwarded':r['points_awarded'],
                                      'evaluationId':r['evaluation_id'],'createdAt':r['created_at'],
                                      'term':r['term']})
            if view == 'history':return core.j({'ok':True,'sentences':sentences},headers=PRIVATE)
            word_rows = await conn.fetch('''SELECT v.id,l.term,l.definition_en,l.translation_uz,
              v.mastery,v.folder_id FROM user_vocabulary v
              INNER JOIN lexemes l ON v.lexeme_id=l.id
              WHERE v.user_id=$1 AND ($2::uuid IS NULL OR v.folder_id=$2::uuid)
              ORDER BY v.next_review_at ASC,l.term ASC LIMIT $3 OFFSET $4''',
              user['id'],_uuid(folder) if folder else None,word_limit+1,int(offset_f))
        words = [{'id':str(r['id']), 'term':r['term'], 'definitionEn':r['definition_en'],
                  'translationUz':r['translation_uz'],'mastery':r['mastery'],
                  'folderId':str(r['folder_id']) if r['folder_id'] is not None else None}
                 for r in word_rows[:word_limit]]
        result = {'ok':True,'words':words,'hasMore':len(word_rows)>word_limit}
        if view != 'words':result['sentences']=sentences
        return core.j(result,headers=PRIVATE)
    except Exception:
        return core.j({'ok':False,'error':'temporarily_unavailable'},503,PRIVATE)


def _telegram_hash(value: str) -> str:
    import hashlib
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


@router.get('/api/auth/telegram/intent/status')
async def telegram_intent_status(req: Request):
    intent_id = req.query_params.get('id')
    nonce = req.query_params.get('nonce')
    if not intent_id or not nonce or not _uuid(intent_id):return core.j({'error':'invalid_input'},400)
    try:
        db = await core.pool()
        async with db.acquire() as conn:
            row = await conn.fetchrow('''SELECT status,expires_at,purpose FROM telegram_login_intents
              WHERE id=$1 AND browser_nonce_hash=$2 LIMIT 1''',_uuid(intent_id),_telegram_hash(nonce))
        if not row:return core.j({'error':'not_found'},404)
        expired = row['expires_at'] <= datetime.now(timezone.utc)
        status = 'expired' if expired and row['status'] not in ('consumed','cancelled') else row['status']
        return core.j({'status':status,'expired':expired})
    except Exception:
        return core.j({'error':'internal_error'},500)


@router.post('/api/auth/telegram/intent/cancel')
async def telegram_intent_cancel(req: Request):
    from .rate_limit import RULES, counter, client_key, too_many
    RULES.setdefault('telegram_intent',(10,900))
    exceeded = counter('telegram_intent',client_key(req),consume=True)
    if exceeded:return too_many(exceeded)
    body = await core.payload(req)
    intent_id = body.get('intentId') if isinstance(body,dict) else None
    nonce = body.get('browserNonce') if isinstance(body,dict) else None
    if not _uuid(intent_id) or not isinstance(nonce,str): return core.j({'error':'invalid_input'},400)
    db = await core.pool()
    async with db.acquire() as conn:
        updated = await conn.fetchrow('''UPDATE telegram_login_intents SET status='cancelled',cancelled_at=now()
          WHERE id=$1 AND browser_nonce_hash=$2 AND status IN ('pending','confirmed') RETURNING id''',
          _uuid(intent_id),_telegram_hash(nonce))
        if updated:return core.j({'ok':True})
        existing = await conn.fetchrow('''SELECT status FROM telegram_login_intents
          WHERE id=$1 AND browser_nonce_hash=$2 LIMIT 1''',_uuid(intent_id),_telegram_hash(nonce))
    if not existing:return core.j({'error':'not_found'},404)
    if existing['status']=='cancelled':return core.j({'ok':True})
    return core.j({'error':'consumed' if existing['status']=='consumed' else 'not_cancellable'},409)


def _telegram_enabled():
    import os
    return (os.getenv('TELEGRAM_INTENT_AUTH_ENABLED')=='true' and bool(os.getenv('TELEGRAM_BOT_TOKEN')) and
            bool(os.getenv('TELEGRAM_BOT_USERNAME')) and bool(os.getenv('BOT_SERVICE_SECRET')))


@router.post('/api/auth/telegram/intent')
async def telegram_intent_create(req: Request):
    import os
    import secrets
    from datetime import timedelta
    from .rate_limit import RULES,counter,client_key,too_many
    if not _telegram_enabled():return core.j({'error':'telegram_not_configured'},400)
    RULES.setdefault('telegram_intent',(10,900))
    exceeded = counter('telegram_intent',client_key(req),consume=True)
    if exceeded:return too_many(exceeded)
    body = await core.payload(req)
    requested = body.get('purpose') if isinstance(body,dict) else None
    current = await core.current_user(req)
    if requested is None or requested == '': purpose = 'login'
    elif requested in ('login','register','link','replace'): purpose=requested
    else: return core.j({'error':'invalid_purpose'},409)
    if purpose in ('link','replace') and not current:return core.j({'error':'sign_in_required'},401)
    if purpose=='register' and current:return core.j({'error':'already_signed_in'},409)
    if purpose=='replace' and current['role']!='student':return core.j({'error':'change_not_available'},403)
    token = secrets.token_hex(32)
    nonce = secrets.token_hex(32)
    expiration = datetime.now(timezone.utc) + timedelta(minutes=5)
    db = await core.pool()
    async with db.acquire() as conn:
        inserted = await conn.fetchrow('''INSERT INTO telegram_login_intents
          (token_hash,browser_nonce_hash,user_id,purpose,expires_at)
          VALUES($1,$2,$3,$4,$5) RETURNING id''',_telegram_hash(token),_telegram_hash(nonce),
          current['id'] if purpose in ('link','replace') else None,purpose,expiration)
    if not inserted:raise RuntimeError('Failed to create login intent')
    return core.j({'intentId':str(inserted['id']),'token':token,'browserNonce':nonce,
                   'expiresAt':row_to_dict({'expiresAt':expiration})['expiresAt'],
                   'purpose':purpose,'botUsername':os.getenv('TELEGRAM_BOT_USERNAME')})


@router.post('/api/auth/reset/request')
async def auth_reset_request(req: Request):
    import os
    import secrets
    from datetime import timedelta
    from .rate_limit import RULES,counter,client_key,too_many
    if not core.auth_policy()['passwordEnabled']:return core.auth_disabled()
    body, error = core.validate_auth(await core.payload(req), 'request')
    if error:return core.j({'error': error},400)
    email=body['email']
    RULES.setdefault('password_reset',(5,900))
    ip_limit=counter('password_reset',client_key(req),consume=True)
    if ip_limit:return too_many(ip_limit)
    email_limit=counter('password_reset','acct:'+email,consume=True)
    if email_limit:return too_many(email_limit)
    if os.environ.get('NODE_ENV') != 'development' or os.environ.get('ALLOW_DEV_RESET_LINKS') != 'true':
        return core.j({'error':'reset_unavailable'},503)
    db=await core.pool()
    async with db.acquire() as conn:
        user=await conn.fetchrow('SELECT id FROM users WHERE email=$1 LIMIT 1',email)
        if not user:return core.j({'ok':True})
        token=secrets.token_hex(32)
        expires=datetime.now(timezone.utc)+timedelta(hours=1)
        await conn.execute('''INSERT INTO password_reset_tokens(user_id,token_hash,expires_at)
          VALUES($1,$2,$3)''',user['id'],_telegram_hash(token),expires)
    return core.j({'ok':True,'devResetUrl':f'/reset-password/confirm?token={token}'})


@router.post('/api/auth/reset/confirm')
async def auth_reset_confirm(req: Request):
    if not core.auth_policy()['passwordEnabled']:return core.auth_disabled()
    body, error=core.validate_auth(await core.payload(req), 'confirm')
    if error:return core.j({'error':error},400)
    token=body['token'];password=body['password']
    db=await core.pool()
    async with db.acquire() as conn:
        record=await conn.fetchrow('''SELECT id,user_id FROM password_reset_tokens
          WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() LIMIT 1''',_telegram_hash(token))
        if not record:return core.j({'error':'invalid_or_expired_token'},400)
        import bcrypt
        pw_hash=(await asyncio.to_thread(bcrypt.hashpw,password.encode('utf-8'),bcrypt.gensalt(rounds=12))).decode('utf-8')
        async with conn.transaction():
            claimed=await conn.fetchrow('''UPDATE password_reset_tokens SET used_at=now()
              WHERE id=$1 AND used_at IS NULL AND expires_at>now() RETURNING id''',record['id'])
            if not claimed:return core.j({'error':'invalid_or_expired_token'},400)
            await conn.execute('''UPDATE users SET password_hash=$1,auth_version=auth_version+1
              WHERE id=$2''',pw_hash,record['user_id'])
    return core.j({'ok':True})


def _staff(user):
    return user and user.get('role') in ('teacher','admin','owner')


@router.get('/api/admin/content/items')
async def admin_content_items(req: Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if not _staff(user):return core.j({'error':'forbidden'},403)
    module = req.query_params.get('module') or None
    content_type = req.query_params.get('contentType') or None
    db=await core.pool()
    async with db.acquire() as conn:
        versions=await conn.fetch('''SELECT module,content_type,source_ref,version_no,
          publication_state,title FROM content_versions v
          WHERE NOT EXISTS(SELECT 1 FROM activity_events deleted_content
            WHERE deleted_content.id=md5('deleted-content:' || (v.id)::text)::uuid
            AND deleted_content.type='CONTENT_DELETED')
          ORDER BY version_no DESC''')
    items: dict[str,dict] = {}
    for row in versions:
        if module and row['module']!=module:continue
        if content_type and row['content_type']!=content_type:continue
        key=f"{row['module']}:{row['content_type']}|{row['source_ref']}"
        if key in items:items[key]['versions']+=1
        else:
            items[key]={'key':key,'module':row['module'],'contentType':row['content_type'],
                        'sourceRef':row['source_ref'],'versions':1,
                        'state':row['publication_state'] if row['publication_state'] in ('draft','scheduled','published','archived') else 'draft',
                        'title':row['title']}
    return core.j({'items':list(items.values())})


@router.post('/api/admin/grammar/topics')
async def admin_grammar_topics(req: Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('admin','owner'):return core.j({'error':'forbidden'},403)
    body,error=parse_admin(await core.payload(req),'grammar_topic')
    if error:return core.j({'error':error},400)
    db=await core.pool()
    async with db.acquire() as conn:
        # Original reads all topics then writes count+1; deliberately not a MAX(order) shortcut.
        count=await conn.fetchval('SELECT count(*)::int FROM grammar_topics')
        created=await conn.fetchrow('''INSERT INTO grammar_topics(skill_area,title,explanation,"order")
          VALUES($1,$2,$3,$4) RETURNING id''',body['skillArea'],body['title'],body['explanation'],count+1)
    return core.j({'ok':True,'id':str(created['id'])})


@router.post('/api/admin/reading/passages')
async def admin_reading_passages(req: Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('admin','owner'):return core.j({'error':'forbidden'},403)
    body,error=parse_admin(await core.payload(req),'passage')
    if error:return core.j({'error':error},400)
    minutes=_number(body.get('suggestedMinutes'))
    if not math.isfinite(minutes) or not minutes.is_integer() or not 5<=minutes<=90:
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        row=await conn.fetchrow('''INSERT INTO reading_passages(title,body_text,difficulty_level,suggested_minutes,publication_state)
          VALUES($1,$2,$3,$4,'draft') RETURNING id''',body['title'],body['bodyText'],body['difficultyLevel'],int(minutes))
    return core.j({'ok':True,'id':str(row['id'])})

