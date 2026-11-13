"""Server-owned exam/review boundary for answer-bearing course runtimes."""
async def exam_gate(con,user,test_id):
    row=await con.fetchrow('''SELECT id,status FROM listening_attempts
        WHERE user_id=$1 AND test_id=$2
        ORDER BY CASE WHEN status='in_progress' THEN 0 ELSE 1 END,started_at DESC,id DESC LIMIT 1''',user['id'],test_id)
    active=bool(row and row['status']=='in_progress')
    staff=user['role'] in ('teacher','admin','owner')
    # Staff can inspect all Listening activities even if they have an unfinished exam.
    # Learner exam integrity is unchanged; staff practice does not alter exam scores.
    required=not staff and (active or not (row and row['status']=='completed'))
    return required,str(row['id']) if active else None
