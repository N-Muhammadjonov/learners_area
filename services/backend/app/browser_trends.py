"""Exact database day aggregates and the target's calendar shaping rules."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .mock_scoring_engine import convert_raw_to_band

ATTEMPT_TABLES = {'reading': 'reading_attempts', 'listening': 'listening_attempts'}
RECENT_BAND_LIMIT = 12
TASHKENT = ZoneInfo('Asia/Tashkent')


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


async def attempt_band_summary(con, uid, skill: str, *, today: date) -> dict:
    source = f'{ATTEMPT_TABLES[skill]} a'
    content_key = 'a.test_id'
    if skill == 'reading':
        source += ' LEFT JOIN reading_assessments assessment ON assessment.attempt_id=a.id'
        content_key = '(assessment.set_id IS NOT NULL), coalesce(assessment.set_id, a.passage_id)'
    week_starts = weeks(today, 8)
    first_week = datetime.combine(date.fromisoformat(week_starts[0]), time.min, TASHKENT)
    row = await con.fetchrow(f"""
        WITH scored AS (
            SELECT DISTINCT ON ({content_key}) a.id, a.score, a.total_questions, a.submitted_at
            FROM {source}
            WHERE a.user_id=$1 AND a.status='completed' AND a.submitted_at IS NOT NULL
              AND a.total_questions>0 AND a.score BETWEEN 0 AND a.total_questions
            ORDER BY {content_key}, a.submitted_at, a.id
        ), full_tests AS (
            SELECT id, score, submitted_at FROM scored WHERE total_questions=40
        ), recent AS (
            SELECT score, submitted_at, id FROM full_tests
            ORDER BY submitted_at DESC, id DESC LIMIT $2
        ), weekly AS (
            SELECT date_trunc('week', submitted_at AT TIME ZONE 'Asia/Tashkent')::date AS week_start,
                   round(avg(100.0 * score / total_questions))::int AS accuracy,
                   count(*)::int AS attempts
            FROM scored WHERE submitted_at >= $3
            GROUP BY week_start
        ), weekly_bands AS (
            SELECT date_trunc('week', submitted_at AT TIME ZONE 'Asia/Tashkent')::date AS week_start,
                   score, count(*)::int AS attempts
            FROM full_tests WHERE submitted_at >= $3 AND submitted_at < $4
            GROUP BY week_start, score
        )
        SELECT count(*)::int AS completed,
            round(avg(100.0 * score / total_questions), 1)::float8 AS accuracy,
            ARRAY(SELECT ARRAY[score, count(*)::int] FROM full_tests GROUP BY score) AS score_counts,
            (SELECT score FROM full_tests ORDER BY submitted_at, id LIMIT 1) AS first_score,
            ARRAY(SELECT score FROM recent ORDER BY submitted_at, id) AS recent_scores,
            ARRAY(SELECT submitted_at FROM recent ORDER BY submitted_at, id) AS recent_dates,
            ARRAY(SELECT week_start FROM weekly ORDER BY week_start) AS weekly_dates,
            ARRAY(SELECT accuracy FROM weekly ORDER BY week_start) AS weekly_accuracy,
            ARRAY(SELECT attempts FROM weekly ORDER BY week_start) AS weekly_attempts,
            ARRAY(SELECT week_start FROM weekly_bands ORDER BY week_start, score) AS band_weeks,
            ARRAY(SELECT ARRAY[score, attempts] FROM weekly_bands ORDER BY week_start, score) AS band_week_counts
        FROM scored
    """, uid, RECENT_BAND_LIMIT, first_week, first_week + timedelta(weeks=len(week_starts)))
    weekly = {
        week_start.isoformat(): {'value': accuracy, 'count': attempts}
        for week_start, accuracy, attempts in zip(
            row['weekly_dates'], row['weekly_accuracy'], row['weekly_attempts'], strict=True)
    }
    score_bands = {}
    band_count = 0
    band_sum = 0.0
    for score, count in row['score_counts']:
        converted = convert_raw_to_band(skill, score)
        if converted is not None:
            score_bands[score] = converted['band']
            band_count += count
            band_sum += converted['band'] * count
    weekly_bands = {start: [0.0, 0] for start in week_starts}
    for week_start, (score, count) in zip(row['band_weeks'], row['band_week_counts'], strict=True):
        if score in score_bands:
            bucket = weekly_bands[week_start.isoformat()]
            bucket[0] += score_bands[score] * count
            bucket[1] += count
    return {
        'completed': row['completed'],
        'accuracy': row['accuracy'],
        'bandCount': band_count,
        'averageBand': rounded(band_sum / band_count, 2) if band_count else None,
        'bestBand': max(score_bands.values(), default=None),
        'firstBand': score_bands.get(row['first_score']),
        'weekly': [
            {'weekStart': start, **weekly.get(start, {'value': None, 'count': 0})}
            for start in week_starts
        ],
        'weeklyBand': [
            {'weekStart': start, 'value': rounded(total / count, 2) if count else None, 'count': count}
            for start, (total, count) in weekly_bands.items()
        ],
        'recent': [
            {'day': submitted_at.astimezone(TASHKENT).date().isoformat(), 'band': score_bands[score]}
            for score, submitted_at in zip(row['recent_scores'], row['recent_dates'], strict=True)
            if score in score_bands
        ],
    }


async def general_reading_summary(con, uid):
    row = await con.fetchrow("""
        SELECT count(*)::int AS completed, round(avg(100.0 * score / total), 1)::float8 AS accuracy
        FROM general_reading_progress
        WHERE user_id=$1 AND checked_at IS NOT NULL AND total>0 AND score BETWEEN 0 AND total
    """, uid)
    return dict(row)


async def trends(con, uid):
    from .browser_optional import OptionalReads
    reads=OptionalReads()
    async def fetch(name,sql,*args):
        return await reads.read(name,lambda:con.fetch(sql,*args))
    today = datetime.now(TASHKENT).date()
    graded = {}
    since = datetime.now(ZoneInfo('UTC')) - timedelta(days=85)
    attempt_bands = {}
    for skill in ATTEMPT_TABLES:
        graded[skill] = await fetch(skill,f'''SELECT to_char(submitted_at AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD') AS day_key,
          sum(score)::int score,sum(total_questions)::int total,count(*)::int count
          FROM {skill}_attempts WHERE user_id=$1 AND status='completed' AND submitted_at>=$2
          AND score IS NOT NULL AND total_questions>0 GROUP BY day_key''', uid, since)
        attempt_bands[skill] = await reads.read(skill+'-attempt-bands', lambda:attempt_band_summary(con, uid, skill, today=today))
    general_reading = await reads.read('general-reading-practice', lambda: general_reading_summary(con, uid))
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
    return {'attemptBands': attempt_bands, 'generalReadingPractice': general_reading, **{k:series(v,today) if v is not None else None for k,v in graded.items()}, **{k:series(v,today,True) if v is not None else None for k,v in bands.items()}, 'heatmap':heatmap if all(v is not None for v in (*graded.values(),submitted,retention_days)) else None, 'retention':retention if aggregates is not None and recent is not None else None}
