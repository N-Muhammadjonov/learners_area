"""Scheduled vocabulary review: server computes the 1/3/7/16/35 SRS ladder.
Port of services/vocabulary/srs.ts + engine.applyScheduledReview.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter,Request
from . import main as core
router=APIRouter()
DAYS=(1,3,7,16,35)

def advance(entry,outcome,now):
    stage=0 if outcome=='incorrect' or entry['srs_stage']<0 else min(entry['srs_stage']+1,4)
    correct=entry['correct_count']+(outcome=='correct')
    incorrect=entry['incorrect_count']+(outcome=='incorrect')
    used=entry['active_use_count']>0
    mastery='mastered' if stage==4 and used else 'active' if used else 'known' if stage>=2 and correct>incorrect else 'learning'
    return {'srsStage':stage,'mastery':mastery,'correctCount':correct,'incorrectCount':incorrect,
            'intervalDays':DAYS[stage],'nextReviewAt':now+timedelta(days=DAYS[stage])}

def iso(dt):return dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

@router.post('/api/vocabulary/{id}/review')
async def review(req:Request,id:str):
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    body=await core.payload(req)
    if not isinstance(body,dict) or body.get('outcome') not in ('correct','incorrect'):
        return core.j({'error':'invalid_input'},400)
    db=await core.pool(); now=datetime.now(timezone.utc)
    async with db.acquire() as con:
        # Lock the row through the whole point award. Parallel requests cannot advance twice.
        async with con.transaction():
            entry=await con.fetchrow('''SELECT id,srs_stage,correct_count,incorrect_count,active_use_count,
                next_review_at,mastered_at FROM user_vocabulary WHERE id=$1 AND user_id=$2 FOR UPDATE''',id,user['id'])
            if not entry:return core.j({'error':'not_found'},404)
            if entry['next_review_at']>now:return core.j({'error':'not_due','nextReviewAt':iso(entry['next_review_at'])},409)
            state=advance(entry,body['outcome'],now)
            await con.execute('''UPDATE user_vocabulary SET srs_stage=$2,mastery=$3::text,
               correct_count=$4,incorrect_count=$5,interval_days=$6,next_review_at=$7,
               last_reviewed_at=$8,mastered_at=CASE WHEN $3::text='mastered' THEN $8 ELSE mastered_at END,
               state=(CASE WHEN $3::text='new' THEN 'new' WHEN $3::text='learning' THEN 'learning' ELSE 'review' END)::vocab_state
               WHERE id=$1''',id,state['srsStage'],state['mastery'],state['correctCount'],
               state['incorrectCount'],state['intervalDays'],state['nextReviewAt'],now)
            await con.execute('''UPDATE users SET last_meaningful_activity_at=GREATEST(last_meaningful_activity_at,$2)
                WHERE id=$1''',user['id'],now)
            await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'VOCAB_REVIEWED',
              jsonb_build_object('id',$2::text,'outcome',$3::text,'stage',$4::int))''',user['id'],id,body['outcome'],state['srsStage'])
            key=f"revision:{user['id']}:{id}:{iso(entry['next_review_at'])}"
            new=await con.fetchval('''INSERT INTO vocab_point_events(user_id,kind,points,dedupe_key,ref_type,ref_id)
                 VALUES($1,'revision',1,$2,'user_vocabulary',$3) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id''',user['id'],key,id)
            if entry['mastered_at'] is None and state['mastery']=='mastered':
                from .coin_rewards import award_vocab_milestones
                await award_vocab_milestones(con,user['id'])
            return core.j({'ok':True,'mastery':state['mastery'],'srsStage':state['srsStage'],
              'intervalDays':state['intervalDays'],'nextReviewAt':iso(state['nextReviewAt']), 'points':1 if new else 0})

def install():core.app.include_router(router)
