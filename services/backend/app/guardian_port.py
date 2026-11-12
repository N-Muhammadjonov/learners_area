"""Parent Connect: guardian invitations, student approval, read-only child views, staff directory and
HUMAN-APPROVED manual messages.

Hard rules enforced here (server side, never by hiding buttons):
  * A guardian is an account with role 'guardian'. It can reach ONLY the /api/guardian/* reads (see
    guardian_path_allowed, enforced centrally in main.current_authority) and each read re-checks the live link.
  * Nothing in this module ever creates a message on its own. A batch exists only after an authorised human
    called POST /api/staff/guardian-messages/send with confirm=true. The delivery worker may only RETRY rows
    that belong to such a batch.
  * Invitation tokens are opaque, one-time and stored only as a SHA-256 hash.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request

from . import main as core
from .internal_bot_ready_port import verify_bot
from .rate_limit import RULES, async_counter as counter, too_many
from .telegram_preferences_port import valid_actor

router = APIRouter()
PRIVATE = {'Cache-Control': 'private, no-store'}

RELATIONSHIPS = ('mother', 'father', 'older_brother', 'younger_brother',
                 'older_sister', 'younger_sister', 'guardian', 'other')
LIVE_STATUSES = ('awaiting_guardian', 'awaiting_student', 'linked')
TOKEN_RE = re.compile(r'g_[0-9a-f]{24}')
PERIODS = ('week', 'month', 'all')
PROGRESS_REGIONS = ('progressSummary', 'progressStreak', 'progressTrends', 'progressMocks')
MAX_BODY = 1500
MAX_RECIPIENTS = 500
ALLOWED_PLACEHOLDERS = ('student_name', 'guardian_relation')

RELATION_LABEL = {
    'uz': {'mother': 'Onasi', 'father': 'Otasi', 'older_brother': 'Akasi', 'younger_brother': 'Ukasi',
           'older_sister': 'Opasi', 'younger_sister': 'Singlisi', 'guardian': 'Vasiyi', 'other': 'Yaqini'},
    'en': {'mother': 'Mother', 'father': 'Father', 'older_brother': 'Older brother',
           'younger_brother': 'Younger brother', 'older_sister': 'Older sister',
           'younger_sister': 'Younger sister', 'guardian': 'Guardian', 'other': 'Relative'},
}

# Editable starting texts only. Picking one fills the composer; it never sends anything and never claims a fact.
TEMPLATES = [
    {'key': 'homework', 'title': {'uz': 'Vazifalar bajarilmagani haqida', 'en': 'Missing homework'},
     'body': {'uz': "Assalomu alaykum!\nFarzandingiz {student_name}ning bajarilmagan vazifalari haqida sizni xabardor qilmoqchiman.\nIltimos, uning o'qish rejasiga e'tibor qarating.\nHurmat bilan, Learners Area.",
              'en': "Hello!\nI would like to let you know about {student_name}'s unfinished homework.\nPlease pay attention to the study plan.\nBest regards, Learners Area."}},
    {'key': 'good_result', 'title': {'uz': 'Yaxshi natija', 'en': 'Positive result'},
     'body': {'uz': "Assalomu alaykum!\nFarzandingiz {student_name} yaxshi natija ko'rsatdi. Rahmat sizga qo'llab-quvvatlaganingiz uchun.\nHurmat bilan, Learners Area.",
              'en': "Hello!\n{student_name} has shown a good result. Thank you for your support.\nBest regards, Learners Area."}},
    {'key': 'lower_result', 'title': {'uz': 'Natija pasaygani haqida', 'en': 'Concern about progress'},
     'body': {'uz': "Assalomu alaykum!\nFarzandingiz {student_name}ning natijalari haqida gaplashmoqchimiz. Iltimos, biz bilan bog'laning.\nHurmat bilan, Learners Area.",
              'en': "Hello!\nWe would like to talk about {student_name}'s progress. Please get in touch with us.\nBest regards, Learners Area."}},
    {'key': 'meeting', 'title': {'uz': "Ota-onalar uchrashuvi", 'en': 'Parent meeting'},
     'body': {'uz': "Assalomu alaykum!\nSizni ota-onalar uchrashuviga taklif qilamiz. Vaqt va joyni yozing yoki shu xabarga javob bering.\nHurmat bilan, Learners Area.",
              'en': "Hello!\nYou are invited to a parent meeting. Please fill in the date and place before sending.\nBest regards, Learners Area."}},
    {'key': 'encouragement', 'title': {'uz': "Rag'batlantirish", 'en': 'Encouragement'},
     'body': {'uz': "Assalomu alaykum!\n{student_name} o'qishda harakat qilmoqda. Unga iliq so'z ayting — bu juda muhim.\nHurmat bilan, Learners Area.",
              'en': "Hello!\n{student_name} is working hard. A kind word from you means a lot.\nBest regards, Learners Area."}},
    {'key': 'custom', 'title': {'uz': "O'zim yozaman", 'en': 'Write my own'}, 'body': {'uz': '', 'en': ''}},
]
TEMPLATE_KEYS = tuple(t['key'] for t in TEMPLATES)


# ───────────────────────── small helpers ─────────────────────────
def iso(value):
    return value.isoformat() if isinstance(value, datetime) else None


def err(code, status=400):
    return core.j({'error': code}, status, PRIVATE)


def env_int(name, default, low, high):
    try:
        return max(low, min(high, int(os.getenv(name, default))))
    except (TypeError, ValueError):
        return default


def invite_ttl():
    return timedelta(minutes=env_int('GUARDIAN_INVITE_TTL_MINUTES', 60, 5, 1440))


def recheck_window():
    return timedelta(minutes=env_int('GUARDIAN_CHANNEL_RECHECK_MINUTES', 360, 1, 1440))


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def clip(value, limit):
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


def clean_text(value) -> str:
    """Plain text only: drop control characters (keep newlines/tabs) and normalise newlines."""
    if not isinstance(value, str):
        return ''
    value = value.replace('\r\n', '\n').replace('\r', '\n')
    return ''.join(ch for ch in value if ch in '\n\t' or ord(ch) >= 32).strip()


def mask_phone(phone):
    digits = re.sub(r'\D', '', phone or '')
    if len(digits) < 7:
        return None
    return '+' + digits[:3] + ' ** *** ** ' + digits[-2:]


def mask_tg(tg):
    return '•••' + tg[-3:] if isinstance(tg, str) and len(tg) > 3 else '•••'


def channel_config():
    """Configured, never invented. Returns None when the owner has not set the guardian channel up yet."""
    chat_id = os.getenv('GUARDIAN_REQUIRED_CHANNEL_ID', '').strip()
    url = os.getenv('GUARDIAN_REQUIRED_CHANNEL_URL', '').strip()
    if not chat_id or not re.fullmatch(r'https://t\.me/[A-Za-z0-9_+/-]+', url):
        return None
    return {'id': chat_id, 'url': url, 'title': os.getenv('GUARDIAN_REQUIRED_CHANNEL_TITLE', '').strip()[:60] or 'Learners Area · Ota-onalar'}


async def channel_status(telegram_user_id: str) -> str:
    """'ok' | 'not_subscribed' | 'unavailable' | 'not_configured'. Always a live Telegram call; fails closed."""
    config = channel_config()
    if not config:
        return 'not_configured'
    token = os.getenv('TELEGRAM_BOT_TOKEN')
    if not token:
        return 'unavailable'
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f'https://api.telegram.org/bot{token}/getChatMember',
                                    params={'chat_id': config['id'], 'user_id': telegram_user_id})
            data = resp.json()
    except Exception:
        return 'unavailable'
    if not resp.is_success or not data.get('ok') or not data.get('result'):
        return 'unavailable'
    member = data['result']
    status = member.get('status')
    if status in ('creator', 'administrator', 'member') or (status == 'restricted' and member.get('is_member') is True):
        return 'ok'
    return 'not_subscribed'


async def guardian_channel_gate(telegram_user_id: str):
    """Used by step18 gates() so a guardian's website login uses the GUARDIAN channel instead of the student ones."""
    state = await channel_status(telegram_user_id)
    if state == 'ok':
        return None
    config = channel_config()
    channels = [{'id': config['id'], 'title': config['title'], 'url': config['url']}] if config else []
    return {'error': 'not_subscribed' if state == 'not_subscribed' else 'membership_unavailable', 'requiredChannels': channels}


