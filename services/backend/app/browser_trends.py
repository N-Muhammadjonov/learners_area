"""Exact database day aggregates and the target's calendar shaping rules."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


def rounded(n, digits=0):
    return int(n * 10**digits + .5) / 10**digits if digits else int(n + .5)


def monday(day):
    return day - timedelta(days=day.weekday())


def weeks(today, count):
    start = monday(today)
    return [(start - timedelta(weeks=count-1-i)).isoformat() for i in range(count)]


def series(rows, today, band=False):
    buckets = {k: [0, 0, 0] for k in weeks(today, 8)}
    for row in rows:
        key = monday(datetime.fromisoformat(row['day_key']).date()).isoformat()
        if key in buckets:
            b = buckets[key]
            b[0] += float(row['band'] if band else row['score'])
            b[1] += row['count'] if band else row['total']
            b[2] += row['count']
    return [{'weekStart': k, 'count': b[2], 'value': rounded(b[0]/b[1] * (1 if band else 100), 1 if band else 0) if b[1] else None} for k,b in buckets.items()]


async def trends(con, uid):
    from .browser_optional import OptionalReads
    reads=OptionalReads()
    async def fetch(name,sql,*args):
        return await reads.read(name,lambda:con.fetch(sql,*args))
    today = datetime.now(ZoneInfo('Asia/Tashkent')).date()
    graded = {}
    since = datetime.now(ZoneInfo('UTC')) - timedelta(days=85)
    for skill in ('reading', 'listening'):
        graded[skill] = await fetch(skill,f'''SELECT to_char(submitted_at AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD') AS day_key,
          sum(score)::int score,sum(total_questions)::int total,count(*)::int count
          FROM {skill}_attempts WHERE user_id=$1 AND status='completed' AND submitted_at>=$2
          AND score IS NOT NULL AND total_questions>0 GROUP BY day_key''', uid, since)
    bands = {}
    for skill, source in (('writing','writing_submission'),('speaking','speaking_attempt')):
        bands[skill] = await fetch(skill,"""SELECT to_char(created_at AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD') AS day_key,
          sum(overall_estimate)::float8 band,count(*)::int count FROM evaluations
          WHERE user_id=$1 AND source_type=$2 AND overall_estimate IS NOT NULL AND created_at>=$3 GROUP BY day_key""", uid, source, since)
    submitted = await fetch('submitted',"SELECT to_char(submitted_at AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD') AS day_key,count(*)::int count FROM writing_submissions WHERE user_id=$1 AND submitted_at>=$2 GROUP BY day_key", uid, since)
    where = "user_id=$1 AND status IN ('completed','timed_out') AND score IS NOT NULL AND completed_at>=$2"
    retention_days = await fetch('retention-days',f"SELECT to_char(completed_at AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD') AS day_key,count(*)::int count FROM retention_attempts WHERE {where} GROUP BY day_key", uid, since)
    aggregates = await fetch('retention-aggregates',f'SELECT level,count(*)::int attempts,count(DISTINCT retention_text_id)::int texts,max(score)::int best FROM retention_attempts WHERE {where} GROUP BY level', uid, since)
    recent = await fetch('retention-recent',f'SELECT level,score FROM (SELECT level,score,row_number() OVER (PARTITION BY level ORDER BY completed_at DESC,id DESC) rn FROM retention_attempts WHERE {where}) x WHERE rn<=5 ORDER BY level,rn DESC', uid, since)
    retention = []
    for level in ('A2','B1','B2','C1','C2'):
        a = next((r for r in (aggregates or []) if r['level']==level), None)
        scores = [r['score'] for r in (recent or []) if r['level']==level]
        retention.append({'level':level,'attempts':a['attempts'] if a else 0,'textsCompleted':a['texts'] if a else 0,'best':a['best'] if a else None,'recent':scores,'average':rounded(sum(scores)/len(scores)) if scores else None,'change':scores[-1]-scores[0] if len(scores)>1 else None})
    counts = {}
    for rows in (*graded.values(), submitted, retention_days):
        for r in rows or []:
            counts[r['day_key']] = counts.get(r['day_key'],0)+r['count']
    heatmap = [[{'day': (datetime.fromisoformat(w).date()+timedelta(days=d)).isoformat(), 'count': counts.get((datetime.fromisoformat(w).date()+timedelta(days=d)).isoformat(),0)} for d in range(7)] for w in weeks(today,12)]
    return {**{k:series(v,today) if v is not None else None for k,v in graded.items()}, **{k:series(v,today,True) if v is not None else None for k,v in bands.items()}, 'heatmap':heatmap if all(v is not None for v in (*graded.values(),submitted,retention_days)) else None, 'retention':retention if aggregates is not None and recent is not None else None}
