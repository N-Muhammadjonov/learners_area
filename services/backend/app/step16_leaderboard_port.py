"""Vocabulary leaderboard: the score ledger is the sole source of truth.

Historical point amounts are deliberately ignored; effective values are computed
from event types, with day/entry game-answer deduplication in Asia/Tashkent.
"""
from __future__ import annotations
from datetime import datetime,date,timedelta,timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
TIMEZONE=ZoneInfo('Asia/Tashkent')
EFFECTIVE='''WITH scores AS (SELECT p.id,p.user_id,p.kind,p.created_at,
 CASE WHEN p.kind='new_word' THEN 0
  WHEN p.kind='revision' THEN 1
  WHEN p.kind='game_answer' THEN CASE WHEN row_number() OVER
    (PARTITION BY p.kind,p.user_id,coalesce(p.ref_id,p.id::text),
      ((p.created_at AT TIME ZONE 'Asia/Tashkent')::date)
    ORDER BY p.created_at ASC,p.id ASC)=1 THEN 1 ELSE 0 END
  WHEN p.kind='sentence' THEN 2 ELSE 0 END::int AS effective_points
 FROM vocab_point_events p)'''


def streak_from_days(instants,now=None):
    today=(now or datetime.now(timezone.utc)).astimezone(TIMEZONE).date()
    dates=sorted({(v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v).astimezone(TIMEZONE).date()
         for v in instants},reverse=True)
    if not dates or dates[0] not in (today,today-timedelta(days=1)):return 0
    streak=1
    for newer,older in zip(dates,dates[1:]):
        if (newer-older).days!=1:break
        streak+=1
    return streak


async def standing(conn,user_id):
    ranked=await conn.fetch(EFFECTIVE+''' SELECT scores.user_id AS "userId",u.name,op.current_level AS level,
      COALESCE(SUM(scores.effective_points),0)::int AS points
      FROM scores JOIN users u ON u.id=scores.user_id
      LEFT JOIN onboarding_profiles op ON op.user_id=u.id
      WHERE u.role='student'
      GROUP BY scores.user_id,u.name,op.current_level
      HAVING SUM(scores.effective_points)>0
      ORDER BY SUM(scores.effective_points) DESC,u.name ASC,scores.user_id ASC''')
    days=await conn.fetch(EFFECTIVE+'''SELECT created_at FROM scores WHERE user_id=$1
        AND effective_points>0''',user_id)
    ranks=[{**row_to_dict(r),'userId':str(r['userId']),'rank':i+1} for i,r in enumerate(ranked)]
    mine=next((r for r in ranks if r['userId']==str(user_id)),None)
    user=await conn.fetchrow('''SELECT u.name,op.current_level AS level FROM users u
         LEFT JOIN onboarding_profiles op ON op.user_id=u.id WHERE u.id=$1''',user_id)
    top=[{**r,'isMe':r['userId']==str(user_id),'name':r['name'] or '—'} for r in ranks[:15]]
    return {'points':mine['points'] if mine else 0,'rank':mine['rank'] if mine else 0,
        'streak':streak_from_days([r['created_at'] for r in days]),
        'top':top,'name':(user['name'] if user and user['name'] is not None else mine['name'] if mine else '—'),
        'level':user['level'] if user else None}


async def awards(conn,user_id):
    rows=await conn.fetch(EFFECTIVE+'''SELECT id,kind,effective_points AS points,created_at AS "createdAt"
     FROM scores WHERE user_id=$1 AND effective_points>0 ORDER BY created_at DESC LIMIT 10''',user_id)
    return [row_to_dict(r) for r in rows]


@router.get('/api/vocabulary/leaderboard')
async def vocab_leaderboard(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    try:
        db=await core.pool()
        view=req.query_params.get('view')
        async with db.acquire() as con:
            if view=='awards':
                try:return core.j({'ok':True,'awards':await awards(con,user['id'])},headers=PRIVATE)
                except Exception:
                    return core.j({'ok':False,'error':'temporarily_unavailable','code':'vocabulary_awards_unavailable'},503,PRIVATE)
            if view=='standing':
                try:return core.j({'ok':True,**(await standing(con,user['id']))},headers=PRIVATE)
                except Exception:
                    return core.j({'ok':False,'error':'temporarily_unavailable','code':'vocabulary_standing_unavailable'},503,PRIVATE)
            try:totals=await standing(con,user['id'])
            except Exception:
                return core.j({'ok':False,'error':'temporarily_unavailable','code':'vocabulary_standing_unavailable'},503,PRIVATE)
            try:history=await awards(con,user['id']);missing=False
            except Exception:history=[];missing=True
            return core.j({'ok':True,**totals,'awards':history,'awardsUnavailable':missing},headers=PRIVATE)
    except Exception:
        return core.j({'ok':False,'error':'temporarily_unavailable','code':'vocabulary_standing_unavailable'},503,PRIVATE)


def install():core.app.include_router(router)