def guardian_path_allowed(path: str) -> bool:
    """Central allow-list for role 'guardian'. Everything else under /api is forbidden for guardians."""
    return (path.startswith('/api/guardian/') or path in (
        '/api/frontend/session', '/api/frontend/public', '/api/auth/logout', '/api/auth/changes',
        '/api/auth/state', '/api/auth/telegram/intent/exchange', '/api/locale', '/api/theme'))


async def audit(con, action, *, actor_user_id=None, actor_telegram_id=None, link_id=None, student_id=None, metadata=None):
    await con.execute('''INSERT INTO guardian_audit_events(actor_user_id,actor_telegram_id,action,link_id,student_id,metadata)
                         VALUES($1,$2,$3,$4,$5,$6::jsonb)''', actor_user_id, actor_telegram_id, action, link_id, student_id,
                      json.dumps(metadata) if metadata else None)


def link_dto(row, *, reveal=False):
    return {'linkId': str(row['id']), 'status': row['status'], 'relationship': row['relationship'],
            'guardianName': row.get('display_name'), 'telegramUsername': row.get('username'),
            'requestedAt': iso(row.get('requested_at')), 'approvedAt': iso(row.get('approved_at'))}


# ───────────────────────── invitation / student side ─────────────────────────
async def create_invitation(con, student_id, relationship):
    if relationship is not None and relationship not in RELATIONSHIPS:
        return None, 'invalid_relationship', 400
    open_count = await con.fetchval('''SELECT count(*)::int FROM guardian_invitations
        WHERE student_id=$1 AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()''', student_id)
    if open_count >= 5:
        return None, 'too_many_open_invitations', 429
    token = 'g_' + secrets.token_hex(12)  # 'g_' + 24 hex: fits Telegram's /start payload; never contains personal data
    expires = datetime.now(timezone.utc) + invite_ttl()
    inv = await con.fetchval('''INSERT INTO guardian_invitations(student_id,token_hash,intended_relationship,expires_at)
                                VALUES($1,$2,$3,$4) RETURNING id''', student_id, hash_token(token), relationship, expires)
    await audit(con, 'guardian.invitation.created', actor_user_id=student_id, student_id=student_id,
                metadata={'invitationId': str(inv)})
    username = os.getenv('TELEGRAM_BOT_USERNAME', '').strip().lstrip('@')
    url = f'https://t.me/{username}?start={token}' if re.fullmatch(r'[A-Za-z0-9_]{5,32}', username) else None
    return {'invitationId': str(inv), 'payload': token, 'url': url, 'expiresAt': iso(expires)}, None, 200


LINK_SELECT = '''SELECT l.id,l.status,l.relationship,l.requested_at,l.approved_at,l.guardian_ready_at,
       p.display_name,p.telegram_user_id,p.channel_verified_at,t.username
  FROM guardian_links l JOIN guardian_profiles p ON p.id=l.guardian_profile_id
  LEFT JOIN telegram_contacts t ON t.telegram_user_id=p.telegram_user_id'''


async def student_links(con, student_id):
    rows = await con.fetch(LINK_SELECT + ''' WHERE l.student_id=$1 AND l.status IN ('awaiting_student','linked')
                                             ORDER BY l.requested_at DESC LIMIT 50''', student_id)
    return [link_dto(dict(r)) for r in rows]


async def ensure_guardian_user(con, profile):
    """Create (or reuse) the guardian login identity. Never touches an existing student/staff account."""
    existing = await con.fetchrow('SELECT id,role FROM users WHERE telegram_id=$1', profile['telegram_user_id'])
    if existing:
        if existing['role'] != 'guardian':
            return None
        user_id = existing['id']
    else:
        name = (profile['display_name'] or 'Guardian')[:200]
        user_id = await con.fetchval('''INSERT INTO users(telegram_id,name,role,account_status,locale,onboarding_completed_at)
              VALUES($1,$2,'guardian','active',$3,now()) RETURNING id''',
                                     profile['telegram_user_id'], name, profile['language'] or 'uz')
    await con.execute('UPDATE guardian_profiles SET user_id=$2,updated_at=now() WHERE id=$1', profile['id'], user_id)
    await con.execute('UPDATE telegram_contacts SET linked_user_id=$2,updated_at=now() WHERE telegram_user_id=$1 AND linked_user_id IS NULL',
                      profile['telegram_user_id'], user_id)
    return user_id


async def decide_link(con, student_id, link_id, decision, *, actor_telegram_id=None):
    """approve | reject | revoke — always scoped to the student who owns the link."""
    if not core.uuid_value(link_id):
        return None, 'not_found', 404
    async with con.transaction():
        link = await con.fetchrow('SELECT * FROM guardian_links WHERE id=$1 AND student_id=$2 FOR UPDATE', link_id, student_id)
        if not link:
            return None, 'not_found', 404
        if decision == 'approve':
            if link['status'] != 'awaiting_student':
                return None, 'not_awaiting_approval', 409
            profile = await con.fetchrow('SELECT * FROM guardian_profiles WHERE id=$1 FOR UPDATE', link['guardian_profile_id'])
            phone = await con.fetchval('SELECT phone_verified_at FROM telegram_contacts WHERE telegram_user_id=$1',
                                       profile['telegram_user_id'])
            if not link['relationship'] or not phone or not profile['channel_verified_at']:
                return None, 'guardian_not_ready', 409
            if not await ensure_guardian_user(con, profile):
                return None, 'account_conflict', 409
            await con.execute("UPDATE guardian_links SET status='linked',approved_at=now(),updated_at=now() WHERE id=$1", link['id'])
            action = 'guardian.link.approved'
        elif decision == 'reject':
            if link['status'] not in ('awaiting_student', 'awaiting_guardian'):
                return None, 'not_pending', 409
            await con.execute("UPDATE guardian_links SET status='rejected',updated_at=now() WHERE id=$1", link['id'])
            action = 'guardian.link.rejected'
        elif decision == 'revoke':
            if link['status'] not in ('linked', 'awaiting_student', 'awaiting_guardian'):
                return None, 'not_revocable', 409
            await con.execute('''UPDATE guardian_links SET status='revoked',revoked_at=now(),revoked_by_user_id=$2,updated_at=now()
                                 WHERE id=$1''', link['id'], student_id)
            action = 'guardian.link.revoked'
        else:
            return None, 'invalid_decision', 400
        await audit(con, action, actor_user_id=student_id, actor_telegram_id=actor_telegram_id,
                    link_id=link['id'], student_id=student_id)
    row = await con.fetchrow(LINK_SELECT + ' WHERE l.id=$1', link_id)
    return link_dto(dict(row)), None, 200


async def student_user(req):
    user = await core.current_user(req, active=True)
    if not user:
        return None, err('unauthenticated', 401)
    if user['role'] != 'student':
        return None, err('forbidden', 403)
    return user, None


@router.post('/api/guardians/invitations')
async def web_create_invitation(req: Request):
    user, failure = await student_user(req)
    if failure:
        return failure
    RULES.setdefault('guardian_invite', (10, 3600))
    delay = await counter('guardian_invite', 'u:' + str(user['id']), consume=True)
    if delay:
        return too_many(delay)
    body = await core.payload(req)
    relationship = body.get('relationship') if isinstance(body, dict) else None
    db = await core.pool()
    async with db.acquire() as con:
        data, error, status = await create_invitation(con, user['id'], relationship)
    return core.j({'ok': True, **data}, 201, PRIVATE) if not error else err(error, status)


