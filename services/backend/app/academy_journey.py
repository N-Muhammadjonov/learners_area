"""Read the learner's existing history in a single scoped PostgreSQL snapshot."""
from __future__ import annotations

from uuid import UUID

from asyncpg import Connection

PAGE_SIZE = 25

# The projection deliberately selects milestones and never answers, feedback comments,
# transcripts, recordings, staff identifiers or financial data.
TIMELINE_SQL = """
WITH events AS (
    SELECT 'group_joined' AS kind,m.id::text AS id,m.activated_on::timestamp AT TIME ZONE 'Asia/Tashkent' AS happened_at,
           g.name AS title,NULL::text AS state,NULL::integer AS score,NULL::integer AS total,
           NULL::uuid AS reference
      FROM academy_group_memberships m JOIN academy_groups g ON g.id=m.group_id
     WHERE m.student_user_id=$1 AND m.activated_on IS NOT NULL
    UNION ALL
    SELECT 'attendance',s.id::text,s.starts_at,g.name,a.status,NULL,NULL,NULL
      FROM academy_attendance a JOIN academy_sessions s ON s.id=a.session_id
      JOIN academy_groups g ON g.id=s.group_id
     WHERE a.student_user_id=$1 AND s.status='held' AND a.status<>'not_marked'
    UNION ALL
    SELECT 'reading_completed',id::text,submitted_at,NULL,NULL,score,total_questions,id
      FROM reading_attempts WHERE user_id=$1 AND status='completed' AND submitted_at IS NOT NULL
    UNION ALL
    SELECT 'listening_completed',id::text,submitted_at,NULL,NULL,score,total_questions,id
      FROM listening_attempts WHERE user_id=$1 AND status='completed' AND submitted_at IS NOT NULL
    UNION ALL
    SELECT 'speaking_submitted',id::text,submitted_at,NULL,NULL,NULL,NULL,NULL
      FROM speaking_attempts WHERE user_id=$1 AND status IN ('submitted','reviewed') AND submitted_at IS NOT NULL
    UNION ALL
    SELECT 'writing_submitted',id::text,submitted_at,NULL,NULL,NULL,NULL,id
      FROM writing_submissions WHERE user_id=$1 AND status IN ('submitted','evaluated') AND submitted_at IS NOT NULL
    UNION ALL
    SELECT 'teacher_feedback',f.id::text,f.created_at,NULL,NULL,NULL,NULL,s.id
      FROM writing_feedback f JOIN writing_submissions s ON s.id=f.submission_id
     WHERE s.user_id=$1 AND f.source='teacher' AND s.status IN ('submitted','evaluated')
    UNION ALL
    SELECT 'assignment_completed',t.assignment_id::text,t.completed_at,a.title,NULL,NULL,NULL,NULL
      FROM assignment_targets t JOIN assignments a ON a.id=t.assignment_id
     WHERE t.student_user_id=$1 AND t.status='completed' AND t.completed_at IS NOT NULL
)
SELECT * FROM events
 ORDER BY happened_at DESC,kind,id
 LIMIT $2 OFFSET $3
"""

STUDENT_LINKS = {
    'group_joined': '/app/courses/ielts',
    'attendance': '/app/progress',
    'reading_completed': '/app/reading/attempts/{id}',
    'listening_completed': '/app/listening/attempts/{id}',
    'writing_submitted': '/app/writing',
    'teacher_feedback': '/app/writing',
    'speaking_submitted': '/app/speaking',
    'assignment_completed': '/app/assignments',
}


async def timeline(conn: Connection, student: UUID, role: str, page: int) -> dict:
    rows = await conn.fetch(TIMELINE_SQL,student,PAGE_SIZE+1,PAGE_SIZE*(page-1))
    items = []
    for row in rows[:PAGE_SIZE]:
        kind, reference = row['kind'],row['reference']
        item = {
            'kind':kind,'occurredAt':row['happened_at'].isoformat(),'title':row['title'],
            'status':row['state'],'score':row['score'],'total':row['total'],
        }
        if role=='student':
            item['href'] = STUDENT_LINKS[kind].format(id=reference)
        elif role in ('teacher','owner') and kind in ('writing_submitted','teacher_feedback'):
            item['href'] = f'/app/teacher/students/{student}?submission={reference}#submission-{reference}'
        items.append(item)
    goal = None
    if role!='guardian':
        row = await conn.fetchrow('SELECT target_band,exam_date FROM onboarding_profiles WHERE user_id=$1',student)
        if row and (row['target_band'] is not None or row['exam_date'] is not None):
            goal = {'targetBand':row['target_band'],'examDate':row['exam_date'].isoformat() if row['exam_date'] else None}
    return {'items':items,'goal':goal,'page':page,'hasNext':len(rows)>PAGE_SIZE}
