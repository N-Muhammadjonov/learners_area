"""One SQL snapshot for the existing learner Dashboard; no cross-user cache."""
import json
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from .browser_summary import STREAK_SQL


SQL="""SELECT jsonb_build_object(
 'profile',(SELECT to_jsonb(p) FROM (SELECT target_band FROM onboarding_profiles WHERE user_id=$1) p),
 'evaluation',(SELECT to_jsonb(e) FROM (SELECT overall_estimate,weaknesses FROM evaluations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1) e),
 'counts',jsonb_build_object(
   'reading',(SELECT count(*)::int FROM reading_attempts WHERE user_id=$1),
   'listening',(SELECT count(*)::int FROM listening_attempts WHERE user_id=$1),
   'speaking',(SELECT count(*)::int FROM speaking_attempts WHERE user_id=$1),
   'writing',(SELECT count(*)::int FROM writing_submissions WHERE user_id=$1 AND word_count>0)),
 'upcoming',(SELECT to_jsonb(l) FROM (SELECT l.id,l.title,l.scheduled_at FROM live_classes l JOIN courses c ON c.id=l.course_id WHERE c.slug='ielts' AND l.status='upcoming' ORDER BY l.scheduled_at LIMIT 1) l),
 'assignments',(SELECT coalesce(jsonb_agg(a),'[]'::jsonb) FROM (SELECT id,title,status,due_at FROM assignments WHERE target_user_id=$1 AND status<>'completed' ORDER BY due_at) a),
 'due',(SELECT count(*)::int FROM user_vocabulary WHERE user_id=$1 AND next_review_at<=now()),
 'streak',("""+STREAK_SQL+"""),
 'last',(SELECT to_jsonb(latest) FROM (
   (SELECT 'reading' module,started_at at,'/app/reading/attempts/'||id::text href FROM reading_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 1)
   UNION ALL (SELECT 'listening',started_at,'/app/listening/attempts/'||id::text FROM listening_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 1)
   UNION ALL (SELECT 'writing',updated_at,'/app/writing/submissions/'||id::text FROM writing_submissions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1)
   UNION ALL (SELECT 'speaking',started_at,'/app/speaking/history' FROM speaking_attempts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1)
   UNION ALL (SELECT 'vocabulary',created_at,'/app/vocabulary' FROM user_vocabulary WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1)
 ) latest ORDER BY at DESC LIMIT 1)
)"""


def timestamp(row,key):
    if row and row.get(key):
        row[key]=datetime.fromisoformat(row[key].replace('Z','+00:00')).astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    return row


async def dashboard_snapshot(con,uid):
    from .browser_common import camel
    from .step31_coach import decoded,PUBLIC
    raw=await con.fetchval(SQL,uid,datetime.now(ZoneInfo('Asia/Tashkent')).date())
    data=json.loads(raw) if isinstance(raw,str) else raw
    if not isinstance(data,dict):raise ValueError('Invalid Dashboard snapshot')
    evaluation=data['evaluation'];counts=data['counts']
    return {'profile':camel(data['profile']),
      'latestEvaluation':{**camel(evaluation),'weaknesses':decoded(evaluation['weaknesses']),'checkedByName':PUBLIC} if evaluation else None,
      'vocabDueCount':data['due'],'streak':data['streak'],'writingAttempts':counts['writing'],'skillCounts':counts,
      'openAssignments':[camel(timestamp(row,'due_at')) for row in data['assignments']],
      'nextLiveClass':camel(timestamp(data['upcoming'],'scheduled_at')),'lastActivity':timestamp(data['last'],'at'),
      'unavailable':{key:False for key in ('profile','latestEvaluation','vocabDue','streak','writingAttempts','readingAttempts','listeningAttempts','speakingAttempts','assignments','nextLiveClass','lastActivity')}}