@router.get('/api/guardians/links')
async def web_links(req: Request):
    user, failure = await student_user(req)
    if failure:
        return failure
    db = await core.pool()
    async with db.acquire() as con:
        return core.j({'ok': True, 'links': await student_links(con, user['id'])}, headers=PRIVATE)


async def web_decide(req: Request, link_id: str, decision: str):
    user, failure = await student_user(req)
    if failure:
        return failure
    db = await core.pool()
    async with db.acquire() as con:
        data, error, status = await decide_link(con, user['id'], link_id, decision)
    return core.j({'ok': True, 'link': data}, headers=PRIVATE) if not error else err(error, status)


@router.post('/api/guardians/links/{link_id}/approve')
async def web_approve(req: Request, link_id: str):
    return await web_decide(req, link_id, 'approve')


@router.post('/api/guardians/links/{link_id}/reject')
async def web_reject(req: Request, link_id: str):
    return await web_decide(req, link_id, 'reject')


@router.post('/api/guardians/links/{link_id}/revoke')
async def web_revoke(req: Request, link_id: str):
    return await web_decide(req, link_id, 'revoke')


# ───────────────────────── bot-internal (Bearer BOT_SERVICE_SECRET) ─────────────────────────
async def bot_body(req):
    denied = verify_bot(req)
    if denied is not None:
        return None, denied
    body = await core.payload(req)
    return (body if isinstance(body, dict) else {}), None


async def bot_student(con, telegram_id):
    return await con.fetchrow('''SELECT id,name,locale FROM users
        WHERE telegram_id=$1 AND role='student' AND account_status='active' ''', telegram_id)


@router.post('/api/internal/telegram/guardians/invitations')
async def bot_invitation(req: Request):
    body, denied = await bot_body(req)
    if denied is not None:
        return denied
    tg = body.get('telegramUserId')
    if not valid_actor(tg):
        return err('invalid_actor')
    RULES.setdefault('guardian_invite', (10, 3600))
    delay = await counter('guardian_invite', 'tg:' + tg, consume=True)
    if delay:
        return too_many(delay)
    db = await core.pool()
    async with db.acquire() as con:
        student = await bot_student(con, tg)
        if not student:
            return err('student_required', 403)
        data, error, status = await create_invitation(con, student['id'], body.get('relationship'))
    return core.j({'ok': True, **data}, headers=PRIVATE) if not error else err(error, status)


@router.get('/api/internal/telegram/guardians/student-links')
async def bot_student_links(req: Request):
    denied = verify_bot(req)
    if denied is not None:
        return denied
    tg = req.query_params.get('telegramUserId', '')
    if not valid_actor(tg):
        return err('invalid_actor')
    db = await core.pool()
    async with db.acquire() as con:
        student = await bot_student(con, tg)
        if not student:
            return err('student_required', 403)
        return core.j({'ok': True, 'links': await student_links(con, student['id'])}, headers=PRIVATE)


@router.post('/api/internal/telegram/guardians/decide')
async def bot_decide(req: Request):
    body, denied = await bot_body(req)
    if denied is not None:
        return denied
    tg = body.get('actorTelegramId')
    if not valid_actor(tg) or body.get('decision') not in ('approve', 'reject', 'revoke'):
        return err('invalid_input')
    db = await core.pool()
    async with db.acquire() as con:
        student = await bot_student(con, tg)
        if not student:
            return err('student_required', 403)
        data, error, status = await decide_link(con, student['id'], str(body.get('linkId')), body['decision'], actor_telegram_id=tg)
        guardian_chat = None
        if data:
            guardian_chat = await con.fetchrow('''SELECT t.chat_id,p.language FROM guardian_links l
                JOIN guardian_profiles p ON p.id=l.guardian_profile_id
                LEFT JOIN telegram_contacts t ON t.telegram_user_id=p.telegram_user_id WHERE l.id=$1''', data['linkId'])
    if error:
        return err(error, status)
    return core.j({'ok': True, 'link': data, 'studentName': student['name'],
                   'guardianChatId': guardian_chat['chat_id'] if guardian_chat else None,
                   'guardianLanguage': guardian_chat['language'] if guardian_chat else None}, headers=PRIVATE)


async def profile_state(con, tg):
    """Everything the bot needs to render the guardian flow, from the database only."""
    profile = await con.fetchrow('SELECT * FROM guardian_profiles WHERE telegram_user_id=$1', tg)
    phone = await con.fetchval('SELECT phone_verified_at FROM telegram_contacts WHERE telegram_user_id=$1', tg)
    links = []
    if profile:
        rows = await con.fetch('''SELECT l.id,l.status,l.relationship,u.name AS student_name FROM guardian_links l
            JOIN users u ON u.id=l.student_id WHERE l.guardian_profile_id=$1 AND l.status IN ('awaiting_guardian','awaiting_student','linked')
            ORDER BY l.requested_at DESC LIMIT 20''', profile['id'])
        links = [{'linkId': str(r['id']), 'status': r['status'], 'relationship': r['relationship'],
                  'studentName': r['student_name']} for r in rows]
    config = channel_config()
    return {'phoneVerified': bool(phone), 'channelVerified': bool(profile and profile['channel_verified_at']),
            'channelUrl': config['url'] if config else None, 'channelConfigured': bool(config), 'links': links,
            'language': profile['language'] if profile else None}


@router.post('/api/internal/telegram/guardians/redeem')
async def bot_redeem(req: Request):
    body, denied = await bot_body(req)
    if denied is not None:
        return denied
    tg, token = body.get('telegramUserId'), body.get('token')
    if not valid_actor(tg) or not isinstance(token, str) or not TOKEN_RE.fullmatch(token):
        return err('invalid_input')
    RULES.setdefault('guardian_redeem', (10, 900))
    delay = await counter('guardian_redeem', 'tg:' + tg, consume=True)
    if delay:
        return too_many(delay)
    lang = body.get('languageCode') if body.get('languageCode') in ('uz', 'en') else None
    name = clip(body.get('displayName'), 200)
    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            inv = await con.fetchrow('SELECT * FROM guardian_invitations WHERE token_hash=$1 FOR UPDATE', hash_token(token))
            if not inv:
                return err('invitation_invalid', 404)
            student = await con.fetchrow('''SELECT id,name,telegram_id FROM users
                WHERE id=$1 AND role='student' AND account_status='active' ''', inv['student_id'])
            if not student or inv['cancelled_at']:
                return err('invitation_invalid', 404)
            if student['telegram_id'] == tg:
                return err('self_link', 409)
            other = await con.fetchrow('SELECT role FROM users WHERE telegram_id=$1', tg)
            if other and other['role'] != 'guardian':
                return err('account_conflict', 409)
            profile = await con.fetchrow('''INSERT INTO guardian_profiles(telegram_user_id,display_name,language)
                VALUES($1,$2,$3) ON CONFLICT(telegram_user_id) DO UPDATE SET
                  display_name=COALESCE(EXCLUDED.display_name,guardian_profiles.display_name),
                  language=COALESCE(EXCLUDED.language,guardian_profiles.language),updated_at=now()
                RETURNING *''', tg, name, lang)
            live = await con.fetchrow('''SELECT id,status FROM guardian_links
                WHERE guardian_profile_id=$1 AND student_id=$2 AND status IN ('awaiting_guardian','awaiting_student','linked')''',
                                      profile['id'], student['id'])
            if inv['consumed_at']:
                # One-time: only the very same Telegram identity may resume an already redeemed invitation.
                if inv['consumed_by_telegram_id'] != tg or not live:
                    return err('invitation_used', 409)
            elif inv['expires_at'] <= datetime.now(timezone.utc):
                return err('invitation_expired', 410)
            if not live:
                live = await con.fetchrow('''INSERT INTO guardian_links(guardian_profile_id,student_id,invitation_id,relationship,status)
                    VALUES($1,$2,$3,$4,'awaiting_guardian') RETURNING id,status''',
                                          profile['id'], student['id'], inv['id'], inv['intended_relationship'])
            elif live['status'] == 'linked' and not inv['consumed_at']:
                return err('already_linked', 409)
            if not inv['consumed_at']:
                await con.execute('UPDATE guardian_invitations SET consumed_at=now(),consumed_by_telegram_id=$2 WHERE id=$1', inv['id'], tg)
            await audit(con, 'guardian.invitation.redeemed', actor_telegram_id=tg, link_id=live['id'], student_id=student['id'])
        state = await profile_state(con, tg)
        link = await con.fetchrow('SELECT relationship,status FROM guardian_links WHERE id=$1', live['id'])
    return core.j({'ok': True, 'linkId': str(live['id']), 'status': link['status'], 'relationship': link['relationship'],
                   'studentName': student['name'], **state}, headers=PRIVATE)


