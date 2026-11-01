"""Read one learner-owned Writing exam paper, with server clock expiry behavior.

Port of `src/app/api/writing/exam/[id]/route.ts` and the narrow getExamPaper()
service path. Other exam lifecycle methods are deliberately not implemented here.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from . import main as core
from .db import row_to_dict
from .lesson_writing_port import is_js_uuid
from .notification_events import notify_writing_review_required

router = APIRouter()


def _iso(value):
    # Drizzle getExamPaper() converts dates to JS Date.toISOString(), not raw Dates.
    return row_to_dict({'value': value})['value'] if value is not None else None


@router.get('/api/writing/exam/{id}')
async def writing_exam_read(req: Request, id: str):
    user = await core.current_user(req, active=True)
    if not user:
        return core.j({'error': {'code': 'unauthenticated', 'message': 'Sign in again.'}}, 401)
    if not is_js_uuid(id):
        return core.j({'error': {'code': 'not_found', 'message': 'Not found.'}}, 404)
    db = await core.pool()
    async with db.acquire() as conn:
        # Service expireIfDue() is called first, including for a historical id.
        async with conn.transaction():
            expired = await conn.fetchrow('''UPDATE writing_exam_papers SET
                finalized_at=now(),finalize_reason='timeout' WHERE id=$1
                AND user_id=$2 AND finalized_at IS NULL AND now()>expires_at+make_interval(secs=>15)
                RETURNING id''', id, user['id'])
            if expired:
                # markSubmitted() changes only draft submissions of this paper;
                # an already submitted response is never downgraded.
                transitioned = await conn.fetch('''UPDATE writing_submissions SET status='submitted',
                  submitted_at=now(),updated_at=now() WHERE status='draft'
                  AND id IN (SELECT submission_id FROM writing_exam_paper_entries WHERE paper_id=$1)
                  RETURNING id,user_id''', id)
                for submission in transitioned:
                    await notify_writing_review_required(conn, submission_id=submission['id'],
                        student_id=submission['user_id'])
        paper = await conn.fetchrow('''SELECT id,mode,duration_seconds AS "durationSeconds",
          started_at AS "startedAt",expires_at AS "expiresAt",
          finalized_at AS "finalizedAt",finalize_reason AS "finalizeReason",
          greatest(0,ceil(extract(epoch FROM (expires_at - now()))))::int AS remaining
          FROM writing_exam_papers WHERE id=$1 AND user_id=$2 LIMIT 1''', id, user['id'])
        if not paper:
            return core.j({'error': {'code': 'not_found', 'message': 'Not found.'}}, 404)
        entries = await conn.fetch('''SELECT e.position,e.task_type AS "taskType",
          p.id AS "promptId",p.prompt,p.category,p.target_word_count AS "targetWordCount",
          s.content,s.word_count AS "wordCount",e.draft_revision AS revision,
          e.saved_at AS "savedAt"
          FROM writing_exam_paper_entries e
          INNER JOIN writing_prompts p ON p.id=e.prompt_id
          INNER JOIN writing_submissions s ON s.id=e.submission_id
          WHERE e.paper_id=$1 ORDER BY e.position ASC''', id)
    paper_out = {
        'id': str(paper['id']), 'mode': paper['mode'],
        'durationSeconds': paper['durationSeconds'],
        'startedAt': _iso(paper['startedAt']), 'expiresAt': _iso(paper['expiresAt']),
        'remainingSeconds': 0 if paper['finalizedAt'] else int(paper['remaining']),
        'finalizedAt': _iso(paper['finalizedAt']),
        'finalizeReason': paper['finalizeReason'],
        'entries': [],
    }
    for entry in entries:
        data = row_to_dict(entry)
        paper_out['entries'].append(data)
    return core.j({'ok': True, 'paper': paper_out}, headers={'cache-control': 'no-store'})


def install():
    core.app.include_router(router)
