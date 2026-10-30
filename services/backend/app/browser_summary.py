"""One database snapshot of one learner's summary. No answers or private peer rows."""
import json


def _skill(table):
    # Called only with the two constants below, never a request/table name.
    return f"""SELECT jsonb_build_object('attempts',count(*)::int,
      'submitted',count(*) FILTER(WHERE status='completed')::int,
      'score',COALESCE(sum(score) FILTER(WHERE status='completed'),0)::int,
      'total',COALESCE(sum(total_questions) FILTER(WHERE status='completed'),0)::int)
      FROM {table} WHERE user_id=$1"""


SUMMARY_SQL = f"""SELECT jsonb_build_object(
 'reading',({_skill('reading_attempts')}),
 'listening',({_skill('listening_attempts')}),
 'speaking',(SELECT jsonb_build_object('attempts',count(*)::int,
   'submitted',count(*) FILTER(WHERE status<>'recording')::int,
   'transcribed',count(*) FILTER(WHERE transcript_provider IS NOT NULL)::int)
   FROM speaking_attempts WHERE user_id=$1),
 'writing',(SELECT jsonb_build_object('submissions',count(*)::int,'lastSubmittedAt',max(submitted_at))
   FROM writing_submissions WHERE user_id=$1),
 'evaluation',(SELECT jsonb_build_object('overallEstimate',overall_estimate,'createdAt',created_at)
   FROM evaluations WHERE user_id=$1 AND source_type='writing_submission' ORDER BY created_at DESC LIMIT 1),
 'vocabulary',(SELECT COALESCE(jsonb_agg(v),'[]'::jsonb) FROM (
   SELECT state,count(*)::int n,count(*) FILTER(WHERE next_review_at<=now() AND state<>'mastered')::int due
   FROM user_vocabulary WHERE user_id=$1 GROUP BY state) v),
 'lessons',(SELECT jsonb_build_object('total',count(*)::int,'open',count(*) FILTER(WHERE default_state<>'locked')::int) FROM lessons),
 'lessonState',(SELECT jsonb_build_object('inProgress',count(*) FILTER(WHERE state='in_progress')::int,
   'completed',count(*) FILTER(WHERE state='completed')::int) FROM lesson_progress WHERE user_id=$1),
 'assignments',(SELECT jsonb_build_object('total',count(*)::int,
   'open',count(*) FILTER(WHERE status<>'completed')::int,'completed',count(*) FILTER(WHERE status='completed')::int)
   FROM assignments WHERE target_user_id=$1),
 'mocks',(SELECT COALESCE(jsonb_agg(m),'[]'::jsonb) FROM (
   SELECT finished_at,estimated_band FROM mock_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 20) m)
 ) AS summary"""


async def summary_snapshot(con, uid):
    raw = await con.fetchval(SUMMARY_SQL, uid)
    data = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(data, dict):
        raise ValueError('Invalid summary snapshot')
    result = {key: data[key] for key in ('reading', 'listening', 'speaking', 'writing', 'lessons', 'assignments')}
    for key in ('reading', 'listening'):
        item = result[key]
        item['accuracy'] = int(item['score']/item['total']*100+.5) if item['submitted'] and item['total'] else None
    evaluation = data['evaluation']
    result['writing'].update(latestBand=evaluation['overallEstimate'] if evaluation else None,
        latestEvaluationAt=evaluation['createdAt'] if evaluation else None, evaluationUnavailable=False)
    states = {row['state']: row['n'] for row in data['vocabulary']}
    result['vocabulary'] = {'total': sum(states.values()), 'due': sum(row['due'] for row in data['vocabulary']),
        'byState': {key: states.get(key, 0) for key in ('new', 'learning', 'review', 'known', 'mastered', 'activated')}}
    result['lessons'].update(data['lessonState'])
    attempts = data['mocks']
    bands = [float(row['estimated_band']) for row in attempts if row['finished_at'] and row['estimated_band'] is not None]
    result['mocks'] = {'attempts': len(attempts), 'finished': sum(bool(row['finished_at']) for row in attempts), 'bestBand': max(bands) if bands else None}
    result['unavailableRegions'] = []
    return result


STREAK_SQL = """WITH days AS (
 SELECT DISTINCT (created_at AT TIME ZONE 'Asia/Tashkent')::date AS day
 FROM activity_events WHERE user_id=$1 AND created_at < (($2::date+1)::timestamp AT TIME ZONE 'Asia/Tashkent')
), ranked AS (SELECT day,row_number() OVER(ORDER BY day DESC)::int AS n FROM days),
anchor AS (SELECT max(day) AS day FROM days WHERE day >= $2::date-1)
SELECT count(*)::int FROM ranked,anchor WHERE ranked.day=anchor.day-(ranked.n-1)"""