@router.post('/api/internal/telegram/guardians/state')
async def bot_state(req: Request):
    body, denied = await bot_body(req)
    if denied is not None:
        return denied
    tg = body.get('telegramUserId')
    if not valid_actor(tg):
        return err('invalid_actor')
    db = await core.pool()
    async with db.acquire() as con:
        return core.j({'ok': True, **(await profile_state(con, tg))}, headers=PRIVATE)


async def advance(con, link_id):
    """awaiting_guardian -> awaiting_student once relationship + native phone + channel are all verified.
    Returns the student-notification payload exactly once, on the transition."""
    row = await con.fetchrow('''SELECT l.id,l.relationship,l.status,l.student_id,p.telegram_user_id,p.channel_verified_at,p.display_name
        FROM guardian_links l JOIN guardian_profiles p ON p.id=l.guardian_profile_id WHERE l.id=$1 FOR UPDATE OF l''', link_id)
    if not row or row['status'] != 'awaiting_guardian' or not row['relationship'] or not row['channel_verified_at']:
        return None
    phone = await con.fetchval('SELECT phone_verified_at FROM telegram_contacts WHERE telegram_user_id=$1', row['telegram_user_id'])
    if not phone:
        return None
    await con.execute("UPDATE guardian_links SET status='awaiting_student',guardian_ready_at=now(),updated_at=now() WHERE id=$1", row['id'])
    await audit(con, 'guardian.link.ready', actor_telegram_id=row['telegram_user_id'], link_id=row['id'], student_id=row['student_id'])
    student = await con.fetchrow('''SELECT u.locale,t.chat_id,t.username FROM users u
        LEFT JOIN telegram_contacts t ON t.telegram_user_id=u.telegram_id WHERE u.id=$1''', row['student_id'])
    guardian_tg = await con.fetchval('SELECT username FROM telegram_contacts WHERE telegram_user_id=$1', row['telegram_user_id'])
    return {'chatId': student['chat_id'] if student else None, 'locale': student['locale'] if student else 'uz',
            'linkId': str(row['id']), 'guardianName': row['display_name'], 'guardianUsername': guardian_tg,
            'relationship': row['relationship']}


async def own_link(con, tg, link_id):
    if not core.uuid_value(link_id):
        return None
    return await con.fetchrow('''SELECT l.* FROM guardian_links l JOIN guardian_profiles p ON p.id=l.guardian_profile_id
        WHERE l.id=$1 AND p.telegram_user_id=$2 AND l.status IN ('awaiting_guardian','awaiting_student')''', link_id, tg)


@router.post('/api/internal/telegram/guardians/relationship')
async def bot_relationship(req: Request):
    body, denied = await bot_body(req)
    if denied is not None:
        return denied
    tg, relationship = body.get('telegramUserId'), body.get('relationship')
    if not valid_actor(tg) or relationship not in RELATIONSHIPS:
        return err('invalid_input')
    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            link = await own_link(con, tg, str(body.get('linkId')))
            if not link or link['status'] != 'awaiting_guardian':
                return err('not_found', 404)
            await con.execute('UPDATE guardian_links SET relationship=$2,updated_at=now() WHERE id=$1', link['id'], relationship)
            await audit(con, 'guardian.relationship.set', actor_telegram_id=tg, link_id=link['id'],
                        student_id=link['student_id'], metadata={'relationship': relationship})
            notify = await advance(con, link['id'])
        state = await profile_state(con, tg)
    return core.j({'ok': True, 'notifyStudent': notify, **state}, headers=PRIVATE)


@router.post('/api/internal/telegram/guardians/check-channel')
async def bot_check_channel(req: Request):
    body, denied = await bot_body(req)
    if denied is not None:
        return denied
    tg = body.get('telegramUserId')
    if not valid_actor(tg):
        return err('invalid_actor')
    RULES.setdefault('guardian_channel_check', (30, 900))
    delay = await counter('guardian_channel_check', 'tg:' + tg, consume=True)
    if delay:
        return too_many(delay)
    db = await core.pool()
    async with db.acquire() as con:
        link = await own_link(con, tg, str(body.get('linkId')))
        if not link:
            return err('not_found', 404)
        state = await channel_status(tg)  # live Telegram call, outside any DB transaction
        if state == 'not_configured':
            return core.j({'error': 'channel_not_configured'}, 503, PRIVATE)
        if state == 'unavailable':
            return core.j({'error': 'membership_unavailable', 'channelUrl': channel_config()['url']}, 503, PRIVATE)
        if state == 'not_subscribed':
            await con.execute('UPDATE guardian_profiles SET channel_verified_at=NULL,updated_at=now() WHERE telegram_user_id=$1', tg)
            return core.j({'error': 'not_subscribed', 'channelUrl': channel_config()['url']}, 403, PRIVATE)
        async with con.transaction():
            await con.execute('UPDATE guardian_profiles SET channel_verified_at=now(),updated_at=now() WHERE telegram_user_id=$1', tg)
            notify = await advance(con, link['id'])
        data = await profile_state(con, tg)
    return core.j({'ok': True, 'notifyStudent': notify, **data}, headers=PRIVATE)


# ───────────────────────── guardian-scoped reads (role 'guardian', read-only) ─────────────────────────
async def guardian_actor(req):
    user = await core.current_user(req, active=True)
    if not user:
        return None, None, err('unauthenticated', 401)
    if user['role'] != 'guardian':
        return None, None, err('forbidden', 403)
    db = await core.pool()
    async with db.acquire() as con:
        profile = await con.fetchrow('SELECT * FROM guardian_profiles WHERE user_id=$1', user['id'])
    if not profile:
        return None, None, err('forbidden', 403)
    fresh = profile['channel_verified_at'] and profile['channel_verified_at'] > datetime.now(timezone.utc) - recheck_window()
    if not fresh:
        state = await channel_status(profile['telegram_user_id'])
        async with db.acquire() as con:
            if state == 'ok':
                await con.execute('UPDATE guardian_profiles SET channel_verified_at=now() WHERE id=$1', profile['id'])
            elif state == 'not_subscribed':
                await con.execute('UPDATE guardian_profiles SET channel_verified_at=NULL WHERE id=$1', profile['id'])
        if state == 'not_subscribed':
            return None, None, core.j({'error': 'channel_required', 'channelUrl': (channel_config() or {}).get('url')}, 403, PRIVATE)
        if state != 'ok':
            return None, None, err('membership_unavailable', 503)  # fail closed, the page shows a retry
    return user, profile, None


async def child_user(con, profile_id, student_id):
    """The ONLY way a student id from a URL becomes trusted: it must be an approved, live link of this guardian."""
    sid = core.uuid_value(student_id)
    if not sid:
        return None
    return await con.fetchrow('''SELECT u.id,u.name,u.email,u.role,u.account_status,u.locale,u.onboarding_completed_at,
              u.status_reason,u.auth_version,l.relationship FROM guardian_links l JOIN users u ON u.id=l.student_id
           WHERE l.guardian_profile_id=$1 AND l.student_id=$2 AND l.status='linked'
             AND u.role='student' AND u.account_status='active' ''', profile_id, sid)


