"""Partner discovery, private relationships and call activities."""
from __future__ import annotations

import json
from datetime import timedelta

from . import main as core

GENDERS = {'any', 'male', 'female'}
LEVELS = {'any', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'}
ACTIVITIES = {'question', 'picture', 'taboo', 'truths', 'mock'}
ACTIONS = {'search', 'stop_search', 'friend_request', 'friend_accept', 'friend_remove',
           'rating', 'report', 'activity_start', 'activity_next', 'activity_stop', 'mock_score'}
MOCK_SECONDS = (60, 60, 120, 90)
SEARCH_TTL = timedelta(seconds=60)
PROMPT_FILTER = """publication_state='published' AND is_active
    AND (available_in @> '["practice_alone"]'::jsonb OR available_in @> '["live_partner"]'::jsonb)"""


async def available(con):
    return bool(await con.fetchval("SELECT to_regclass('public.live_partner_queue')"))


def valid(body):
    action = body['action']
    if action == 'search':
        return (isinstance(body.get('gender'), str) and body['gender'] in GENDERS
                and isinstance(body.get('level'), str) and body['level'] in LEVELS)
    if action == 'stop_search':
        return True
    if action.startswith('friend_'):
        return core.uuid_value(body.get('userId')) is not None
    if core.uuid_value(body.get('sessionId')) is None:
        return False
    if action == 'rating':
        return type(body.get('rating')) is int and 2 <= body['rating'] <= 18
    if action == 'report':
        return body.get('reason') in ('abuse', 'spam', 'other')
    if type(body.get('version')) is not int or not 0 <= body['version'] < 2**31-1:
        return False
    if action == 'activity_start':
        kind = body.get('kind')
        return (isinstance(kind, str) and kind in ACTIVITIES
                and (kind != 'question' or core.uuid_value(body.get('questionId')) is not None))
    if action == 'mock_score':
        bands = body.get('bands')
        return (isinstance(bands, list) and len(bands) == 4
                and all(type(value) is int and 0 <= value <= 18 for value in bands))
    return True


async def clear_search(con, uid):
    await con.execute('DELETE FROM live_partner_queue WHERE user_id=$1', uid)


async def find_partner(con, uid, body, now):
    from .step24_live_partner import FRESH, PartnerError, fresh, invite, lock_presence

    # Serialize match selection. Invitations use the same ordered presence row
    # locks, so a concurrent manual dial can win without creating two calls.
    await con.execute('SELECT pg_advisory_xact_lock(1490728103)')
    peer = await con.fetchval('''SELECT q.user_id FROM live_partner_queue q
      JOIN live_partner_presence p ON p.user_id=q.user_id
      JOIN users u ON u.id=q.user_id
      JOIN users me ON me.id=$1
      LEFT JOIN onboarding_profiles mine ON mine.user_id=me.id
      LEFT JOIN onboarding_profiles theirs ON theirs.user_id=u.id
      WHERE q.user_id<>$1 AND q.expires_at>$5 AND p.state='available' AND p.heartbeat_at>$2
        AND u.account_status='active'
        AND ($3='any' OR u.gender::text=$3)
        AND ($4='any' OR theirs.current_level::text=$4)
        AND (q.gender='any' OR me.gender::text=q.gender)
        AND (q.level='any' OR mine.current_level::text=q.level)
        AND NOT EXISTS (SELECT 1 FROM live_partner_blocks b
           WHERE (b.blocker_id=$1 AND b.blocked_id=q.user_id) OR (b.blocker_id=q.user_id AND b.blocked_id=$1))
      ORDER BY q.joined_at,q.user_id LIMIT 1''', uid, now-FRESH, body['gender'], body['level'], now)
    target = str(peer) if peer else None
    rows = await lock_presence(con, [uid, target] if target else [uid], now)
    own = rows[uid]
    if own['state'] != 'available' or not fresh(own['heartbeat_at'], now):
        raise PartnerError('not_available')
    queued = target and await con.fetchval('SELECT user_id FROM live_partner_queue WHERE user_id=$1 AND expires_at>$2 FOR UPDATE', target, now)
    if queued and rows[target]['state'] == 'available' and fresh(rows[target]['heartbeat_at'], now):
        try:
            await invite(con, uid, target, now, rows)
        except PartnerError as error:
            if error.code != 'partner_busy':
                raise
        else:
            await clear_search(con, uid)
            await clear_search(con, target)
            return
    await con.execute('''INSERT INTO live_partner_queue(user_id,gender,level,joined_at,expires_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE
      SET gender=excluded.gender, level=excluded.level, joined_at=excluded.joined_at, expires_at=excluded.expires_at''',
      uid, body['gender'], body['level'], now, now+SEARCH_TTL)


async def relationship(con, uid, target, action, now):
    from .step24_live_partner import PartnerError

    if uid == target:
        raise PartnerError('invalid_target')
    a, b = sorted((uid, target))
    if action == 'friend_remove':
        await con.execute('DELETE FROM live_partner_friends WHERE user_a=$1 AND user_b=$2', a, b)
        return
    # Both accounts must be active, have actually spoken and allow each other.
    allowed = await con.fetchval('''SELECT EXISTS(
      SELECT 1 FROM live_partner_sessions s JOIN users u ON u.id=$2
      WHERE ((s.user_a=$1 AND s.user_b=$2) OR (s.user_a=$2 AND s.user_b=$1))
        AND s.connected_at IS NOT NULL AND s.ended_at IS NOT NULL AND u.account_status='active'
        AND NOT EXISTS(SELECT 1 FROM live_partner_blocks b
            WHERE (b.blocker_id=$1 AND b.blocked_id=$2) OR (b.blocker_id=$2 AND b.blocked_id=$1)))''', uid, target)
    if not allowed:
        raise PartnerError('invalid_target')
    if action == 'friend_request':
        await con.execute('''INSERT INTO live_partner_friends(user_a,user_b,requested_by)
          VALUES($1,$2,$3) ON CONFLICT DO NOTHING''', a, b, uid)
    else:
        await con.execute('''UPDATE live_partner_friends SET accepted_at=$3
          WHERE user_a=$1 AND user_b=$2 AND requested_by=$4 AND accepted_at IS NULL''', a, b, now, target)


def activity_content(row):
    content = row['content']
    return json.loads(content) if isinstance(content, str) else dict(content)


async def start_activity(con, uid, sid, body, now, version):
    from .step24_live_partner import PartnerError

    kind = body['kind']
    if kind == 'question':
        question = await con.fetchrow(f'''SELECT part,prompt_text,cue_card
          FROM speaking_prompts WHERE id=$1 AND {PROMPT_FILTER}''', str(body['questionId']))
        if not question:
            raise PartnerError('activity_question_missing')
        return {'kind':kind, 'owner':uid, 'question':dict(question)}
    if kind == 'mock':
        rows = await con.fetch(f'''SELECT DISTINCT ON(part) part,prompt_text,cue_card
          FROM speaking_prompts WHERE {PROMPT_FILTER} AND part IN ('part1','part2','part3')
          ORDER BY part,md5(id::text || $1)''', sid)
        if len(rows) != 3:
            raise PartnerError('activity_question_missing')
        questions = {row['part']:dict(row) for row in rows}
        return {'kind':kind, 'owner':uid, 'questions':[questions[p] for p in ('part1','part2','part3')],
                'phase':'proposal', 'step':0}
    return {'kind':kind, 'owner':uid, 'variant':version % 3}


async def change_activity(con, uid, call, body, now):
    from .step24_live_partner import PartnerError, iso

    sid = str(call['id'])
    if call['ended_at'] or not call['connected_at']:
        raise PartnerError('session_ended')
    row = await con.fetchrow('SELECT version,content FROM live_partner_activities WHERE session_id=$1', sid)
    version = row['version'] if row else 0
    if body['version'] != version:
        raise PartnerError('activity_changed')
    current = activity_content(row) if row else {}
    action = body['action']
    if action == 'activity_start':
        if current.get('kind') == 'mock' and current.get('phase') not in ('scoring', 'finished'):
            raise PartnerError('activity_in_progress')
        current = await start_activity(con, uid, sid, body, now, version+1)
    elif action == 'activity_stop':
        current = {}
    else:
        if current.get('kind') != 'mock':
            raise PartnerError('activity_changed')
        phase = current['phase']
        examiner = current['owner'] == uid
        if action == 'mock_score' and examiner and phase == 'scoring':
            current.update(phase='finished', bands=body['bands'])
        elif action == 'activity_next' and phase == 'proposal' and not examiner:
            current.update(phase='running', endsAt=iso(now+timedelta(seconds=MOCK_SECONDS[0])))
        elif action == 'activity_next' and phase == 'running' and examiner:
            step = current['step']+1
            if step < len(MOCK_SECONDS):
                current.update(step=step, endsAt=iso(now+timedelta(seconds=MOCK_SECONDS[step])))
            else:
                current.update(phase='scoring', endsAt=None)
        else:
            raise PartnerError('activity_changed')
    await con.execute('''INSERT INTO live_partner_activities(session_id,version,content,updated_at,last_mock)
      VALUES($1,$2,$3::jsonb,$4,$5::jsonb) ON CONFLICT(session_id) DO UPDATE
      SET version=excluded.version,content=excluded.content,updated_at=excluded.updated_at,
          last_mock=coalesce(excluded.last_mock,live_partner_activities.last_mock)''',
      sid, version+1, json.dumps(current), now, json.dumps(current) if action == 'mock_score' else None)


async def perform(con, uid, body, now):
    from .step24_live_partner import PartnerError, session

    action = body['action']
    if action == 'search':
        await find_partner(con, uid, body, now)
    elif action == 'stop_search':
        await clear_search(con, uid)
    elif action.startswith('friend_'):
        await relationship(con, uid, str(core.uuid_value(body['userId'])), action, now)
    else:
        call = await session(con, uid, str(core.uuid_value(body['sessionId'])))
        if action in ('rating', 'report'):
            if not call['ended_at'] or not call['connected_at']:
                raise PartnerError('session_not_finished')
            await con.execute('''INSERT INTO live_partner_feedback(session_id,user_id,kind,rating,reason)
              VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,user_id,kind) DO NOTHING''',
              str(call['id']), uid, action, body.get('rating') if action == 'rating' else None,
              body.get('reason') if action == 'report' else None)
        else:
            await change_activity(con, uid, call, body, now)


async def details(con, uid, state, now):
    from .step24_live_partner import iso

    row = await con.fetchrow('SELECT expires_at FROM live_partner_queue WHERE user_id=$1 AND expires_at>$2', uid, now)
    activity = await con.fetchrow('SELECT version,content FROM live_partner_activities WHERE session_id=$1', state['sessionId']) if state['sessionId'] else None
    last = await con.fetchrow('''SELECT id,status FROM live_partner_invites WHERE from_user_id=$1
      AND responded_at>$2 ORDER BY responded_at DESC LIMIT 1''', uid, now-timedelta(minutes=1))
    return {'enabled':True, 'searchUntil':iso(row['expires_at']) if row else None,
            'activity':{'version':activity['version'], **activity_content(activity)} if activity else {'version':0},
            'lastInvite':{'id':str(last['id']), 'status':last['status']} if last else None}


async def history(con, uid):
    from .step24_live_partner import iso

    stats = await con.fetchrow('''SELECT count(*) AS calls,
      coalesce(sum(extract(epoch FROM ended_at-connected_at)),0)::bigint AS seconds
      FROM live_partner_sessions WHERE (user_a=$1 OR user_b=$1)
        AND connected_at IS NOT NULL AND ended_at IS NOT NULL''', uid)
    # Each rating is the partner's IELTS band in half-band units (2..18).
    # Do not include ratings this user has given to others.
    band_stats = await con.fetchrow('''SELECT
      round(avg(f.rating::numeric)/2,1) AS average_band,
      count(*)::int AS rating_count
      FROM live_partner_feedback f
      JOIN live_partner_sessions s ON s.id=f.session_id
      WHERE f.kind='rating' AND f.user_id<>$1
        AND (s.user_a=$1 OR s.user_b=$1)
        AND s.connected_at IS NOT NULL AND s.ended_at IS NOT NULL''', uid)
    recent = await con.fetch('''SELECT s.id,u.id AS peer,u.name,s.ended_at,
      extract(epoch FROM s.ended_at-s.connected_at)::int AS seconds,
      EXISTS(SELECT 1 FROM live_partner_feedback f WHERE f.session_id=s.id AND f.user_id=$1 AND f.kind='rating') AS rated,
      EXISTS(SELECT 1 FROM live_partner_feedback f WHERE f.session_id=s.id AND f.user_id=$1 AND f.kind='report') AS reported,
      (SELECT f.rating::numeric/2 FROM live_partner_feedback f WHERE f.session_id=s.id
         AND f.kind='rating' AND f.user_id=u.id) AS peer_rating
      FROM live_partner_sessions s
      JOIN users u ON u.id=CASE WHEN s.user_a=$1 THEN s.user_b ELSE s.user_a END
      WHERE (s.user_a=$1 OR s.user_b=$1)
        AND s.connected_at IS NOT NULL AND s.ended_at IS NOT NULL
      ORDER BY s.ended_at DESC,s.id LIMIT 20''', uid)
    friends = await con.fetch('''SELECT u.id,u.name,f.accepted_at,f.requested_by
      FROM live_partner_friends f
      JOIN users u ON u.id=CASE WHEN f.user_a=$1 THEN f.user_b ELSE f.user_a END
      WHERE (f.user_a=$1 OR f.user_b=$1) AND u.account_status='active'
        AND NOT EXISTS(SELECT 1 FROM live_partner_blocks b WHERE
          (b.blocker_id=$1 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$1))
      ORDER BY u.name,u.id LIMIT 100''', uid)
    return {'stats':{**dict(stats),
            'averageBand':float(band_stats['average_band']) if band_stats['average_band'] is not None else None,
            'ratingCount':int(band_stats['rating_count'])},
        'recent':[
            {'sessionId':str(row['id']), 'userId':str(row['peer']), 'name':row['name'],
             'endedAt':iso(row['ended_at']), 'seconds':row['seconds'], 'rated':row['rated'],
             'reported':row['reported'],
             'peerRating':float(row['peer_rating']) if row['peer_rating'] is not None else None}
            for row in recent],
        'friends':[{'userId':str(row['id']), 'name':row['name'], 'state':
            'accepted' if row['accepted_at'] else 'sent'
            if str(row['requested_by']) == str(uid) else 'received'}
            for row in friends]}
