"""Named browser views. All resource ownership/publication is enforced in Python."""
from __future__ import annotations

import re
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, existing, identifier, live, number, query, safe_resource


async def read_view(req, user, path, search, region):
    q = query(search)
    regions={'/app':('dashboard','openLessons','mock'),'/app/dashboard':('dashboard','openLessons','mock'),'/app/progress':('progressSummary','progressStreak','progressTrends','progressMocks'),'/app/mocks':('mock',),'/app/coach':('coach',),'/app/assignments':('assignmentDetails',)}
    if region is not None and region not in regions.get(path,()):
        raise HTTPException(400,'invalid_region')
    if path == '/pending':
        db = await core.pool()
        async with db.acquire() as con:
            row = await con.fetchrow("SELECT id,created_at FROM access_requests WHERE user_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1", user['id'])
        return {'openRequest': camel(row)}
    if path == '/app/profile':
        from .browser import public_config
        auth = public_config()['public']['auth']
        db = await core.pool()
        async with db.acquire() as con:
            study = await con.fetchrow('''SELECT current_level,current_band,target_band,exam_date,
                daily_study_minutes,strongest_skill,weakest_skill FROM onboarding_profiles WHERE user_id=$1 LIMIT 1''', user['id'])
            telegram = await con.fetchrow('''SELECT u.telegram_id,t.username,t.phone_number,t.phone_verified_at
                FROM users u LEFT JOIN telegram_contacts t ON u.telegram_id=t.telegram_user_id WHERE u.id=$1 LIMIT 1''', user['id'])
        initial = camel(study)
        if initial and initial.get('examDate'): initial['examDate'] = initial['examDate'][:10]
        return {'profile':{'telegramIntentEnabled': auth['telegramIntentEnabled'], 'botUsername': auth['botUsername'],
            'study': initial, 'telegram': {'linked': bool(telegram and telegram['telegram_id']),
            'username': telegram['username'] if telegram else None,
            'phone': telegram['phone_number'] if telegram and telegram['phone_verified_at'] else None}}}
    if re.fullmatch(r'/app/(listening|reading|grammar)/lessons(?:/[^/]+)?', path):
        from .browser_curriculum import lessons
        return await lessons(req, user, path, q)
    if path in ('/app/grammar',) or re.fullmatch(r'/app/grammar/[^/]+', path):
        from .browser_curriculum import grammar
        return await grammar(req, user, path, q)
    if path.startswith('/app/courses/'):
        from .browser_curriculum import course
        return await course(req, user, path, q)
    if path in ('/app', '/app/dashboard', '/app/progress', '/app/mocks', '/app/coach', '/app/assignments', '/app/reports', '/app/live-classes'):
        from .browser_activity import read
        return await read(req, user, path, q, region)
    if path.startswith('/app/listening'):
        from .browser_listening import read
        return await read(req, user, path, q)
    if path.startswith('/app/reading'):
        from .browser_reading import read
        return await read(req, user, path, q)
    if path.startswith('/app/writing'):
        from .browser_writing import read
        return await read(req, user, path, q, region)
    if path.startswith('/app/speaking'):
        from .browser_speaking import read
        return await read(req, user, path, q)
    if path.startswith('/app/video-lessons'):
        from .browser_video import read
        return await read(req, user, path, q)
    if path.startswith(('/app/admin', '/app/owner')):
        from .browser_staff import route_view
        return await route_view(req, user, path, q)
    if path == '/app/management':
        if user['role'] not in ('teacher', 'admin', 'owner'):
            raise HTTPException(403, 'forbidden')
        return {}
    raise HTTPException(404, 'not_found')