@router.get('/api/guardian/children')
async def guardian_children(req: Request):
    user, profile, failure = await guardian_actor(req)
    if failure:
        return failure
    db = await core.pool()
    async with db.acquire() as con:
        rows = await con.fetch('''SELECT u.id,u.name,l.id AS link_id,l.relationship FROM guardian_links l
            JOIN users u ON u.id=l.student_id WHERE l.guardian_profile_id=$1 AND l.status='linked'
              AND u.role='student' AND u.account_status='active' ORDER BY u.name''', profile['id'])
    return core.j({'ok': True, 'children': [{'studentId': str(r['id']), 'name': r['name'], 'linkId': str(r['link_id']),
                                              'relationship': r['relationship']} for r in rows]}, headers=PRIVATE)


@router.get('/api/guardian/children/{student_id}/progress')
async def guardian_progress(req: Request, student_id: str):
    user, profile, failure = await guardian_actor(req)
    if failure:
        return failure
    region = req.query_params.get('region', '')
    if region not in PROGRESS_REGIONS:
        return err('invalid_region')
    db = await core.pool()
    async with db.acquire() as con:
        child = await child_user(con, profile['id'], student_id)
    if not child:
        return err('forbidden', 403)
    # The SAME read the student's own My Progress page uses, pointed at the verified child. Shape is identical
    # to /api/frontend/view so the existing progress renderers can be reused untouched.
    from .browser_activity import read
    data = await read(req, dict(child), '/app/progress', {}, region)
    return core.j({'version': 1, 'route': '/app/progress', 'region': region,
                   'data': core.row_to_dict({'value': data})['value'],
                   'child': {'studentId': str(child['id']), 'name': child['name']}}, headers=PRIVATE)


@router.get('/api/guardian/children/{student_id}/leaderboard')
async def guardian_leaderboard(req: Request, student_id: str):
    user, profile, failure = await guardian_actor(req)
    if failure:
        return failure
    period = req.query_params.get('period', 'week')
    if period not in PERIODS:
        return err('invalid_filter')
    db = await core.pool()
    async with db.acquire() as con:
        child = await child_user(con, profile['id'], student_id)
        if not child:
            return err('forbidden', 403)
        from zoneinfo import ZoneInfo
        from datetime import time
        from .study_plan_port import COIN_RANKING
        now = datetime.now(timezone.utc)
        local = now.astimezone(ZoneInfo('Asia/Tashkent')).date()
        since = {'week': datetime.combine(local - timedelta(days=local.weekday()), time.min, ZoneInfo('Asia/Tashkent')),
                 'month': now - timedelta(days=30), 'all': datetime(2000, 1, 1, tzinfo=timezone.utc)}[period]
        # Same ranking SQL as the student leaderboard (scope 'all'), evaluated for the child. Only public aliases,
        # ranks and points leave this endpoint: no user ids, names, phones or profiles of other students.
        rows = await con.fetch(COIN_RANKING + '''SELECT alias,points,coins,rank,user_id=$1 AS mine,
              (SELECT rank FROM ranked WHERE user_id=$1) own_rank FROM ranked WHERE rank<=20 OR user_id=$1 ORDER BY rank''',
                               child['id'], since, False)
    standings = [{'rank': r['rank'], 'alias': r['alias'] if not r['mine'] else child['name'], 'stars': r['points'],
                  'coins': r['coins'], 'mine': bool(r['mine'])} for r in rows]
    position = next((s['rank'] for s in standings if s['mine']), None)
    return core.j({'ok': True, 'period': period, 'child': {'studentId': str(child['id']), 'name': child['name']},
                   'position': position, 'standings': standings}, headers=PRIVATE)


# ───────────────────────── staff directory + manual messages ─────────────────────────
async def staff_user(req):
    """Owner/admin can message all guardians; teachers are limited to assigned students."""
    user = await core.current_user(req, active=True)
    if not user:
        return None, err('unauthenticated', 401)
    if user['role'] not in ('owner', 'admin', 'teacher'):
        return None, err('forbidden', 403)
    return user, None


def teacher_assignment_sql(user: dict, parameter: int) -> str:
    """Always use a bound parameter, never an untrusted student or teacher ID."""
    if user['role'] != 'teacher':
        return 'TRUE'
    return (
        'EXISTS (SELECT 1 FROM teacher_student_links assigned '
        'WHERE assigned.student_user_id=l.student_id '
        f'AND assigned.teacher_user_id=${parameter})'
    )


def like(value):
    return '%' + re.sub(r'([\\%_])', r'\\\1', value) + '%'


@router.get('/api/staff/guardians')
async def staff_guardians(req: Request):
    user, failure = await staff_user(req)
    if failure:
        return failure
    q = req.query_params
    try:
        page = max(1, min(500, int(q.get('page', 1))))
        size = max(5, min(50, int(q.get('pageSize', 20))))
    except ValueError:
        return err('invalid_filter')
    status, relationship, channel = q.get('status', 'live'), q.get('relationship', ''), q.get('channel', '')
    if (status not in ('live', 'all', 'linked', 'awaiting_student', 'awaiting_guardian', 'revoked', 'rejected')
            or (relationship and relationship not in RELATIONSHIPS) or channel not in ('', 'joined', 'required')):
        return err('invalid_filter')
    term = clip(q.get('q'), 80)
    where, args = [], []

    def param(value):
        args.append(value)
        return f'${len(args)}'
    if user['role'] == 'teacher':
        where.append(teacher_assignment_sql(user, len(args) + 1))
        args.append(user['id'])
    if status == 'live':
        where.append("l.status IN ('awaiting_guardian','awaiting_student','linked')")
    elif status != 'all':
        where.append(f'l.status={param(status)}')
    if relationship:
        where.append(f'l.relationship={param(relationship)}')
    if channel == 'joined':
        where.append('p.channel_verified_at IS NOT NULL')
    elif channel == 'required':
        where.append('p.channel_verified_at IS NULL')
    if term:
        needle = param(like(term))  # one bound parameter, escaped wildcards: no SQL built from user text
        where.append(f"(s.name ILIKE {needle} ESCAPE '\\' OR p.display_name ILIKE {needle} ESCAPE '\\' OR t.username ILIKE {needle} ESCAPE '\\')")
    clause = ' WHERE ' + ' AND '.join(where) if where else ''
    base = '''FROM guardian_links l JOIN guardian_profiles p ON p.id=l.guardian_profile_id
              JOIN users s ON s.id=l.student_id LEFT JOIN telegram_contacts t ON t.telegram_user_id=p.telegram_user_id'''
    db = await core.pool()
    async with db.acquire() as con:
        total = await con.fetchval('SELECT count(*)::int ' + base + clause, *args)
        rows = await con.fetch(f'''SELECT l.id,l.status,l.relationship,l.requested_at,l.updated_at,s.name AS student_name,
              p.display_name,p.telegram_user_id,p.channel_verified_at,t.username,t.phone_number,t.phone_verified_at {base} {clause}
              ORDER BY l.updated_at DESC, l.id LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}''', *args, size, (page - 1) * size)
        metric_scope = (' WHERE ' + teacher_assignment_sql(user, 1)) if user['role'] == 'teacher' else ''
        scope_args = (user['id'],) if user['role'] == 'teacher' else ()
        metrics = await con.fetchrow('''SELECT
              count(*) FILTER (WHERE l.status='linked')::int linked,
              count(*) FILTER (WHERE l.status='awaiting_student')::int awaiting,
              count(*) FILTER (WHERE l.status='awaiting_guardian' AND p.channel_verified_at IS NULL)::int channel_required
            FROM guardian_links l JOIN guardian_profiles p ON p.id=l.guardian_profile_id''' + metric_scope, *scope_args)
        sent = await con.fetchval(
            "SELECT count(*)::int FROM guardian_message_deliveries d "
            "JOIN guardian_links l ON l.id=d.link_id WHERE d.status='sent'"
            + ((' AND ' + teacher_assignment_sql(user, 1)) if user['role'] == 'teacher' else ''),
            *scope_args,
        )
    items = [{'linkId': str(r['id']), 'status': r['status'], 'relationship': r['relationship'],
              'studentName': r['student_name'], 'guardianName': r['display_name'],
              'telegram': ('@' + r['username'] + ' · ID ' + r['telegram_user_id']) if r['username'] else 'ID ' + r['telegram_user_id'],
              'phone': mask_phone(r['phone_number']) if r['phone_verified_at'] else None,
              'channelJoined': r['channel_verified_at'] is not None, 'updatedAt': iso(r['updated_at'])} for r in rows]
    return core.j({'ok': True, 'page': page, 'pageSize': size, 'total': total, 'items': items,
                   'metrics': {'linked': metrics['linked'], 'awaitingApproval': metrics['awaiting'],
                               'channelRequired': metrics['channel_required'], 'manualMessagesSent': sent}}, headers=PRIVATE)


@router.get('/api/staff/guardians/{link_id}')
async def staff_guardian_detail(req: Request, link_id: str):
    user, failure = await staff_user(req)
    if failure:
        return failure
    if not core.uuid_value(link_id):
        return err('not_found', 404)
    db = await core.pool()
    async with db.acquire() as con:
        assignment = (' AND ' + teacher_assignment_sql(user, 2)) if user['role'] == 'teacher' else ''
        detail_args = (link_id, user['id']) if user['role'] == 'teacher' else (link_id,)
        r = await con.fetchrow('''SELECT l.*,s.name AS student_name,p.display_name,p.telegram_user_id,p.channel_verified_at,
               p.language,t.username,t.phone_number,t.phone_verified_at
            FROM guardian_links l JOIN guardian_profiles p ON p.id=l.guardian_profile_id JOIN users s ON s.id=l.student_id
            LEFT JOIN telegram_contacts t ON t.telegram_user_id=p.telegram_user_id WHERE l.id=$1''' + assignment, *detail_args)
        if not r:
            return err('not_found', 404)
        history_scope = ' AND b.sender_user_id=$2' if user['role'] != 'owner' else ''
        history_args = (link_id, user['id']) if user['role'] != 'owner' else (link_id,)
        history = await con.fetch('''SELECT d.id,d.status,d.attempts,d.sent_at,d.created_at,d.last_error,b.template_key
            FROM guardian_message_deliveries d JOIN guardian_message_batches b ON b.id=d.batch_id
            WHERE d.link_id=$1''' + history_scope + ' ORDER BY d.created_at DESC LIMIT 30', *history_args)
        await audit(con, 'guardian.detail.viewed', actor_user_id=user['id'], link_id=r['id'], student_id=r['student_id'])
    return core.j({'ok': True, 'link': {
        'linkId': str(r['id']), 'status': r['status'], 'relationship': r['relationship'], 'studentName': r['student_name'],
        'guardianName': r['display_name'], 'telegramUsername': r['username'],
        'telegramUserId': r['telegram_user_id'] if user['role'] == 'owner' else mask_tg(r['telegram_user_id']),
        'phone': (r['phone_number'] if user['role'] == 'owner' else mask_phone(r['phone_number']))
                 if r['phone_verified_at'] else None, 'channelJoined': r['channel_verified_at'] is not None,
        'language': r['language'], 'requestedAt': iso(r['requested_at']), 'approvedAt': iso(r['approved_at']),
        'revokedAt': iso(r['revoked_at'])},
        'messages': [{'deliveryId': str(h['id']), 'status': h['status'], 'attempts': h['attempts'], 'template': h['template_key'],
                      'sentAt': iso(h['sent_at']), 'createdAt': iso(h['created_at']), 'error': h['last_error']} for h in history]},
        headers=PRIVATE)


@router.get('/api/staff/guardian-message-templates')
async def staff_templates(req: Request):
    user, failure = await staff_user(req)
    if failure:
        return failure
    return core.j({'ok': True, 'templates': TEMPLATES, 'placeholders': list(ALLOWED_PLACEHOLDERS)}, headers=PRIVATE)


def render(body, student_name, relationship, language):
    labels = RELATION_LABEL.get(language if language in ('uz', 'en') else 'uz')
    values = {'student_name': student_name or '', 'guardian_relation': labels.get(relationship, '')}
    # Plain substitution of a closed set of names: no format-string evaluation, nothing injectable.
    return re.sub(r'\{(student_name|guardian_relation)\}', lambda m: values[m.group(1)], body)


def validate_message(body):
    text = clean_text(body.get('body'))
    if not text or len(text) > MAX_BODY:
        return None, 'invalid_body'
    unknown = set(re.findall(r'\{([^{}]*)\}', text)) - set(ALLOWED_PLACEHOLDERS)
    if unknown:
        return None, 'unknown_placeholder'
    key = body.get('templateKey')
    if key is not None and key not in TEMPLATE_KEYS:
        return None, 'invalid_template'
    ids = body.get('linkIds')
    if (not isinstance(ids, list) or not ids or len(ids) > MAX_RECIPIENTS
            or not all(isinstance(i, str) and core.uuid_value(i) for i in ids)):
        return None, 'invalid_recipients'
    return {'text': text, 'key': key, 'ids': list(dict.fromkeys(ids))}, None


ELIGIBLE = '''SELECT l.id AS link_id,l.relationship,s.id AS student_id,s.name AS student_name,p.id AS profile_id,
       p.telegram_user_id,p.language
  FROM guardian_links l JOIN guardian_profiles p ON p.id=l.guardian_profile_id
  JOIN users s ON s.id=l.student_id JOIN users g ON g.id=p.user_id
  JOIN telegram_contacts t ON t.telegram_user_id=p.telegram_user_id
 WHERE l.id = ANY($1::uuid[]) AND l.status='linked' AND s.role='student' AND s.account_status='active'
   AND g.role='guardian' AND g.account_status='active' AND t.bot_blocked_at IS NULL AND t.removed_at IS NULL
   AND t.chat_id IS NOT NULL AND p.channel_verified_at IS NOT NULL'''


def scoped_eligible_query(user: dict, link_ids: list[str], *, lock: bool = False) -> tuple[str, tuple]:
    """Keep teacher assignments enforced identically in preview and final send."""
    query = ELIGIBLE
    params = (link_ids,)
    if user['role'] == 'teacher':
        query += ' AND ' + teacher_assignment_sql(user, 2)
        params += (user['id'],)
    if lock:
        query += ' FOR SHARE OF l'
    return query, params



@router.post('/api/staff/guardian-messages/preview')
async def staff_preview(req: Request):
    user, failure = await staff_user(req)
    if failure:
        return failure
    body = await core.payload(req)
    message, error = validate_message(body if isinstance(body, dict) else {})
    if error:
        return err(error)
    db = await core.pool()
    query, params = scoped_eligible_query(user, message['ids'])
    async with db.acquire() as con:  # read-only: preview writes nothing and sends nothing
        rows = await con.fetch(query, *params)
    ok = {str(r['link_id']): r for r in rows}
    skipped = [{'linkId': i, 'reason': 'not_eligible'} for i in message['ids'] if i not in ok]
    sample = [{'linkId': str(r['link_id']), 'studentName': r['student_name'],
               'text': render(message['text'], r['student_name'], r['relationship'], r['language'])} for r in rows[:20]]
    return core.j({'ok': True, 'count': len(rows), 'sample': sample, 'skipped': skipped}, headers=PRIVATE)


@router.post('/api/staff/guardian-messages/send')
async def staff_send(req: Request):
    user, failure = await staff_user(req)
    if failure:
        return failure
    body = await core.payload(req)
    body = body if isinstance(body, dict) else {}
    if body.get('confirm') is not True:  # the explicit human confirmation; nothing is queued without it
        return err('confirmation_required', 400)
    key = body.get('idempotencyKey')
    if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', key):
        return err('invalid_idempotency_key')
    message, error = validate_message(body)
    if error:
        return err(error)
    RULES.setdefault('guardian_send', (12, 600))
    delay = await counter('guardian_send', 'u:' + str(user['id']), consume=True)
    if delay:
        return too_many(delay)
    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            existing = await con.fetchrow('SELECT id,recipient_count FROM guardian_message_batches WHERE sender_user_id=$1 AND idempotency_key=$2',
                                          user['id'], key)
            if existing:  # double click / retry: report the same batch, queue nothing new
                return core.j({'ok': True, 'duplicate': True, 'batchId': str(existing['id']),
                               'queued': existing['recipient_count']}, headers=PRIVATE)
            query, params = scoped_eligible_query(user, message['ids'], lock=True)
            rows = await con.fetch(query, *params)
            if not rows:
                return err('no_eligible_recipients', 409)
            batch = await con.fetchval('''INSERT INTO guardian_message_batches(sender_user_id,idempotency_key,template_key,body_template,recipient_count)
                VALUES($1,$2,$3,$4,$5) RETURNING id''', user['id'], key, message['key'], message['text'], len(rows))
            await con.executemany('''INSERT INTO guardian_message_deliveries(batch_id,link_id,guardian_profile_id,student_id,telegram_user_id,rendered_text)
                VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (batch_id,guardian_profile_id,student_id) DO NOTHING''',
                                  [(batch, r['link_id'], r['profile_id'], r['student_id'], r['telegram_user_id'],
                                    render(message['text'], r['student_name'], r['relationship'], r['language'])) for r in rows])
            await audit(con, 'guardian.message.approved', actor_user_id=user['id'], metadata={
                'batchId': str(batch), 'recipients': len(rows), 'template': message['key']})
    return core.j({'ok': True, 'duplicate': False, 'batchId': str(batch), 'queued': len(rows),
                   'skipped': len(message['ids']) - len(rows)}, 201, PRIVATE)


@router.get('/api/staff/guardian-messages/{batch_id}')
async def staff_batch(req: Request, batch_id: str):
    user, failure = await staff_user(req)
    if failure:
        return failure
    if not core.uuid_value(batch_id):
        return err('not_found', 404)
    db = await core.pool()
    async with db.acquire() as con:
        batch_query = 'SELECT id,approved_at,recipient_count,template_key FROM guardian_message_batches WHERE id=$1'
        batch_args = (batch_id,)
        if user['role'] != 'owner':
            batch_query += ' AND sender_user_id=$2'
            batch_args += (user['id'],)
        batch = await con.fetchrow(batch_query, *batch_args)
        if not batch:
            return err('not_found', 404)
        counts = await con.fetch('SELECT status,count(*)::int n FROM guardian_message_deliveries WHERE batch_id=$1 GROUP BY status', batch_id)
    summary = {s: 0 for s in ('queued', 'sending', 'sent', 'failed', 'blocked')}
    summary.update({r['status']: r['n'] for r in counts})
    return core.j({'ok': True, 'batchId': str(batch['id']), 'approvedAt': iso(batch['approved_at']),
                   'recipientCount': batch['recipient_count'], 'statuses': summary}, headers=PRIVATE)


# ───────────────────────── delivery worker: retries of APPROVED rows only ─────────────────────────
MAX_ATTEMPTS = 4


@router.post('/api/internal/telegram/guardians/deliveries/claim')
async def bot_claim_deliveries(req: Request):
    body, denied = await bot_body(req)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as con:
        results = body.get('results')
        if isinstance(results, list):
            for item in results[:50]:
                if not isinstance(item, dict) or not core.uuid_value(item.get('deliveryId')):
                    continue
                status = item.get('status')
                if status == 'sent':
                    await con.execute('''UPDATE guardian_message_deliveries SET status='sent',sent_at=now(),telegram_message_id=$2,last_error=NULL
                        WHERE id=$1 AND status='sending' ''', item['deliveryId'], clip(item.get('telegramMessageId'), 32))
                elif status == 'blocked':
                    await con.execute('''UPDATE guardian_message_deliveries SET status='blocked',last_error=$2 WHERE id=$1 AND status='sending' ''',
                                      item['deliveryId'], clip(item.get('error'), 120) or 'blocked')
                else:  # failed: retry the SAME approved row with back-off, then give up honestly
                    wait = item.get('retryAfterSeconds')
                    wait = int(wait) if isinstance(wait, (int, float)) and 0 < wait < 3600 else None
                    await con.execute('''UPDATE guardian_message_deliveries SET
                          status=CASE WHEN attempts>=$3 THEN 'failed' ELSE 'queued' END,
                          next_attempt_at=now()+make_interval(secs => COALESCE($4::int, LEAST(900, 30*attempts*attempts))),
                          last_error=$2 WHERE id=$1 AND status='sending' ''',
                                      item['deliveryId'], clip(item.get('error'), 120) or 'delivery_failed', MAX_ATTEMPTS, wait)
            return core.j({'ok': True}, headers=PRIVATE)
        limit = max(1, min(20, int(body.get('limit', 10)))) if isinstance(body.get('limit', 10), (int, float)) else 10
        async with con.transaction():
            await con.execute('''UPDATE guardian_message_deliveries
                SET status='failed',last_error='max_attempts_exceeded'
                WHERE attempts >= $1
                AND (status='queued' OR (status='sending' AND claimed_at < now()-interval '5 minutes'))''',
                MAX_ATTEMPTS)
            rows = await con.fetch('''WITH picked AS (
                  SELECT id FROM guardian_message_deliveries
                   WHERE attempts < $2 AND (
                     (status='queued' AND next_attempt_at<=now())
                     OR (status='sending' AND claimed_at<now()-interval '5 minutes'))
                   ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
                UPDATE guardian_message_deliveries d SET status='sending',attempts=d.attempts+1,claimed_at=now()
                  FROM picked WHERE d.id=picked.id RETURNING d.id,d.link_id,d.telegram_user_id,d.rendered_text''',
                limit, MAX_ATTEMPTS)
            out = []
            for r in rows:
                # Fail closed at send time: a revoked/blocked recipient must not receive an already-queued message.
                chat = await con.fetchval('''SELECT t.chat_id
                    FROM guardian_message_deliveries d
                    JOIN guardian_message_batches b ON b.id=d.batch_id
                    JOIN users sender ON sender.id=b.sender_user_id
                    JOIN guardian_links l ON l.id=d.link_id
                    JOIN guardian_profiles p ON p.id=l.guardian_profile_id
                    JOIN users guardian ON guardian.id=p.user_id
                    JOIN users student ON student.id=l.student_id
                    JOIN telegram_contacts t ON t.telegram_user_id=p.telegram_user_id
                    WHERE d.id=$1 AND l.status='linked'
                      AND sender.account_status='active' AND sender.role IN ('owner','admin','teacher')
                      AND student.role='student' AND student.account_status='active'
                      AND guardian.role='guardian' AND guardian.account_status='active'
                      AND p.channel_verified_at IS NOT NULL
                      AND t.bot_blocked_at IS NULL AND t.removed_at IS NULL
                      AND (sender.role IN ('owner','admin') OR EXISTS (
                        SELECT 1 FROM teacher_student_links assigned
                        WHERE assigned.teacher_user_id=sender.id
                          AND assigned.student_user_id=l.student_id))''', r['id'])
                if not chat:
                    await con.execute("UPDATE guardian_message_deliveries SET status='blocked',last_error='link_inactive' WHERE id=$1", r['id'])
                    continue
                out.append({'deliveryId': str(r['id']), 'chatId': chat, 'text': r['rendered_text']})
    return core.j({'ok': True, 'deliveries': out}, headers=PRIVATE)



# ───────────────────────── two-way manually triggered guardian messages ─────────────────────────
async def conversation_context(con, delivery_id):
    """Bind a conversation to its original approved message and live staff assignment."""
    return await con.fetchrow('''SELECT d.id,d.link_id,d.telegram_user_id,p.display_name AS guardian_name,
        gu.account_status AS guardian_status,b.sender_user_id,su.name AS sender_name,
        su.role AS sender_role,su.account_status AS sender_status,su.telegram_id AS sender_telegram_id,
        l.status AS link_status,l.student_id,
        gc.chat_id AS guardian_chat,gc.bot_blocked_at AS guardian_blocked,
        gc.removed_at AS guardian_removed,
        sc.chat_id AS staff_chat,sc.bot_blocked_at AS staff_blocked,
        sc.removed_at AS staff_removed,d.status AS original_status
      FROM guardian_message_deliveries d
      JOIN guardian_message_batches b ON b.id=d.batch_id
      JOIN guardian_links l ON l.id=d.link_id
      JOIN guardian_profiles p ON p.id=d.guardian_profile_id
      JOIN users gu ON gu.id=p.user_id AND gu.role='guardian'
      JOIN users su ON su.id=b.sender_user_id
      LEFT JOIN telegram_contacts gc ON gc.telegram_user_id=d.telegram_user_id
      LEFT JOIN telegram_contacts sc ON sc.telegram_user_id=su.telegram_id
      WHERE d.id=$1''', delivery_id)


async def conversation_active(con, row):
    if not row or row['original_status'] != 'sent' or row['link_status'] != 'linked':
        return False
    if row['guardian_status'] != 'active' or row['sender_status'] != 'active':
        return False
    if row['sender_role'] not in ('teacher', 'admin', 'owner'):
        return False
    if row['sender_role'] == 'teacher':
        assigned = await con.fetchval('''SELECT 1 FROM teacher_student_links
            WHERE teacher_user_id=$1 AND student_user_id=$2 LIMIT 1''',
            row['sender_user_id'], row['student_id'])
        if not assigned:
            return False
    return True


@router.post('/api/internal/telegram/guardians/replies')
async def bot_guardian_reply(req: Request):
    body, denied = await bot_body(req)
    if denied is not None:
        return denied
    actor = body.get('actorTelegramId')
    delivery_id = core.uuid_value(body.get('deliveryId'))
    incoming_id = body.get('incomingMessageId')
    message = clean_text(body.get('text'))
    if (not valid_actor(actor) or not delivery_id or
            not isinstance(incoming_id, str) or not re.fullmatch(r'[1-9][0-9]{0,19}', incoming_id) or
            not 1 <= len(message) <= MAX_BODY):
        return err('invalid_input', 400)
    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            row = await conversation_context(con, delivery_id)
            if not await conversation_active(con, row):
                return err('conversation_unavailable', 409)
            guardian = actor == row['telegram_user_id']
            staff = actor == row['sender_telegram_id']
            if guardian == staff:
                return err('forbidden', 403)
            if guardian and (not row['guardian_chat'] or row['guardian_blocked'] or row['guardian_removed']):
                return err('conversation_unavailable', 409)
            if staff and (not row['staff_chat'] or row['staff_blocked'] or row['staff_removed']):
                return err('conversation_unavailable', 409)
            if guardian and (not row['staff_chat'] or row['staff_blocked'] or row['staff_removed']):
                return err('recipient_unavailable', 409)
            if staff and (not row['guardian_chat'] or row['guardian_blocked'] or row['guardian_removed']):
                return err('recipient_unavailable', 409)
            reply = await con.fetchval('''INSERT INTO guardian_message_replies
                (delivery_id,actor_telegram_id,source_message_id,sender_kind,body)
                VALUES($1,$2,$3,$4,$5)
                ON CONFLICT (actor_telegram_id,source_message_id) DO NOTHING RETURNING id''',
                delivery_id, actor, incoming_id, 'guardian' if guardian else 'staff', message)
            if reply is None:
                previous = await con.fetchrow('''SELECT id,delivery_id FROM guardian_message_replies
                    WHERE actor_telegram_id=$1 AND source_message_id=$2''', actor, incoming_id)
                if not previous or previous['delivery_id'] != delivery_id:
                    return err('replay_conflict', 409)
                return core.j({'ok': True, 'duplicate': True, 'replyId': str(previous['id'])}, headers=PRIVATE)
            await audit(con, 'guardian.message.reply_queued',
                actor_user_id=row['sender_user_id'] if staff else None,
                actor_telegram_id=actor, link_id=row['link_id'], student_id=row['student_id'],
                metadata={'deliveryId': str(delivery_id), 'replyId': str(reply)})
    return core.j({'ok': True, 'duplicate': False, 'replyId': str(reply)}, headers=PRIVATE)


@router.post('/api/internal/telegram/guardians/replies/claim')
async def bot_claim_guardian_replies(req: Request):
    body, denied = await bot_body(req)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as con:
        results = body.get('results')
        if isinstance(results, list):
            for item in results[:50]:
                if not isinstance(item, dict) or not core.uuid_value(item.get('replyId')):
                    continue
                status = item.get('status')
                if status == 'sent':
                    await con.execute('''UPDATE guardian_message_replies SET status='sent',
                      sent_at=now(), telegram_message_id=$2,last_error=NULL
                      WHERE id=$1 AND status='sending' ''', item['replyId'], clip(item.get('telegramMessageId'), 32))
                elif status == 'blocked':
                    await con.execute('''UPDATE guardian_message_replies SET status='blocked',last_error='recipient_blocked'
                      WHERE id=$1 AND status='sending' ''', item['replyId'])
                else:
                    retry_after = item.get('retryAfterSeconds')
                    retry_after = int(retry_after) if isinstance(retry_after, (int, float)) and 0 < retry_after < 3600 else None
                    await con.execute('''UPDATE guardian_message_replies SET
                      status=CASE WHEN attempts >= $2 THEN 'failed' ELSE 'queued' END,
                      next_attempt_at=now()+make_interval(secs => COALESCE($3::int, LEAST(900,30*attempts*attempts))),
                      last_error='delivery_failed' WHERE id=$1 AND status='sending' ''',
                      item['replyId'], MAX_ATTEMPTS, retry_after)
            return core.j({'ok': True}, headers=PRIVATE)
        async with con.transaction():
            await con.execute('''UPDATE guardian_message_replies
                SET status='failed',last_error='max_attempts_exceeded'
                WHERE attempts >= $1 AND (status='queued' OR
                  (status='sending' AND claimed_at < now()-interval '5 minutes'))''', MAX_ATTEMPTS)
            picked = await con.fetch('''WITH picked AS (
                SELECT id FROM guardian_message_replies
                WHERE attempts < $2 AND ((status='queued' AND next_attempt_at<=now())
                   OR (status='sending' AND claimed_at < now()-interval '5 minutes'))
                ORDER BY created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)
                UPDATE guardian_message_replies r
                SET status='sending', attempts=r.attempts+1,claimed_at=now()
                FROM picked WHERE r.id=picked.id
                RETURNING r.id,r.delivery_id,r.sender_kind,r.body''', 10, MAX_ATTEMPTS)
            items = []
            for reply in picked:
                context = await conversation_context(con, reply['delivery_id'])
                if not await conversation_active(con, context):
                    await con.execute("UPDATE guardian_message_replies SET status='blocked',last_error='conversation_inactive' WHERE id=$1", reply['id'])
                    continue
                guardian = reply['sender_kind'] == 'guardian'
                chat = context['staff_chat'] if guardian else context['guardian_chat']
                blocked = context['staff_blocked'] if guardian else context['guardian_blocked']
                removed = context['staff_removed'] if guardian else context['guardian_removed']
                if not chat or blocked or removed:
                    await con.execute("UPDATE guardian_message_replies SET status='blocked',last_error='recipient_unavailable' WHERE id=$1", reply['id'])
                    continue
                if guardian:
                    role_name = {'owner': 'Owner', 'admin': 'Admin', 'teacher': 'Teacher'}[context['sender_role']]
                    display = f"{role_name} yuborgan xabarga javob\\n{context['guardian_name'] or 'Ota-ona'}:\\n{reply['body']}"
                else:
                    role_name = {'owner': 'Owner', 'admin': 'Admin', 'teacher': 'Teacher'}[context['sender_role']]
                    display = f"{role_name} javobi:\\n{reply['body']}"
                items.append({'replyId': str(reply['id']), 'deliveryId': str(reply['delivery_id']),
                              'chatId': chat, 'text': display})
    return core.j({'ok': True, 'replies': items}, headers=PRIVATE)



def install():
    core.app.include_router(router)
