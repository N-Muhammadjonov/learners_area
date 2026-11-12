"""Live Classes backend service: YouTube Live integration, permissions, class access,
real-time chat (WebSocket + PostgreSQL LISTEN/NOTIFY + HTTP), recording lifecycle,
and estimated page attendance tracking.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, urlsplit

import asyncpg
import httpx
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect

from . import main as core
from .access_events import bus as access_bus, listener_settings
from .browser_common import camel
from .lesson_writing_port import is_js_uuid, js_length
from .rate_limit import RULES
from .security import SESSION_COOKIE, check_origin, normalize_origin, request_origin, verify_token

LOG = logging.getLogger(__name__)
router = APIRouter()

RULES.setdefault('live_chat_send', (1, 2))
RULES.setdefault('live_attendance_ping', (6, 60))

YOUTUBE_VIDEO_ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')
STREAM_KEY_RE = re.compile(r'^[A-Za-z0-9]{4}(?:-[A-Za-z0-9]{4}){3,5}$')
CONTROL_CHARS_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')

JOIN_OPENS_BEFORE = timedelta(minutes=15)
JOIN_CLOSES_AFTER = timedelta(minutes=30)
ATTENDANCE_ACTIVE_GAP_SECONDS = 90
ATTENDANCE_MIN_WRITE_INTERVAL_SECONDS = 15
ATTENDANCE_MAX_STEP_SECONDS = 60
ATTENDANCE_MAX_ACTIVE_TABS = 32
ATTENDANCE_SESSION_MERGE_TOLERANCE_SECONDS = 5.0
CHAT_MAX_LENGTH = 500
CHAT_COOLDOWN_SECONDS = 2.0
WS_AUTH_RECHECK_INTERVAL_SECONDS = 30.0
CHAT_HISTORY_DEFAULT_LIMIT = 50
CHAT_HISTORY_MAX_LIMIT = 100
CHAT_RECONCILE_INTERVAL_SECONDS = float(os.environ.get('LIVE_CHAT_RECONCILE_INTERVAL_SECONDS', '12.0'))
CHAT_RECONCILE_JITTER_SECONDS = float(os.environ.get('LIVE_CHAT_RECONCILE_JITTER_SECONDS', '2.0'))
YOUTUBE_API_CACHE_TTL_SECONDS = 30.0

ALLOWED_YOUTUBE_HOSTS = frozenset({
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
    'www.youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
    'studio.youtube.com',
})

LIFECYCLE_STATUSES = frozenset({
    'scheduled',
    'upcoming',
    'live',
    'ended',
    'completed',
    'recording_processing',
    'recording_ready',
    'recorded',
    'recording_unavailable',
    'cancelled',
})

RECORDING_STATUSES = frozenset({'none', 'processing', 'ready', 'unavailable'})
ACCESS_SCOPES = frozenset({'course', 'teacher_roster', 'assigned'})

# Per-user monotonic cooldown tracker for fast pre-DB rejection of chat spam
_chat_last_sent: dict[tuple[str, str], float] = {}
# Cache for optional YouTube Data API v3 status lookups
_youtube_status_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def js_iso(dt: datetime | str | None) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace('Z', '+00:00'))
        except ValueError:
            return dt
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def parse_iso_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    except ValueError:
        return None


def chat_iso(dt: datetime | str | None) -> str | None:
    """Serialize chat timestamps at PostgreSQL's full microsecond precision.

    Other Learners Area timestamps intentionally use the existing millisecond
    formatter. Chat pagination must not round a DB timestamp before creating
    a `(created_at, id)` cursor or serializing a message to a client.
    """
    parsed = parse_iso_datetime(dt)
    if parsed is None:
        return None
    return parsed.isoformat(timespec='microseconds').replace('+00:00', 'Z')


def parse_chat_cursor(raw_cursor: Any) -> tuple[datetime | None, uuid.UUID | None, bool]:
    """Validate and parse a chat pagination cursor (`<iso_timestamp>` or `<iso_timestamp>|<uuid>`).

    Returns `(dt, msg_uuid, is_valid)`.
    If `raw_cursor` is None or empty string, returns `(None, None, True)`.
    """
    if raw_cursor is None or raw_cursor == '':
        return None, None, True
    if not isinstance(raw_cursor, str):
        return None, None, False
    text = raw_cursor.strip()
    if not text or len(text) > 128 or CONTROL_CHARS_RE.search(text):
        return None, None, False
    if '|' in text:
        parts = text.split('|')
        if len(parts) != 2:
            return None, None, False
        ts_part, id_part = parts[0].strip(), parts[1].strip()
        dt = parse_iso_datetime(ts_part)
        if dt is None or not is_js_uuid(id_part):
            return None, None, False
        return dt, uuid.UUID(id_part), True
    dt = parse_iso_datetime(text)
    if dt is None:
        return None, None, False
    return dt, None, True


def format_chat_cursor(created_at: datetime | str | None, msg_id: Any) -> str | None:
    iso_str = chat_iso(created_at)
    if not iso_str:
        return None
    if msg_id is not None and is_js_uuid(str(msg_id)):
        return f'{iso_str}|{str(msg_id).lower()}'
    return iso_str


def extract_youtube_video_id(raw: Any) -> tuple[str | None, str | None]:
    """Extract and validate an 11-character YouTube video ID from a URL or ID string.

    Returns `(video_id, error_code)`.
    If `raw` is empty or None, returns `(None, None)`.
    Rejects stream keys, non-YouTube domains, credentials, and malformed IDs.
    """
    if raw is None:
        return None, None
    if not isinstance(raw, str):
        return None, 'invalid_youtube_url'
    candidate = raw.strip()
    if not candidate:
        return None, None
    if len(candidate) > 2048 or re.search(r'\s', candidate):
        return None, 'invalid_youtube_url'
    if STREAM_KEY_RE.fullmatch(candidate) or candidate.lower().startswith(('rtmp://', 'rtmps://')):
        return None, 'stream_key_forbidden'
    if YOUTUBE_VIDEO_ID_RE.fullmatch(candidate):
        return candidate, None

    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return None, 'invalid_youtube_url'

    if parsed.scheme not in ('https', 'http') or not parsed.netloc or parsed.username or parsed.password:
        return None, 'invalid_youtube_url'

    host = (parsed.hostname or '').lower()
    if host not in ALLOWED_YOUTUBE_HOSTS:
        return None, 'invalid_youtube_url'

    path_parts = [p for p in parsed.path.split('/') if p]
    query_params = parse_qs(parsed.query, keep_blank_values=False)

    video_id: str | None = None
    if host in ('youtu.be', 'www.youtu.be'):
        if len(path_parts) == 1:
            video_id = path_parts[0]
    elif host == 'studio.youtube.com':
        if len(path_parts) >= 2 and path_parts[0] == 'video':
            video_id = path_parts[1]
    else:
        if path_parts == ['watch']:
            v_list = query_params.get('v')
            if v_list and len(v_list) == 1:
                video_id = v_list[0]
        elif len(path_parts) == 2 and path_parts[0] in ('live', 'embed', 'shorts', 'v'):
            video_id = path_parts[1]

    if not video_id or not YOUTUBE_VIDEO_ID_RE.fullmatch(video_id):
        return None, 'invalid_youtube_url'
    return video_id, None


def youtube_thumbnail_url(video_id: str | None) -> str | None:
    if isinstance(video_id, str) and YOUTUBE_VIDEO_ID_RE.fullmatch(video_id):
        return f'https://i.ytimg.com/vi/{video_id}/hqdefault.jpg'
    return None


def compute_lifecycle_status(status: str, recording_status: str | None) -> str:
    rec = (recording_status or 'none').lower()
    st = (status or 'upcoming').lower()
    if st == 'cancelled':
        return 'cancelled'
    if st == 'live':
        return 'live'
    if st == 'recorded' or (st in ('completed', 'ended') and rec == 'ready'):
        return 'recording_ready'
    if st in ('completed', 'ended'):
        if rec == 'processing':
            return 'recording_processing'
        if rec == 'unavailable':
            return 'recording_unavailable'
        return 'ended'
    return 'scheduled'


def map_requested_status_transition(
    requested_status: str | None,
    requested_recording_status: str | None,
    current_status: str,
    current_recording_status: str,
    has_youtube: bool,
) -> tuple[str, str] | None:
    """Strict server-side state machine for Live Classes lifecycle and recording statuses."""
    st = requested_status.lower().strip() if isinstance(requested_status, str) else None
    rec = requested_recording_status.lower().strip() if isinstance(requested_recording_status, str) else None

    if st is not None and st not in LIFECYCLE_STATUSES:
        return None
    if rec is not None and rec not in RECORDING_STATUSES:
        return None
    if st is None and rec is None:
        return None

    curr_db = (current_status or 'upcoming').lower().strip()
    curr_rec = (current_recording_status or ('ready' if curr_db == 'recorded' else 'none')).lower().strip()
    curr_lc = compute_lifecycle_status(curr_db, curr_rec)

    if st in ('scheduled', 'upcoming'):
        if rec not in (None, 'none'):
            return None
        target_db, target_rec = 'upcoming', 'none'
    elif st == 'live':
        if rec not in (None, 'none'):
            return None
        target_db, target_rec = 'live', 'none'
    elif st in ('ended', 'completed'):
        if rec == 'ready':
            target_db, target_rec = 'recorded', 'ready'
        elif rec in ('processing', 'unavailable', 'none'):
            target_db, target_rec = 'completed', rec
        else:
            target_db = 'completed'
            target_rec = 'processing' if (curr_lc == 'live' and has_youtube) else (curr_rec if curr_lc in ('recording_processing', 'recording_unavailable') else 'none')
    elif st == 'recording_processing':
        if rec not in (None, 'processing'):
            return None
        target_db, target_rec = 'completed', 'processing'
    elif st in ('recording_ready', 'recorded'):
        if rec not in (None, 'ready'):
            return None
        target_db, target_rec = 'recorded', 'ready'
    elif st == 'recording_unavailable':
        if rec not in (None, 'unavailable'):
            return None
        target_db, target_rec = 'completed', 'unavailable'
    elif st == 'cancelled':
        if rec not in (None, 'none'):
            return None
        target_db, target_rec = 'cancelled', 'none'
    else:
        if curr_lc in ('scheduled', 'live', 'cancelled'):
            if rec != 'none':
                return None
            target_db, target_rec = curr_db, 'none'
        elif rec == 'ready':
            target_db, target_rec = 'recorded', 'ready'
        elif rec in ('processing', 'unavailable', 'none'):
            target_db, target_rec = 'completed', rec
        else:
            return None

    target_lc = compute_lifecycle_status(target_db, target_rec)

    allowed_targets: dict[str, set[str]] = {
        'scheduled': {'scheduled', 'live', 'cancelled'},
        'live': {'live', 'ended', 'recording_processing', 'cancelled'},
        'ended': {'ended', 'recording_processing', 'recording_ready', 'recording_unavailable'},
        'recording_processing': {'ended', 'recording_processing', 'recording_ready', 'recording_unavailable'},
        'recording_ready': {'recording_ready', 'recording_processing', 'recording_unavailable'},
        'recording_unavailable': {'recording_unavailable', 'recording_processing', 'recording_ready'},
        'cancelled': {'cancelled', 'scheduled'},
    }

    if target_lc not in allowed_targets.get(curr_lc, set()):
        return None

    return target_db, target_rec


def compute_join_window(row: dict[str, Any], now: datetime | None = None) -> tuple[str, datetime]:
    now = now or datetime.now(timezone.utc)
    scheduled = parse_iso_datetime(row.get('scheduled_at')) or now
    duration = int(row.get('duration_minutes') or 60)
    opens = scheduled - JOIN_OPENS_BEFORE
    ends = scheduled + timedelta(minutes=duration) + JOIN_CLOSES_AFTER
    status = row.get('status') or 'upcoming'
    if status == 'cancelled':
        state = 'cancelled'
    elif status == 'live':
        state = 'open'
    elif status in ('completed', 'recorded'):
        state = 'closed'
    elif now < opens:
        state = 'too_early'
    elif now > ends:
        state = 'closed'
    else:
        state = 'open'
    return state, opens


def sanitize_chat_message(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    cleaned = CONTROL_CHARS_RE.sub('', raw).strip()
    if not cleaned or js_length(cleaned) > CHAT_MAX_LENGTH or len(cleaned) > CHAT_MAX_LENGTH:
        return None
    return cleaned


async def has_extended_live_schema(con) -> bool:
    """Detect whether migration 0072 columns/tables are present on the database."""
    try:
        val = await con.fetchval(
            "SELECT to_regclass('public.live_class_messages')::text"
        )
        return bool(val)
    except Exception:
        return False


def can_user_manage_class(user: dict[str, Any], class_row: dict[str, Any]) -> bool:
    """Verify whether `user` can edit/schedule/assign/start/end/moderate/view attendance for `class_row`.

    - Owner: can manage every Live Class and view all attendance information.
    - Teacher: can manage only their own authorized or assigned Live Classes (`teacher_user_id == user.id`).
    - Admin: can manage only Live Classes explicitly assigned to them (`teacher_user_id == user.id`),
      never receiving automatic Owner-level global access.
    - Student: cannot create, edit, delete, or administratively manage Live Classes.
    """
    if not user or user.get('account_status') != 'active' or not isinstance(class_row, dict):
        return False
    role = user.get('role')
    if role == 'owner':
        return True
    if role in ('teacher', 'admin'):
        uid = str(user.get('id') or '')
        teacher_id = str(class_row.get('teacher_user_id') or '')
        return bool(uid and teacher_id and teacher_id == uid)
    return False


async def can_user_access_class(con, user: dict[str, Any], class_row: dict[str, Any]) -> bool:
    """Strict fail-closed verification of whether `user` has permission to view/join/chat in `class_row`.

    Never returns True when a database lookup fails or when required relationship data is missing.
    """
    if not user or user.get('account_status') != 'active' or not isinstance(class_row, dict):
        return False
    role = user.get('role')
    if role == 'owner':
        return True
    if role in ('teacher', 'admin'):
        return can_user_manage_class(user, class_row)
    if role != 'student':
        return False

    class_id = class_row.get('id')
    user_id = user.get('id')
    if not class_id or not user_id or con is None:
        return False

    access_scope = str(class_row.get('access_scope') or 'course').strip().lower()
    teacher_uuid = class_row.get('teacher_user_id')
    course_uuid = class_row.get('course_id')

    try:
        if access_scope == 'assigned':
            enrolled = await con.fetchval(
                'SELECT 1 FROM live_class_enrollments WHERE live_class_id=$1 AND user_id=$2 LIMIT 1',
                class_id,
                user_id,
            )
            return bool(enrolled)

        if access_scope == 'teacher_roster':
            if not teacher_uuid:
                return False
            in_roster = await con.fetchval(
                'SELECT 1 FROM teacher_student_links WHERE teacher_user_id=$1 AND student_user_id=$2 LIMIT 1',
                teacher_uuid,
                user_id,
            )
            return bool(in_roster)

        if access_scope == 'course':
            if not course_uuid:
                row_course = await con.fetchrow(
                    'SELECT course_id FROM live_classes WHERE id=$1 LIMIT 1',
                    class_id,
                )
                course_uuid = row_course.get('course_id') if row_course else None
            if not course_uuid:
                return False
            entitled = await con.fetchval(
                '''SELECT 1 FROM enrollments
                   WHERE user_id=$1 AND course_id=$2
                   UNION ALL
                   SELECT 1 FROM access_entitlements
                   WHERE user_id=$1 AND course_id=$2
                     AND (expires_at IS NULL OR expires_at > NOW())
                   LIMIT 1''',
                user_id,
                course_uuid,
            )
            return bool(entitled)

        return False
    except Exception:
        LOG.error(
            'Database failure during live class access check (class_id=%s); denying access fail-closed',
            class_id,
            exc_info=True,
        )
        return False


def format_class_for_student(
    row: dict[str, Any],
    teacher_name: str | None,
    *,
    now: datetime | None = None,
    expose_video_for_preview: bool = False,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    status = row.get('status') or 'upcoming'
    recording_status = row.get('recording_status') or ('ready' if status == 'recorded' else 'none')
    lifecycle = compute_lifecycle_status(status, recording_status)
    join_state, opens_at = compute_join_window(row, now)

    raw_vid = row.get('youtube_video_id')
    if not raw_vid and row.get('meeting_url'):
        extracted, _ = extract_youtube_video_id(row.get('meeting_url'))
        if extracted:
            raw_vid = extracted
    if not raw_vid and row.get('recording_url'):
        extracted, _ = extract_youtube_video_id(row.get('recording_url'))
        if extracted:
            raw_vid = extracted

    # Students only receive the playable YouTube video ID when the lesson is Live
    # or when the recording is Ready (never while Scheduled or Recording Processing).
    playable = status == 'live' or lifecycle == 'recording_ready' or expose_video_for_preview
    video_id = raw_vid if playable else None
    thumb = youtube_thumbnail_url(raw_vid)

    description = row.get('description') if row.get('description') is not None else row.get('topic')
    chat_read_only = status != 'live'
    chat_enabled = status in ('live', 'completed', 'recorded')

    return {
        'id': str(row['id']),
        'title': row['title'],
        'topic': row.get('topic'),
        'description': description,
        'status': status,
        'lifecycleStatus': lifecycle,
        'recordingStatus': recording_status,
        'scheduledAt': js_iso(row['scheduled_at']),
        'startedAt': js_iso(row.get('started_at')),
        'endedAt': js_iso(row.get('ended_at')),
        'durationMinutes': int(row.get('duration_minutes') or 60),
        'recordingDurationSeconds': row.get('recording_duration_seconds'),
        'teacherUserId': str(row['teacher_user_id']) if row.get('teacher_user_id') else None,
        'teacherName': teacher_name,
        'meetingUrl': row.get('meeting_url') if playable else None,
        'recordingUrl': row.get('recording_url') if playable else None,
        'youtubeVideoId': video_id,
        'hasYoutubeVideo': bool(raw_vid),
        'thumbnailUrl': thumb,
        'accessScope': row.get('access_scope') or 'course',
        'joinState': join_state,
        'opensAt': js_iso(opens_at),
        'chatEnabled': chat_enabled,
        'chatReadOnly': chat_read_only,
    }


# ---------------------------------------------------------------------------
# Attendance Interval Consolidation Reference Implementation (Task 3)
# ---------------------------------------------------------------------------

def consolidate_attendance_records(
    rows: list[dict[str, Any]],
    *,
    tolerance_seconds: float = ATTENDANCE_SESSION_MERGE_TOLERANCE_SECONDS,
) -> dict[str, Any]:
    """Consolidate multiple historical attendance rows for a single `(live_class_id, user_id)`:

    1. Collects historical intervals and sorts by `(joined_at ASC, effective_end_at ASC, str(id) ASC)`.
    2. Merges overlapping intervals and intervals separated by `<= tolerance_seconds` (5s)
       to count distinct attendance sessions (`session_count`).
    3. Computes total `estimated_duration_seconds` from the union of actual covered intervals
       without counting short gaps and without fabricating duration for incomplete legacy records.
    4. Preserves every existing session_history value from each row (including
       nested JSON or null), followed by the row's original snapshot.
    """
    if not rows:
        raise ValueError('rows must not be empty')

    prepared = []
    for r in rows:
        rid = str(r.get('id') or '')
        joined_dt = parse_iso_datetime(r.get('joined_at'))
        if joined_dt is None:
            raise ValueError(f'Row {rid} is missing valid joined_at')
        raw_last_seen = parse_iso_datetime(r.get('last_seen_at'))
        left_dt = parse_iso_datetime(r.get('left_at'))
        rec_dur = max(0, int(r.get('estimated_duration_seconds') or 0))
        row_sess = max(1, int(r.get('session_count') or 1))
        is_incomplete = (raw_last_seen is None and left_dt is None and rec_dur <= 0)

        candidates = [joined_dt]
        if raw_last_seen is not None:
            candidates.append(raw_last_seen)
        if left_dt is not None:
            candidates.append(left_dt)
        if rec_dur > 0:
            candidates.append(joined_dt + timedelta(seconds=rec_dur))
        effective_end = max(candidates)

        if rec_dur > 0:
            dur_end = joined_dt + timedelta(seconds=rec_dur)
        else:
            dur_end = max([joined_dt] + ([raw_last_seen] if raw_last_seen else []) + ([left_dt] if left_dt else []))

        existing_hist = r.get('session_history')
        prepared.append({
            'id': rid,
            'live_class_id': r.get('live_class_id'),
            'user_id': r.get('user_id'),
            'joined_at': joined_dt,
            'raw_last_seen_at': raw_last_seen,
            'left_at': left_dt,
            'effective_end_at': effective_end,
            'dur_end_at': dur_end,
            'recorded_duration_seconds': rec_dur,
            'row_session_count': row_sess,
            'is_incomplete': is_incomplete,
            'existing_history': existing_hist if isinstance(existing_hist, list) else ([existing_hist] if existing_hist is not None else []),
        })

    prepared.sort(key=lambda x: (x['joined_at'], x['effective_end_at'], x['id']))

    keep_id = prepared[0]['id']
    min_joined = min(x['joined_at'] for x in prepared)
    max_last_seen = max(x['effective_end_at'] for x in prepared)
    latest_by_end = max(enumerate(prepared), key=lambda item: (item[1]['effective_end_at'], item[0]))[1]
    latest_left_at = latest_by_end['left_at']

    total_duration = 0
    total_sessions = 0
    prev_max_session_end: datetime | None = None
    prev_max_dur_end: datetime | None = None
    history: list[Any] = []

    for idx, item in enumerate(prepared):
        start = item['joined_at']
        sess_end = item['effective_end_at']
        dur_end = item['dur_end_at']

        # 1. Distinct session count with 5-second merge tolerance
        if idx == 0 or prev_max_session_end is None:
            total_sessions += item['row_session_count']
        elif (start - prev_max_session_end).total_seconds() > tolerance_seconds:
            total_sessions += item['row_session_count']

        if prev_max_session_end is None or sess_end > prev_max_session_end:
            prev_max_session_end = sess_end

        # 2. Union of covered intervals for duration (never counting gaps or fabricating legacy duration)
        if dur_end > start:
            if prev_max_dur_end is None or start >= prev_max_dur_end:
                total_duration += int(round((dur_end - start).total_seconds()))
            elif dur_end > prev_max_dur_end:
                total_duration += max(0, int(round((dur_end - prev_max_dur_end).total_seconds())))

        if prev_max_dur_end is None or dur_end > prev_max_dur_end:
            prev_max_dur_end = dur_end

        # JSONB arrays can contain any JSON type; do not discard legacy values.
        history.extend(item['existing_history'])
        history.append({
            'id': item['id'],
            'joinedAt': js_iso(item['joined_at']),
            'lastSeenAt': js_iso(item['raw_last_seen_at']) if item['raw_last_seen_at'] else None,
            'effectiveEndAt': js_iso(item['effective_end_at']),
            'leftAt': js_iso(item['left_at']) if item['left_at'] else None,
            'estimatedDurationSeconds': item['recorded_duration_seconds'],
            'sessionCount': item['row_session_count'],
            'incomplete': item['is_incomplete'],
        })

    return {
        'id': keep_id,
        'live_class_id': prepared[0]['live_class_id'],
        'user_id': prepared[0]['user_id'],
        'joined_at': min_joined,
        'last_seen_at': max_last_seen,
        'left_at': latest_left_at,
        'estimated_duration_seconds': min(86400, total_duration),
        'session_count': max(1, total_sessions),
        'session_history': history,
    }


# ---------------------------------------------------------------------------
# Real-time Chat Bus (WebSockets + PostgreSQL LISTEN/NOTIFY + Reconciliation)
# ---------------------------------------------------------------------------

class LiveChatBus:
    """Manages per-class WebSocket subscriber queues, a shared PostgreSQL LISTEN
    connection per worker, and a lightweight per-worker, per-active-class message
    reconciliation loop so multi-worker deployments recover missed notifications
    automatically without Redis or per-student polling loops.
    """

    def __init__(
        self,
        *,
        worker_id: str | None = None,
        reconcile_interval: float | None = None,
        reconcile_jitter: float | None = None,
        pool_getter: Callable[[], Any] | None = None,
    ) -> None:
        self.worker_id: str = worker_id or uuid.uuid4().hex
        self.subscribers: dict[str, set[asyncio.Queue]] = {}
        self.class_cursors: dict[str, str] = {}
        self.connection: asyncpg.Connection | None = None
        self.connecting: asyncio.Task | None = None
        self.reconnecting: asyncio.Task | None = None
        self.reconcile_task: asyncio.Task | None = None
        self.reconcile_interval: float = (
            reconcile_interval if reconcile_interval is not None else CHAT_RECONCILE_INTERVAL_SECONDS
        )
        self.reconcile_jitter: float = (
            reconcile_jitter if reconcile_jitter is not None else CHAT_RECONCILE_JITTER_SECONDS
        )
        self.pool_getter: Callable[[], Any] | None = pool_getter
        self.dsn: str = ''
        self.notify_failures: int = 0
        self.listener_drops: int = 0
        self.reconcile_runs: int = 0
        self.recovered_messages_count: int = 0
        self._seen_message_ids: OrderedDict[tuple[str, str], float] = OrderedDict()

    def _mark_seen(self, class_id: str, message_id: str | None) -> bool:
        """Return True if `(class_id, message_id)` has already been published on this worker."""
        if not message_id:
            return False
        key = (str(class_id), str(message_id).lower())
        if key in self._seen_message_ids:
            return True
        self._seen_message_ids[key] = time.monotonic()
        while len(self._seen_message_ids) > 4096:
            self._seen_message_ids.popitem(last=False)
        return False

    def _advance_cursor(self, class_id: str, created_at: Any, message_id: Any = None) -> None:
        cid = str(class_id)
        candidate = format_chat_cursor(created_at, message_id)
        if not candidate:
            return
        cand_dt, cand_uuid, ok = parse_chat_cursor(candidate)
        if not ok or cand_dt is None:
            return
        existing = self.class_cursors.get(cid)
        if existing:
            ex_dt, ex_uuid, ex_ok = parse_chat_cursor(existing)
            if ex_ok and ex_dt is not None:
                if cand_dt < ex_dt:
                    return
                if cand_dt == ex_dt and cand_uuid is not None and ex_uuid is not None and str(cand_uuid) <= str(ex_uuid):
                    return
        self.class_cursors[cid] = candidate

    def publish_local(self, class_id: str, event: dict[str, Any]) -> bool:
        """Publish `event` to local subscribers of `class_id`.
        Returns True if the event was newly enqueued, False if deduplicated or no subscribers.
        """
        cid = str(class_id)
        if isinstance(event, dict) and event.get('type') == 'message':
            msg = event.get('message')
            if isinstance(msg, dict):
                msg_id = msg.get('id')
                self._advance_cursor(cid, msg.get('createdAt'), msg_id)
                if self._mark_seen(cid, msg_id):
                    return False
        queues = self.subscribers.get(cid)
        if not queues:
            return False
        for q in list(queues):
            try:
                if q.full():
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(event)
            except Exception:
                LOG.warning('Failed to enqueue chat event for class %s subscriber', cid, exc_info=True)
        return True

    def _on_pg_notify(self, connection: Any, pid: int, channel: str, payload: str) -> None:
        if channel != 'la_live_class_chat' or not payload or len(payload) > 8192:
            return
        try:
            data = json.loads(payload)
            if not isinstance(data, dict):
                return
            if data.get('workerId') == self.worker_id:
                return
            class_id = data.get('classId')
            event = data.get('event')
            if isinstance(class_id, str) and isinstance(event, dict):
                self.publish_local(class_id, event)
        except Exception:
            LOG.warning('Failed to process incoming la_live_class_chat notification', exc_info=True)

    def _on_lost(self, connection: Any) -> None:
        if self.connection is not connection:
            return
        self.connection = None
        self.listener_drops += 1
        LOG.warning('LiveChatBus PostgreSQL LISTEN connection lost; scheduling automatic reconnect')
        if self.subscribers and (self.reconnecting is None or self.reconnecting.done()):
            self.reconnecting = asyncio.create_task(self._reconnect())

    async def _reconnect(self) -> None:
        try:
            while self.subscribers and not self.connection:
                await asyncio.sleep(3)
                if await self.ensure_listener(self.dsn):
                    await self.reconcile_active_classes()
                    for cid in list(self.subscribers):
                        self.publish_local(cid, {'type': 'sync_required', 'classId': cid})
                    return
        finally:
            self.reconnecting = None

    async def _get_pool(self) -> Any:
        if self.pool_getter is not None:
            res = self.pool_getter()
            return await res if asyncio.iscoroutine(res) else res
        return await core.pool()

    async def reconcile_active_classes(self, target_class_id: str | None = None) -> int:
        """Query PostgreSQL for any messages newer than each active class's cursor on this worker
        and broadcast them to connected subscribers. Does nothing when there are no active subscribers.
        """
        active_cids = (
            [str(target_class_id)]
            if target_class_id is not None and self.subscribers.get(str(target_class_id))
            else [cid for cid, qs in list(self.subscribers.items()) if qs]
        )
        if not active_cids:
            return 0

        self.reconcile_runs += 1
        recovered = 0
        try:
            db = await self._get_pool()
            if db is None:
                return 0
            async with db.acquire() as con:
                for cid in active_cids:
                    if not self.subscribers.get(cid) or not is_js_uuid(cid):
                        continue
                    cursor = self.class_cursors.get(cid)
                    pages = 0
                    while pages < 10 and self.subscribers.get(cid):
                        pages += 1
                        page_data = await fetch_chat_messages(
                            con,
                            uuid.UUID(cid),
                            limit=CHAT_HISTORY_DEFAULT_LIMIT,
                            after=cursor,
                        )
                        msgs = page_data.get('messages') or []
                        for m in msgs:
                            self._advance_cursor(cid, m.get('createdAt'), m.get('id'))
                            if self.publish_local(cid, {'type': 'message', 'classId': cid, 'message': m}):
                                recovered += 1
                                self.recovered_messages_count += 1
                        if not page_data.get('hasMore') or not msgs:
                            break
                        next_after = page_data.get('nextAfter') or page_data.get('nextCursor')
                        if not next_after or next_after == cursor:
                            break
                        cursor = next_after
        except asyncio.CancelledError:
            raise
        except Exception:
            LOG.warning('LiveChatBus active-class reconciliation encountered a database error', exc_info=True)
        return recovered

    async def _reconcile_loop(self) -> None:
        try:
            while self.subscribers:
                delay = max(0.02, self.reconcile_interval + (random.uniform(0.0, self.reconcile_jitter) if self.reconcile_jitter > 0 else 0.0))
                await asyncio.sleep(delay)
                if not self.subscribers:
                    break
                await self.reconcile_active_classes()
        except asyncio.CancelledError:
            pass
        finally:
            if self.reconcile_task is asyncio.current_task():
                self.reconcile_task = None

    def _ensure_reconcile_task(self) -> None:
        if self.subscribers and (self.reconcile_task is None or self.reconcile_task.done()):
            try:
                loop = asyncio.get_running_loop()
                self.reconcile_task = loop.create_task(self._reconcile_loop())
            except RuntimeError:
                pass

    async def _connect(self, dsn: str) -> bool:
        if not dsn:
            return False
        conn = None
        try:
            target, tls = listener_settings(dsn)
            conn = await asyncpg.connect(target, timeout=5, command_timeout=20, statement_cache_size=0, ssl=tls)
            await conn.add_listener('la_live_class_chat', self._on_pg_notify)
            conn.add_termination_listener(self._on_lost)
            if not self.subscribers:
                await conn.close()
                return False
            self.connection = conn
            return True
        except asyncio.CancelledError:
            if conn:
                await conn.close()
            raise
        except Exception:
            LOG.warning('LiveChatBus failed to establish PostgreSQL LISTEN connection', exc_info=True)
            if conn:
                try:
                    await conn.close()
                except Exception:
                    pass
            return False

    async def ensure_listener(self, dsn: str | None = None) -> bool:
        dsn = (dsn or self.dsn or os.environ.get('AUTH_EVENTS_DATABASE_URL', '') or os.environ.get('DATABASE_URL', '')).strip()
        if not dsn:
            return False
        self.dsn = dsn
        if self.connection:
            return True
        if self.connecting is None:
            self.connecting = asyncio.create_task(self._connect(dsn))
        task = self.connecting
        try:
            return await asyncio.shield(task)
        finally:
            if task.done() and self.connecting is task:
                self.connecting = None

    async def subscribe(
        self,
        class_id: str,
        dsn: str | None = None,
        *,
        initial_cursor: str | None = None,
    ) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        cid = str(class_id)
        if cid not in self.class_cursors:
            self.class_cursors[cid] = initial_cursor or chat_iso(datetime.now(timezone.utc) - timedelta(seconds=2))
        elif initial_cursor:
            self._advance_cursor(cid, initial_cursor.split('|')[0], initial_cursor.split('|')[1] if '|' in initial_cursor else None)
        self.subscribers.setdefault(cid, set()).add(q)
        self._ensure_reconcile_task()
        if dsn or os.environ.get('DATABASE_URL'):
            asyncio.create_task(self.ensure_listener(dsn))
        return q

    async def unsubscribe(self, class_id: str, q: asyncio.Queue) -> None:
        cid = str(class_id)
        bucket = self.subscribers.get(cid)
        if bucket:
            bucket.discard(q)
            if not bucket:
                self.subscribers.pop(cid, None)
                self.class_cursors.pop(cid, None)
        if not self.subscribers:
            await self.close()

    async def broadcast(self, con: Any, class_id: str, event: dict[str, Any]) -> bool:
        cid = str(class_id)
        self.publish_local(cid, event)
        if con is not None:
            try:
                envelope = json.dumps({'workerId': self.worker_id, 'classId': cid, 'event': event})
                if len(envelope) > 7800:
                    fallback_event = {'type': 'sync_required', 'classId': cid}
                    envelope = json.dumps({'workerId': self.worker_id, 'classId': cid, 'event': fallback_event})
                await con.fetchval("SELECT pg_notify('la_live_class_chat', $1)", envelope)
                return True
            except Exception:
                self.notify_failures += 1
                LOG.warning(
                    'PostgreSQL pg_notify failed for class %s; persisted chat state remains recoverable via reconciliation and catch-up API',
                    cid,
                    exc_info=True,
                )
                return False
        return True

    async def close(self) -> None:
        for task in (self.reconcile_task, self.reconnecting, self.connecting):
            if task and task is not asyncio.current_task():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        self.reconcile_task = None
        self.reconnecting = None
        self.connecting = None
        conn = self.connection
        self.connection = None
        if conn:
            try:
                await conn.close()
            except Exception:
                pass


WORKER_ID = uuid.uuid4().hex
chat_bus = LiveChatBus(worker_id=WORKER_ID)


# ---------------------------------------------------------------------------
# Attendance Helper (Join, Heartbeat, Leave)
# ---------------------------------------------------------------------------

def parse_attendance_session_id(value: Any) -> str | None:
    '''Stable identifier for a single browser room instance, not an auth token.'''
    if value is None:
        return None  # Backward compatibility for a client opened before this feature.
    if not isinstance(value, str) or len(value) != 36:
        raise ValueError('invalid_attendance_session_id')
    try:
        token = uuid.UUID(value)
    except (ValueError, AttributeError):
        raise ValueError('invalid_attendance_session_id') from None
    if str(token) != value.lower():
        raise ValueError('invalid_attendance_session_id')
    return str(token)


def tab_attendance_update(row: dict[str, Any], action: str, session_id: str, now: datetime) -> dict[str, Any]:
    '''Advance one student's page-attendance clock across overlapping browser tabs.

    The aggregate has one database row per (class, student).  Its active_sessions
    JSONB field stores independent last-seen timestamps for each browser tab.
    Time is credited once, using the last global event, not once per tab.
    Expired browser tabs are pruned after 90 seconds without a heartbeat.
    '''
    now = parse_iso_datetime(now)
    last_seen = parse_iso_datetime(row.get('last_seen_at')) or parse_iso_datetime(row.get('joined_at')) or now
    now = max(now, last_seen)  # Concurrent requests cannot move the clock backwards.
    left_at = parse_iso_datetime(row.get('left_at'))
    elapsed = max(0, (now - last_seen).total_seconds())
    previous = row.get('active_sessions') or {}
    if isinstance(previous, str):
        try:
            previous = json.loads(previous)
        except (ValueError, TypeError):
            previous = {}
    if not isinstance(previous, dict):
        previous = {}
    active = {}
    for token, seen in previous.items():
        stamp = parse_iso_datetime(seen)
        if (isinstance(token, str) and stamp is not None
                and 0 <= (now - stamp).total_seconds() <= ATTENDANCE_ACTIVE_GAP_SECONDS):
            active[token] = stamp

    # An out-of-order/duplicate leave must never close another live tab.
    if action == 'leave' and session_id not in active:
        return {'unchanged': True}

    # Throttle per TAB, not per student: two synchronized tabs must both stay
    # registered even when their heartbeats reach the server in the same second.
    if (action == 'heartbeat' and session_id in active
            and (now - active[session_id]).total_seconds() < ATTENDANCE_MIN_WRITE_INTERVAL_SECONDS):
        return {'unchanged': True}

    # Old attendance data was created before per-tab tracking existed.
    legacy_open = (not previous and left_at is None
                   and elapsed <= ATTENDANCE_ACTIVE_GAP_SECONDS)
    was_active = bool(active) or legacy_open
    sessions = max(1, int(row.get('session_count') or 1))
    duration = max(0, int(row.get('estimated_duration_seconds') or 0))
    if was_active and elapsed <= ATTENDANCE_ACTIVE_GAP_SECONDS:
        duration = min(86400, duration + min(ATTENDANCE_MAX_STEP_SECONDS, int(elapsed)))

    if action in ('join', 'heartbeat'):
        if session_id not in active and len(active) >= ATTENDANCE_MAX_ACTIVE_TABS:
            raise ValueError('too_many_active_tabs')
        if not was_active and elapsed > ATTENDANCE_SESSION_MERGE_TOLERANCE_SECONDS:
            sessions += 1
        active[session_id] = now
    else:
        active.pop(session_id, None)

    return {
        'last_seen_at': now,
        'left_at': None if active else now,
        'estimated_duration_seconds': duration,
        'session_count': sessions,
        'active_sessions': {token: stamp.isoformat(timespec='microseconds') for token, stamp in active.items()},
    }


async def record_tab_attendance(con: Any, class_id: Any, user_id: Any,
                                action: str, session_id: str, now: datetime) -> dict[str, Any]:
    '''SQL row lock serializes only this student's tabs, never all class members.'''
    if action != 'leave':
        inserted = await con.fetchrow(
            '''INSERT INTO live_class_attendance (
                   live_class_id, user_id, joined_at, last_seen_at,
                   left_at, estimated_duration_seconds, session_count, active_sessions
               ) VALUES ($1, $2, $3, $3, NULL, 0, 1, '{}'::jsonb)
               ON CONFLICT (live_class_id, user_id) DO NOTHING RETURNING id''',
            class_id, user_id, now,
        )
        if inserted:
            await con.execute(
                "INSERT INTO activity_events(user_id, type, payload) VALUES($1, 'LIVE_CLASS_ATTENDED', $2::jsonb)",
                user_id, json.dumps({'liveClassId': str(class_id)}),
            )
    existing = await con.fetchrow(
        '''SELECT id, joined_at, last_seen_at, left_at, estimated_duration_seconds,
                  session_count, active_sessions
           FROM live_class_attendance
           WHERE live_class_id=$1 AND user_id=$2 FOR UPDATE''',
        class_id, user_id,
    )
    if not existing:
        return {'joined': False, 'joinedAt': None, 'lastSeenAt': None, 'leftAt': None,
                'estimatedDurationSeconds': 0, 'sessionCount': 0}

    initial = dict(existing)
    update = tab_attendance_update(initial, action, session_id, now)
    if update.get('unchanged'):
        row_out = initial
    else:
        row_out = await con.fetchrow(
            '''UPDATE live_class_attendance
               SET last_seen_at=$3, left_at=$4, estimated_duration_seconds=$5,
                   session_count=$6, active_sessions=$7::jsonb
               WHERE live_class_id=$1 AND user_id=$2
               RETURNING joined_at, last_seen_at, left_at,
                         estimated_duration_seconds, session_count''',
            class_id, user_id, update['last_seen_at'], update['left_at'],
            update['estimated_duration_seconds'], update['session_count'],
            json.dumps(update['active_sessions']),
        )
        row_out = dict(row_out or {**initial, **update})
    return {'joined': True, 'joinedAt': js_iso(row_out['joined_at']),
            'lastSeenAt': js_iso(row_out.get('last_seen_at')),
            'leftAt': js_iso(row_out.get('left_at')),
            'estimatedDurationSeconds': int(row_out.get('estimated_duration_seconds') or 0),
            'sessionCount': int(row_out.get('session_count') or 1)}


async def record_student_attendance(
    con: Any,
    class_row: dict[str, Any],
    user: dict[str, Any],
    action: str = 'join',
    now: datetime | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    """Record or update estimated page attendance for an authenticated student.

    Avoids duplicate overlapping sessions and never writes every second.
    """
    now = now or datetime.now(timezone.utc)
    class_id = class_row['id']
    user_id = user['id']
    extended = await has_extended_live_schema(con)

    if extended and session_id is not None:
        return await record_tab_attendance(con, class_id, user_id, action, session_id, now)

    if not extended:
        existing = await con.fetchrow(
            'SELECT joined_at FROM live_class_attendance WHERE live_class_id=$1 AND user_id=$2 LIMIT 1',
            class_id,
            user_id,
        )
        if existing:
            joined_at = existing['joined_at']
        else:
            new_row = await con.fetchrow(
                'INSERT INTO live_class_attendance(live_class_id, user_id) VALUES($1, $2) RETURNING joined_at',
                class_id,
                user_id,
            )
            joined_at = new_row['joined_at'] if new_row else now
            await con.execute(
                "INSERT INTO activity_events(user_id, type, payload) VALUES($1, 'LIVE_CLASS_ATTENDED', $2::jsonb)",
                user_id,
                json.dumps({'liveClassId': str(class_id)}),
            )
        return {
            'joined': True,
            'joinedAt': js_iso(joined_at),
            'lastSeenAt': js_iso(now),
            'leftAt': js_iso(now) if action == 'leave' else None,
            'estimatedDurationSeconds': 0,
            'sessionCount': 1,
        }

    existing = await con.fetchrow(
        '''SELECT id, joined_at, last_seen_at, left_at, estimated_duration_seconds, session_count
           FROM live_class_attendance
           WHERE live_class_id=$1 AND user_id=$2
           LIMIT 1''',
        class_id,
        user_id,
    )

    if not existing:
        if action == 'leave':
            return {
                'joined': False,
                'joinedAt': None,
                'lastSeenAt': None,
                'leftAt': None,
                'estimatedDurationSeconds': 0,
                'sessionCount': 0,
            }
        inserted = await con.fetchrow(
            '''INSERT INTO live_class_attendance(
                 live_class_id, user_id, joined_at, last_seen_at, left_at, estimated_duration_seconds, session_count
               ) VALUES($1, $2, $3, $3, NULL, 0, 1)
               ON CONFLICT (live_class_id, user_id) DO UPDATE
               SET last_seen_at = EXCLUDED.last_seen_at,
                   left_at = NULL
               RETURNING joined_at, last_seen_at, left_at, estimated_duration_seconds, session_count''',
            class_id,
            user_id,
            now,
        )
        await con.execute(
            "INSERT INTO activity_events(user_id, type, payload) VALUES($1, 'LIVE_CLASS_ATTENDED', $2::jsonb)",
            user_id,
            json.dumps({'liveClassId': str(class_id)}),
        )
        return {
            'joined': True,
            'joinedAt': js_iso(inserted['joined_at'] if inserted else now),
            'lastSeenAt': js_iso(inserted['last_seen_at'] if inserted else now),
            'leftAt': None,
            'estimatedDurationSeconds': int(inserted['estimated_duration_seconds'] if inserted else 0),
            'sessionCount': int(inserted['session_count'] if inserted else 1),
        }

    last_seen = parse_iso_datetime(existing['last_seen_at']) or parse_iso_datetime(existing['joined_at']) or now
    left_at = parse_iso_datetime(existing['left_at'])
    elapsed = max(0.0, (now - last_seen).total_seconds())
    current_duration = int(existing.get('estimated_duration_seconds') or 0)
    sessions = int(existing.get('session_count') or 1)

    if action == 'heartbeat' and elapsed < ATTENDANCE_MIN_WRITE_INTERVAL_SECONDS and left_at is None:
        return {
            'joined': True,
            'joinedAt': js_iso(existing['joined_at']),
            'lastSeenAt': js_iso(last_seen),
            'leftAt': None,
            'estimatedDurationSeconds': current_duration,
            'sessionCount': sessions,
            'throttled': True,
        }

    delta = 0
    if left_at is None and 0 < elapsed <= ATTENDANCE_ACTIVE_GAP_SECONDS:
        delta = min(ATTENDANCE_MAX_STEP_SECONDS, int(elapsed))
    elif action == 'join' and (left_at is not None or elapsed > ATTENDANCE_ACTIVE_GAP_SECONDS):
        sessions += 1

    new_duration = min(86400, current_duration + delta)
    new_left_at = now if action == 'leave' else None

    updated = await con.fetchrow(
        '''UPDATE live_class_attendance
           SET last_seen_at = $3,
               left_at = $4,
               estimated_duration_seconds = $5,
               session_count = $6
           WHERE live_class_id = $1 AND user_id = $2
           RETURNING joined_at, last_seen_at, left_at, estimated_duration_seconds, session_count''',
        class_id,
        user_id,
        now,
        new_left_at,
        new_duration,
        sessions,
    )
    row_out = updated or existing
    return {
        'joined': True,
        'joinedAt': js_iso(row_out['joined_at']),
        'lastSeenAt': js_iso(row_out.get('last_seen_at') or now),
        'leftAt': js_iso(row_out.get('left_at')),
        'estimatedDurationSeconds': int(row_out.get('estimated_duration_seconds') or new_duration),
        'sessionCount': int(row_out.get('session_count') or sessions),
    }


# ---------------------------------------------------------------------------
# Optional YouTube Data API v3 Status & Recording Verification
# ---------------------------------------------------------------------------

def _parse_iso8601_duration(duration_str: str | None) -> int | None:
    if not isinstance(duration_str, str):
        return None
    m = re.fullmatch(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration_str.strip())
    if not m:
        return None
    hours = int(m.group(1) or 0)
    minutes = int(m.group(2) or 0)
    seconds = int(m.group(3) or 0)
    total = hours * 3600 + minutes * 60 + seconds
    return total if total > 0 else None


async def verify_youtube_video_status(video_id: str) -> dict[str, Any]:
    """Query YouTube Data API v3 if `YOUTUBE_API_KEY` is configured in the environment."""
    api_key = os.environ.get('YOUTUBE_API_KEY', '').strip()
    if not api_key:
        return {
            'apiConfigured': False,
            'verified': False,
            'manualVerificationRequired': True,
            'videoId': video_id,
        }

    now_mono = time.monotonic()
    cached = _youtube_status_cache.get(video_id)
    if cached and (now_mono - cached[0]) < YOUTUBE_API_CACHE_TTL_SECONDS:
        return cached[1]

    url = 'https://www.googleapis.com/youtube/v3/videos'
    params = {
        'part': 'status,liveStreamingDetails,contentDetails',
        'id': video_id,
        'key': api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, params=params)
        if resp.status_code != 200:
            return {
                'apiConfigured': True,
                'verified': False,
                'manualVerificationRequired': True,
                'videoId': video_id,
                'reason': f'youtube_api_http_{resp.status_code}',
            }
        payload = resp.json()
        items = payload.get('items') if isinstance(payload, dict) else None
        if not items:
            result = {
                'apiConfigured': True,
                'verified': True,
                'found': False,
                'embeddable': False,
                'privacyStatus': 'unavailable',
                'isLive': False,
                'recordingReady': False,
                'videoId': video_id,
                'reason': 'video_not_found_or_private',
            }
            _youtube_status_cache[video_id] = (now_mono, result)
            return result

        item = items[0]
        st = item.get('status') or {}
        live_details = item.get('liveStreamingDetails') or {}
        content_details = item.get('contentDetails') or {}

        privacy = st.get('privacyStatus')
        embeddable = bool(st.get('embeddable', True))
        upload_status = st.get('uploadStatus')
        actual_start = live_details.get('actualStartTime')
        actual_end = live_details.get('actualEndTime')
        duration_sec = _parse_iso8601_duration(content_details.get('duration'))

        is_live = bool(actual_start and not actual_end)
        recording_ready = bool(
            actual_end
            and upload_status in ('processed', 'uploaded')
            and embeddable
            and privacy in ('unlisted', 'public')
        )
        result = {
            'apiConfigured': True,
            'verified': True,
            'found': True,
            'videoId': video_id,
            'privacyStatus': privacy,
            'embeddable': embeddable,
            'uploadStatus': upload_status,
            'isLive': is_live,
            'hasEnded': bool(actual_end),
            'recordingReady': recording_ready,
            'durationSeconds': duration_sec,
        }
        _youtube_status_cache[video_id] = (now_mono, result)
        return result
    except Exception:
        return {
            'apiConfigured': True,
            'verified': False,
            'manualVerificationRequired': True,
            'videoId': video_id,
            'reason': 'youtube_api_unreachable',
        }


# ---------------------------------------------------------------------------
# Chat Persistence, History, Cursor Pagination & Moderation Helpers (Task 5)
# ---------------------------------------------------------------------------

def _format_chat_row(r: Any) -> dict[str, Any]:
    return {
        'id': str(r['id']),
        'classId': str(r['live_class_id']),
        'senderId': str(r['sender_user_id']),
        'senderName': r['sender_name'],
        'senderRole': r['sender_role'],
        'body': r['body'],
        'createdAt': chat_iso(r['created_at']),
    }


async def fetch_chat_messages(
    con: Any,
    class_id: Any,
    *,
    limit: int = CHAT_HISTORY_DEFAULT_LIMIT,
    before: str | None = None,
    after: str | None = None,
) -> dict[str, Any]:
    """Deterministic cursor-based pagination for Live Class chat messages.

    - Orders by `(created_at, id)` using `limit + 1` lookahead so `hasMore` is always accurate
      and never drops messages when >50 messages arrive during a disconnect or share a timestamp.
    - Supports both `<iso_timestamp>` and `<iso_timestamp>|<message_uuid>` composite cursors,
      ensuring deleted/moderated messages never break continuation.
    """
    limit = max(1, min(CHAT_HISTORY_MAX_LIMIT, int(limit)))
    if not await has_extended_live_schema(con):
        return {'messages': [], 'hasMore': False, 'nextBefore': None, 'nextAfter': None, 'nextCursor': None}

    if before and after:
        raise ValueError('invalid_cursor')

    before_dt, before_id, before_ok = parse_chat_cursor(before)
    after_dt, after_id, after_ok = parse_chat_cursor(after)
    if not before_ok or not after_ok:
        raise ValueError('invalid_cursor')

    if after_dt is not None:
        if after_id is not None:
            rows = await con.fetch(
                '''SELECT m.id, m.live_class_id, m.sender_user_id, m.body, m.is_deleted, m.created_at,
                          u.name AS sender_name, u.role AS sender_role
                   FROM live_class_messages m
                   JOIN users u ON u.id = m.sender_user_id
                   WHERE m.live_class_id = $1 AND m.is_deleted = FALSE
                     AND (m.created_at > $2 OR (m.created_at = $2 AND m.id > $3))
                   ORDER BY m.created_at ASC, m.id ASC
                   LIMIT $4''',
                class_id,
                after_dt,
                after_id,
                limit + 1,
            )
        else:
            rows = await con.fetch(
                '''SELECT m.id, m.live_class_id, m.sender_user_id, m.body, m.is_deleted, m.created_at,
                          u.name AS sender_name, u.role AS sender_role
                   FROM live_class_messages m
                   JOIN users u ON u.id = m.sender_user_id
                   WHERE m.live_class_id = $1 AND m.is_deleted = FALSE AND m.created_at > $2
                   ORDER BY m.created_at ASC, m.id ASC
                   LIMIT $3''',
                class_id,
                after_dt,
                limit + 1,
            )
        has_more = len(rows) > limit
        sliced = rows[:limit]
        messages = [_format_chat_row(r) for r in sliced]
        next_after = format_chat_cursor(messages[-1]['createdAt'], messages[-1]['id']) if messages else format_chat_cursor(after_dt, after_id)
        return {
            'messages': messages,
            'hasMore': has_more,
            'nextBefore': None,
            'nextAfter': next_after,
            'nextCursor': next_after if has_more else None,
        }

    if before_dt is not None:
        if before_id is not None:
            rows = await con.fetch(
                '''SELECT m.id, m.live_class_id, m.sender_user_id, m.body, m.is_deleted, m.created_at,
                          u.name AS sender_name, u.role AS sender_role
                   FROM live_class_messages m
                   JOIN users u ON u.id = m.sender_user_id
                   WHERE m.live_class_id = $1 AND m.is_deleted = FALSE
                     AND (m.created_at < $2 OR (m.created_at = $2 AND m.id < $3))
                   ORDER BY m.created_at DESC, m.id DESC
                   LIMIT $4''',
                class_id,
                before_dt,
                before_id,
                limit + 1,
            )
        else:
            rows = await con.fetch(
                '''SELECT m.id, m.live_class_id, m.sender_user_id, m.body, m.is_deleted, m.created_at,
                          u.name AS sender_name, u.role AS sender_role
                   FROM live_class_messages m
                   JOIN users u ON u.id = m.sender_user_id
                   WHERE m.live_class_id = $1 AND m.is_deleted = FALSE AND m.created_at < $2
                   ORDER BY m.created_at DESC, m.id DESC
                   LIMIT $3''',
                class_id,
                before_dt,
                limit + 1,
            )
    else:
        rows = await con.fetch(
            '''SELECT m.id, m.live_class_id, m.sender_user_id, m.body, m.is_deleted, m.created_at,
                      u.name AS sender_name, u.role AS sender_role
               FROM live_class_messages m
               JOIN users u ON u.id = m.sender_user_id
               WHERE m.live_class_id = $1 AND m.is_deleted = FALSE
               ORDER BY m.created_at DESC, m.id DESC
               LIMIT $2''',
            class_id,
            limit + 1,
        )

    has_more = len(rows) > limit
    sliced = list(reversed(rows[:limit]))
    messages = [_format_chat_row(r) for r in sliced]
    next_before = format_chat_cursor(messages[0]['createdAt'], messages[0]['id']) if has_more and messages else None
    next_after = format_chat_cursor(messages[-1]['createdAt'], messages[-1]['id']) if messages else None
    return {
        'messages': messages,
        'hasMore': has_more,
        'nextBefore': next_before,
        'nextAfter': next_after,
        'nextCursor': next_before if has_more else None,
    }


async def create_chat_message(
    con: Any,
    class_row: dict[str, Any],
    user: dict[str, Any],
    raw_body: Any,
    *,
    bus: LiveChatBus | None = None,
) -> tuple[dict[str, Any] | None, str | None, int]:
    """Validate, rate-limit, persist, and broadcast a chat message.
    Returns `(message_dto, error_code, http_status)`.
    """
    if not await can_user_access_class(con, user, class_row):
        return None, 'forbidden', 403

    # The join window allows students to open the waiting room before a lesson.
    # Chat, however, is writable ONLY after the teacher explicitly marks it Live.
    # This applies to staff as well: frontend and backend must agree on read-only.
    status = class_row.get('status') or 'upcoming'
    if status != 'live':
        return None, 'class_not_started' if status == 'upcoming' else 'chat_closed', 409

    cleaned = sanitize_chat_message(raw_body)
    if cleaned is None:
        return None, 'invalid_message', 400

    uid_str = str(user['id'])
    cid_str = str(class_row['id'])
    is_student = user.get('role') == 'student'

    if is_student:
        now_mono = time.monotonic()
        last_mono = _chat_last_sent.get((cid_str, uid_str))
        if last_mono is not None and (now_mono - last_mono) < CHAT_COOLDOWN_SECONDS:
            return None, 'rate_limited', 429

        recent_at = await con.fetchval(
            '''SELECT created_at FROM live_class_messages
               WHERE live_class_id = $1 AND sender_user_id = $2
               ORDER BY created_at DESC LIMIT 1''',
            class_row['id'],
            user['id'],
        )
        if recent_at:
            recent_dt = parse_iso_datetime(recent_at)
            if recent_dt and (datetime.now(timezone.utc) - recent_dt).total_seconds() < CHAT_COOLDOWN_SECONDS:
                _chat_last_sent[(cid_str, uid_str)] = now_mono
                return None, 'rate_limited', 429
        _chat_last_sent[(cid_str, uid_str)] = now_mono

    now = datetime.now(timezone.utc)
    try:
        inserted = await con.fetchrow(
            '''INSERT INTO live_class_messages(live_class_id, sender_user_id, body, created_at)
               SELECT $1, $2, $3, $4
               FROM live_classes WHERE id = $1 AND status = 'live'
               FOR SHARE
               RETURNING id, created_at''',
            class_row['id'],
            user['id'],
            cleaned,
            now,
        )
    except Exception:
        LOG.error('Failed to persist chat message for class %s', cid_str, exc_info=True)
        return None, 'persistence_failed', 503

    if not inserted:
        # Atomic database status check: the teacher may have ended the lesson
        # after our initial SELECT but before this INSERT. Never persist a late
        # message just because a previously fetched class_row said 'live'.
        return None, 'chat_closed', 409
    if not inserted.get('id'):
        LOG.error('Chat message insert returned no id for class %s', cid_str)
        return None, 'persistence_failed', 503

    msg = {
        'id': str(inserted['id']),
        'classId': cid_str,
        'senderId': uid_str,
        'senderName': user.get('name') or 'Learner',
        'senderRole': user.get('role') or 'student',
        'body': cleaned,
        'createdAt': chat_iso(inserted['created_at'] if inserted.get('created_at') else now),
    }
    target_bus = bus or chat_bus
    await target_bus.broadcast(con, cid_str, {'type': 'message', 'message': msg})
    return msg, None, 200


async def moderate_delete_chat_message(
    con: Any,
    class_row: dict[str, Any],
    user: dict[str, Any],
    message_id: str,
) -> tuple[bool, str | None, int]:
    """Delete/moderate a chat message. Only the assigned teacher, authorized admin, or owner may moderate."""
    if not can_user_manage_class(user, class_row):
        return False, 'forbidden', 403
    if not is_js_uuid(message_id):
        return False, 'not_found', 404

    deleted = await con.fetchrow(
        '''UPDATE live_class_messages
           SET is_deleted = TRUE, deleted_by_user_id = $3, deleted_at = NOW()
           WHERE id = $1 AND live_class_id = $2 AND is_deleted = FALSE
           RETURNING id''',
        uuid.UUID(message_id),
        class_row['id'],
        user['id'],
    )
    if not deleted:
        return False, 'not_found', 404

    cid_str = str(class_row['id'])
    await chat_bus.broadcast(
        con,
        cid_str,
        {'type': 'message_deleted', 'classId': cid_str, 'messageId': str(deleted['id'])},
    )
    return True, None, 200


# ---------------------------------------------------------------------------
# HTTP Endpoints for Student & Teacher Live Classes
# ---------------------------------------------------------------------------

@router.get('/api/live-classes')
async def list_live_classes_api(req: Request):
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    db = await core.pool()
    async with db.acquire() as con:
        from .browser_activity import live_classes as load_student_live_classes
        data = await load_student_live_classes(con, user['id'], user=user)
    return core.j({'ok': True, **data}, headers=core.PRIVATE)



@router.get('/api/live-classes/recordings')
async def get_live_class_recordings_api(req: Request):
    """Authorized, deterministic archive pagination. No fixed total-recording cap."""
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    from .browser_activity import load_recording_archive_page
    db = await core.pool()
    async with db.acquire() as con:
        result = await load_recording_archive_page(
            con, user, before=req.query_params.get('before'))
    return core.j({'ok': True, **result}, headers=core.PRIVATE)


@router.get('/api/live-classes/{id}')
async def get_live_class_detail_api(req: Request, id: str):
    if not is_js_uuid(id):
        return core.j({'error': 'not_found'}, 404)
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    db = await core.pool()
    async with db.acquire() as con:
        detail, err_code, status_code = await load_single_live_class_view(req, con, user, id)
        if err_code:
            return core.j({'error': err_code}, status_code, headers=core.PRIVATE)
    return core.j({'ok': True, **detail}, headers=core.PRIVATE)


async def load_single_live_class_view(
    req: Request,
    con: Any,
    user: dict[str, Any],
    class_id: str,
) -> tuple[dict[str, Any] | None, str | None, int]:
    if not is_js_uuid(class_id):
        return None, 'not_found', 404
    row = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', uuid.UUID(class_id))
    if not row:
        return None, 'not_found', 404
    class_dict = dict(row)
    if not await can_user_access_class(con, user, class_dict):
        return None, 'forbidden', 403

    teacher_name = None
    if class_dict.get('teacher_user_id'):
        teacher_name = await con.fetchval('SELECT name FROM users WHERE id = $1 LIMIT 1', class_dict['teacher_user_id'])

    is_staff_manager = can_user_manage_class(user, class_dict)
    formatted = format_class_for_student(
        class_dict,
        teacher_name,
        expose_video_for_preview=is_staff_manager,
    )

    extended = await has_extended_live_schema(con)
    if extended:
        att_row = await con.fetchrow(
            '''SELECT joined_at, last_seen_at, left_at, estimated_duration_seconds, session_count
               FROM live_class_attendance
               WHERE live_class_id = $1 AND user_id = $2
               LIMIT 1''',
            class_dict['id'],
            user['id'],
        )
    else:
        att_row = await con.fetchrow(
            'SELECT joined_at FROM live_class_attendance WHERE live_class_id = $1 AND user_id = $2 LIMIT 1',
            class_dict['id'],
            user['id'],
        )

    attendance = (
        {
            'joined': True,
            'joinedAt': js_iso(att_row['joined_at']),
            'lastSeenAt': js_iso(att_row.get('last_seen_at') if isinstance(att_row, dict) or hasattr(att_row, 'get') else att_row['joined_at']),
            'leftAt': js_iso(att_row.get('left_at') if isinstance(att_row, dict) or hasattr(att_row, 'get') else None),
            'estimatedDurationSeconds': int((att_row.get('estimated_duration_seconds') if isinstance(att_row, dict) or hasattr(att_row, 'get') else 0) or 0),
        }
        if att_row
        else {
            'joined': False,
            'joinedAt': None,
            'lastSeenAt': None,
            'leftAt': None,
            'estimatedDurationSeconds': 0,
        }
    )

    chat_data = await fetch_chat_messages(con, class_dict['id'], limit=CHAT_HISTORY_DEFAULT_LIMIT)
    from .browser_common import material_blocks
    materials = await material_blocks(con, 'live_class', class_dict['id'])

    return (
        {
            'liveClass': formatted,
            'attendance': attendance,
            'chat': chat_data,
            'materials': materials,
            'canModerate': is_staff_manager,
            'embedOrigin': request_origin(req),
        },
        None,
        200,
    )


@router.post('/api/live-classes/{id}/attendance')
async def post_live_class_attendance(req: Request, id: str):
    if not is_js_uuid(id):
        return core.j({'error': 'not_found'}, 404)
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    body = await core.payload(req)
    action = body.get('action', 'heartbeat') if isinstance(body, dict) else 'heartbeat'
    if action not in ('join', 'heartbeat', 'leave'):
        return core.j({'error': 'invalid_input'}, 400)
    try:
        session_id = parse_attendance_session_id(body.get('sessionId') if isinstance(body, dict) else None)
    except ValueError:
        return core.j({'error': 'invalid_attendance_session_id'}, 400)

    db = await core.pool()
    async with db.acquire() as con:
        row = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', uuid.UUID(id))
        if not row:
            return core.j({'error': 'not_found'}, 404)
        class_dict = dict(row)
        if not await can_user_access_class(con, user, class_dict):
            return core.j({'error': 'forbidden'}, 403)

        join_state, opens = compute_join_window(class_dict)
        if action in ('join', 'heartbeat') and join_state != 'open' and class_dict.get('status') != 'live':
            return core.j({'error': join_state, 'opensAt': js_iso(opens), 'joined': False}, 409)

        async with con.transaction():
            # A per-student attendance row is locked for tab-aware events. Do not
            # serialize ALL students on a single live_classes parent-row lock.
            if session_id is None:
                await con.fetchrow('SELECT id FROM live_classes WHERE id = $1 FOR UPDATE', uuid.UUID(id))
            try:
                att = await record_student_attendance(con, class_dict, user, action=action, session_id=session_id)
            except ValueError as exc:
                if str(exc) != 'too_many_active_tabs':
                    raise
                return core.j({'error': 'too_many_active_tabs'}, 429, headers=core.PRIVATE)
    return core.j({'ok': True, **att}, headers=core.PRIVATE)


@router.get('/api/live-classes/{id}/chat')
async def get_live_class_chat(req: Request, id: str):
    if not is_js_uuid(id):
        return core.j({'error': 'not_found'}, 404)
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    before = req.query_params.get('before')
    after = req.query_params.get('after')
    if before and after:
        return core.j({'error': 'invalid_cursor'}, 400, headers=core.PRIVATE)
    _, _, before_ok = parse_chat_cursor(before)
    _, _, after_ok = parse_chat_cursor(after)
    if not before_ok or not after_ok:
        return core.j({'error': 'invalid_cursor'}, 400, headers=core.PRIVATE)

    raw_limit = req.query_params.get('limit')
    if raw_limit is not None:
        try:
            limit = int(raw_limit)
            if limit < 1:
                return core.j({'error': 'invalid_input'}, 400, headers=core.PRIVATE)
        except ValueError:
            return core.j({'error': 'invalid_input'}, 400, headers=core.PRIVATE)
    else:
        limit = CHAT_HISTORY_DEFAULT_LIMIT

    db = await core.pool()
    async with db.acquire() as con:
        row = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', uuid.UUID(id))
        if not row:
            return core.j({'error': 'not_found'}, 404)
        class_dict = dict(row)
        if not await can_user_access_class(con, user, class_dict):
            return core.j({'error': 'forbidden'}, 403)
        try:
            chat_data = await fetch_chat_messages(con, class_dict['id'], limit=limit, before=before, after=after)
        except ValueError:
            return core.j({'error': 'invalid_cursor'}, 400, headers=core.PRIVATE)
    return core.j(
        {
            'ok': True,
            'chatReadOnly': (class_dict.get('status') or 'upcoming') != 'live',
            **chat_data,
        },
        headers=core.PRIVATE,
    )


@router.post('/api/live-classes/{id}/chat')
async def post_live_class_chat(req: Request, id: str):
    if not is_js_uuid(id):
        return core.j({'error': 'not_found'}, 404)
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    body = await core.payload(req)
    text = body.get('body') if isinstance(body, dict) and 'body' in body else (body.get('message') if isinstance(body, dict) else None)

    db = await core.pool()
    async with db.acquire() as con:
        row = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', uuid.UUID(id))
        if not row:
            return core.j({'error': 'not_found'}, 404)
        class_dict = dict(row)
        msg, err, status_code = await create_chat_message(con, class_dict, user, text)
        if err:
            extra = {'retryAfterSeconds': int(CHAT_COOLDOWN_SECONDS)} if status_code == 429 else {}
            return core.j({'error': err, **extra}, status_code, headers=core.PRIVATE)
    return core.j({'ok': True, 'message': msg}, headers=core.PRIVATE)


@router.delete('/api/live-classes/{id}/chat/{message_id}')
async def delete_live_class_chat_message(req: Request, id: str, message_id: str):
    if not is_js_uuid(id) or not is_js_uuid(message_id):
        return core.j({'error': 'not_found'}, 404)
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()

    db = await core.pool()
    async with db.acquire() as con:
        row = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', uuid.UUID(id))
        if not row:
            return core.j({'error': 'not_found'}, 404)
        class_dict = dict(row)
        ok, err, status_code = await moderate_delete_chat_message(con, class_dict, user, message_id)
        if not ok:
            return core.j({'error': err}, status_code, headers=core.PRIVATE)
    return core.j({'ok': True, 'deletedId': message_id}, headers=core.PRIVATE)


@router.post('/api/teacher/live-classes/{id}/students')
async def assign_live_class_students(req: Request, id: str):
    if not is_js_uuid(id):
        return core.j({'error': 'not_found'}, 404)
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    if user['role'] not in ('teacher', 'admin', 'owner'):
        return core.j({'error': 'forbidden'}, 403)

    body = await core.payload(req)
    if not isinstance(body, dict):
        return core.j({'error': 'invalid_input'}, 400)

    access_scope = body.get('accessScope', 'assigned')
    if access_scope not in ACCESS_SCOPES:
        return core.j({'error': 'invalid_input'}, 400)

    raw_ids = body.get('studentIds', [])
    if not isinstance(raw_ids, list) or len(raw_ids) > 500 or any(not is_js_uuid(str(x)) for x in raw_ids):
        return core.j({'error': 'invalid_input'}, 400)
    student_ids = list(dict.fromkeys(str(x).lower() for x in raw_ids))

    db = await core.pool()
    async with db.acquire() as con:
        row = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', uuid.UUID(id))
        if not row:
            return core.j({'error': 'not_found'}, 404)
        class_dict = dict(row)
        if not can_user_manage_class(user, class_dict):
            return core.j({'error': 'forbidden'}, 403)

        if student_ids:
            if user['role'] != 'owner':
                roster_owner_id = class_dict.get('teacher_user_id') or user['id']
                valid_rows = await con.fetch(
                    '''SELECT u.id FROM users u
                       JOIN teacher_student_links l ON l.student_user_id = u.id
                       WHERE l.teacher_user_id = $1 AND u.role = 'student' AND u.id = ANY($2::uuid[])''',
                    roster_owner_id,
                    [uuid.UUID(s) for s in student_ids],
                )
            else:
                valid_rows = await con.fetch(
                    "SELECT id FROM users WHERE role = 'student' AND id = ANY($1::uuid[])",
                    [uuid.UUID(s) for s in student_ids],
                )
            valid_ids = [str(r['id']).lower() for r in valid_rows]
            if len(valid_ids) != len(student_ids):
                return core.j({'error': 'invalid_student_assignment'}, 400)

        async with con.transaction():
            await con.execute(
                'UPDATE live_classes SET access_scope = $2, updated_at = NOW() WHERE id = $1',
                class_dict['id'],
                access_scope,
            )
            await con.execute('DELETE FROM live_class_enrollments WHERE live_class_id = $1', class_dict['id'])
            for sid in student_ids:
                await con.execute(
                    '''INSERT INTO live_class_enrollments(live_class_id, user_id, assigned_by_user_id)
                       VALUES($1, $2, $3) ON CONFLICT (live_class_id, user_id) DO NOTHING''',
                    class_dict['id'],
                    uuid.UUID(sid),
                    user['id'],
                )
        await chat_bus.broadcast(con, str(class_dict['id']), {'type': '_access_recheck', 'classId': str(class_dict['id'])})
    access_bus.notify()
    return core.j({'ok': True, 'accessScope': access_scope, 'assignedCount': len(student_ids)}, headers=core.PRIVATE)


@router.post('/api/teacher/live-classes/{id}/check-recording')
async def check_live_class_recording(req: Request, id: str):
    if not is_js_uuid(id):
        return core.j({'error': 'not_found'}, 404)
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    if user['role'] not in ('teacher', 'admin', 'owner'):
        return core.j({'error': 'forbidden'}, 403)

    db = await core.pool()
    async with db.acquire() as con:
        row = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', uuid.UUID(id))
        if not row:
            return core.j({'error': 'not_found'}, 404)
        class_dict = dict(row)
        if not can_user_manage_class(user, class_dict):
            return core.j({'error': 'forbidden'}, 403)

        curr_st = (class_dict.get('status') or 'upcoming').lower()
        if curr_st in ('upcoming', 'cancelled'):
            return core.j({'error': 'invalid_status_transition'}, 409, headers=core.PRIVATE)

        video_id = class_dict.get('youtube_video_id')
        if not video_id and class_dict.get('meeting_url'):
            video_id, _ = extract_youtube_video_id(class_dict.get('meeting_url'))
        if not video_id:
            return core.j({'error': 'youtube_video_required'}, 400)

        yt_check = await verify_youtube_video_status(video_id)
        status = class_dict.get('status') or 'upcoming'
        recording_status = class_dict.get('recording_status') or 'none'
        duration_sec = class_dict.get('recording_duration_seconds')

        if yt_check.get('verified'):
            if not yt_check.get('found') or yt_check.get('privacyStatus') == 'private' or not yt_check.get('embeddable'):
                recording_status = 'unavailable'
                if status == 'recorded':
                    status = 'completed'
            elif yt_check.get('recordingReady'):
                recording_status = 'ready'
                status = 'recorded'
                if yt_check.get('durationSeconds'):
                    duration_sec = yt_check['durationSeconds']
            elif yt_check.get('hasEnded') and not yt_check.get('recordingReady'):
                recording_status = 'processing'
                if status == 'live':
                    status = 'completed'

            if await has_extended_live_schema(con):
                await con.execute(
                    '''UPDATE live_classes
                       SET status = $2,
                           recording_status = $3,
                           recording_duration_seconds = COALESCE($4, recording_duration_seconds),
                           updated_at = NOW()
                       WHERE id = $1''',
                    class_dict['id'],
                    status,
                    recording_status,
                    duration_sec,
                )

        lifecycle = compute_lifecycle_status(status, recording_status)
        return core.j(
            {
                'ok': True,
                'status': status,
                'recordingStatus': recording_status,
                'lifecycleStatus': lifecycle,
                'youtubeVideoId': video_id,
                'recordingDurationSeconds': duration_sec,
                'youtubeCheck': yt_check,
            },
            headers=core.PRIVATE,
        )


@router.get('/api/teacher/live-classes/{id}/attendance')
async def get_teacher_class_attendance(req: Request, id: str):
    if not is_js_uuid(id):
        return core.j({'error': 'not_found'}, 404)
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    if user['role'] not in ('teacher', 'admin', 'owner'):
        return core.j({'error': 'forbidden'}, 403)

    db = await core.pool()
    async with db.acquire() as con:
        row = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', uuid.UUID(id))
        if not row:
            return core.j({'error': 'not_found'}, 404)
        class_dict = dict(row)
        if not can_user_manage_class(user, class_dict):
            return core.j({'error': 'forbidden'}, 403)

        extended = await has_extended_live_schema(con)
        if extended:
            records = await con.fetch(
                '''SELECT u.id AS user_id, u.name, u.email,
                          a.joined_at, a.last_seen_at, a.left_at,
                          a.estimated_duration_seconds, a.session_count
                   FROM live_class_attendance a
                   JOIN users u ON u.id = a.user_id
                   WHERE a.live_class_id = $1
                   ORDER BY a.joined_at ASC''',
                class_dict['id'],
            )
            roster = [
                {
                    'userId': str(r['user_id']),
                    'name': r['name'],
                    'email': r['email'],
                    'joinedAt': js_iso(r['joined_at']),
                    'lastSeenAt': js_iso(r['last_seen_at']),
                    'leftAt': js_iso(r['left_at']),
                    'estimatedDurationSeconds': int(r['estimated_duration_seconds'] or 0),
                    'sessionCount': int(r['session_count'] or 1),
                }
                for r in records
            ]
        else:
            records = await con.fetch(
                '''SELECT u.id AS user_id, u.name, u.email, a.joined_at
                   FROM live_class_attendance a
                   JOIN users u ON u.id = a.user_id
                   WHERE a.live_class_id = $1
                   ORDER BY a.joined_at ASC''',
                class_dict['id'],
            )
            roster = [
                {
                    'userId': str(r['user_id']),
                    'name': r['name'],
                    'email': r['email'],
                    'joinedAt': js_iso(r['joined_at']),
                    'lastSeenAt': js_iso(r['joined_at']),
                    'leftAt': None,
                    'estimatedDurationSeconds': 0,
                    'sessionCount': 1,
                }
                for r in records
            ]

    return core.j(
        {
            'ok': True,
            'classId': str(class_dict['id']),
            'title': class_dict['title'],
            'attendeeCount': len(roster),
            'attendanceNote': 'Estimated page attendance based on authenticated join, heartbeat, and leave events.',
            'roster': roster,
        },
        headers=core.PRIVATE,
    )


# ---------------------------------------------------------------------------
# WebSocket Endpoint for Real-time Live Class Chat & Status Updates
# ---------------------------------------------------------------------------

def _check_ws_origin(ws: WebSocket) -> bool:
    origin = ws.headers.get('origin')
    if not origin:
        return True
    if origin == 'null':
        return False
    norm = normalize_origin(origin)
    if not norm:
        return False
    host = (ws.headers.get('x-forwarded-host') or ws.headers.get('host') or '').split(',')[0].strip()
    trusted = set()
    if host:
        for scheme in ('https', 'http'):
            o = normalize_origin(f'{scheme}://{host}')
            if o:
                trusted.add(o)
    for val in (os.environ.get('TRUSTED_ORIGINS', '').split(',') + [os.environ.get('PUBLIC_BASE_URL', '')]):
        o = normalize_origin(val)
        if o:
            trusted.add(o)
    return norm in trusted


async def _authenticate_ws(ws: WebSocket) -> dict[str, Any] | None:
    token_str = ws.cookies.get(SESSION_COOKIE)
    token = verify_token(token_str)
    if not token:
        return None
    expires_at = token.get('expiresAt')
    if isinstance(expires_at, (int, float)) and expires_at <= time.time():
        return None
    uid = core.uuid_value(token.get('sub'))
    if uid is None:
        return None
    try:
        db = await core.pool()
        async with db.acquire() as con:
            row = await con.fetchrow(
                '''SELECT id, name, email, role, account_status, locale,
                          onboarding_completed_at, status_reason, auth_version
                   FROM users
                   WHERE id = $1 AND auth_version = $2
                     AND NOT EXISTS (
                       SELECT 1 FROM auth_session_revocations r
                       WHERE r.token_hash = $3 AND r.user_id = $1 AND r.expires_at > NOW()
                     )
                   LIMIT 1''',
                uid,
                token['authVersion'],
                token['sessionKey'],
            )
    except Exception:
        LOG.error('Database failure during WebSocket authentication; denying fail-closed', exc_info=True)
        return None
    if not row or row.get('account_status') != 'active' or row.get('role') == 'guardian':
        return None
    user_dict = dict(row)
    user_dict['_session_expires_at'] = float(expires_at) if isinstance(expires_at, (int, float)) else None
    user_dict['_session_key'] = token.get('sessionKey')
    user_dict['_auth_version'] = token.get('authVersion')
    return user_dict


async def _verify_ws_session_and_access(
    ws: WebSocket,
    user: dict[str, Any],
    class_uuid: uuid.UUID,
) -> tuple[bool, int]:
    """Re-verify that the WebSocket user session has not expired or been revoked
    and that the user still has permission to access `class_uuid`.
    Returns `(authorized, ws_close_code)`.
    """
    expires_at = user.get('_session_expires_at')
    if isinstance(expires_at, (int, float)) and time.time() >= expires_at:
        return False, 4401

    try:
        fresh_user = await _authenticate_ws(ws)
        if not fresh_user or str(fresh_user.get('id')) != str(user.get('id')):
            return False, 4401

        db = await core.pool()
        async with db.acquire() as con:
            fresh_class = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', class_uuid)
            if not fresh_class:
                return False, 4404
            if not await can_user_access_class(con, fresh_user, dict(fresh_class)):
                return False, 4403

        user.update(fresh_user)
        return True, 0
    except Exception:
        LOG.error('WebSocket re-verification failed for class %s; closing fail-closed', class_uuid, exc_info=True)
        return False, 4403


@router.websocket('/api/live-classes/{id}/ws')
async def live_class_chat_ws(ws: WebSocket, id: str):
    if not _check_ws_origin(ws):
        await ws.close(code=4403)
        return
    if not is_js_uuid(id):
        await ws.close(code=4404)
        return

    user = await _authenticate_ws(ws)
    if not user:
        await ws.close(code=4401)
        return

    class_uuid = uuid.UUID(id)
    db = await core.pool()
    async with db.acquire() as con:
        row = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', class_uuid)
        if not row:
            await ws.close(code=4404)
            return
        class_dict = dict(row)
        if not await can_user_access_class(con, user, class_dict):
            await ws.close(code=4403)
            return

    dsn = os.environ.get('AUTH_EVENTS_DATABASE_URL', '').strip() or os.environ.get('DATABASE_URL', '').strip()
    user_id_str = str(user['id'])
    auth_version = user.get('_auth_version') if isinstance(user.get('_auth_version'), int) else None
    access_queue = await access_bus.subscribe(user_id_str, dsn, auth_version)
    if dsn:
        asyncio.create_task(access_bus.ready(dsn))

    queue = await chat_bus.subscribe(id, dsn)
    revoked_event = asyncio.Event()

    async def revoke_and_close(code: int = 4403) -> None:
        if revoked_event.is_set():
            return
        revoked_event.set()
        await chat_bus.unsubscribe(id, queue)
        while not queue.empty():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        try:
            await ws.close(code=code)
        except Exception:
            pass

    still_ok, init_code = await _verify_ws_session_and_access(ws, user, class_uuid)
    if not still_ok:
        await chat_bus.unsubscribe(id, queue)
        await access_bus.unsubscribe(user_id_str, access_queue)
        await ws.close(code=init_code)
        return

    await ws.accept()

    async def watch_access_and_expiry():
        while not revoked_event.is_set():
            expires_at = user.get('_session_expires_at')
            if isinstance(expires_at, (int, float)):
                remaining = expires_at - time.time()
                if remaining <= 0:
                    await revoke_and_close(4401)
                    return
                wait_timeout = min(WS_AUTH_RECHECK_INTERVAL_SECONDS, max(0.05, remaining))
            else:
                wait_timeout = WS_AUTH_RECHECK_INTERVAL_SECONDS

            try:
                await asyncio.wait_for(access_queue.get(), timeout=wait_timeout)
            except asyncio.TimeoutError:
                pass

            while not access_queue.empty():
                try:
                    access_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

            if revoked_event.is_set():
                return

            ok_now, close_code = await _verify_ws_session_and_access(ws, user, class_uuid)
            if not ok_now:
                await revoke_and_close(close_code)
                return

    async def forward_outbound():
        while not revoked_event.is_set():
            event = await queue.get()
            if revoked_event.is_set():
                return

            expires_at = user.get('_session_expires_at')
            if isinstance(expires_at, (int, float)) and time.time() >= expires_at:
                await revoke_and_close(4401)
                return

            is_recheck = isinstance(event, dict) and event.get('type') == '_access_recheck'
            if is_recheck or not access_queue.empty():
                while not access_queue.empty():
                    try:
                        access_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                ok_now, close_code = await _verify_ws_session_and_access(ws, user, class_uuid)
                if not ok_now:
                    await revoke_and_close(close_code)
                    return
                if is_recheck:
                    continue

            await ws.send_json(event)

    watch_task = asyncio.create_task(watch_access_and_expiry())
    outbound_task = asyncio.create_task(forward_outbound())
    try:
        status = class_dict.get('status') or 'upcoming'
        rec_status = class_dict.get('recording_status') or 'none'
        await ws.send_json({
            'type': 'ready',
            'classId': id,
            'status': status,
            'lifecycleStatus': compute_lifecycle_status(status, rec_status),
            'chatReadOnly': status != 'live',
            'canModerate': can_user_manage_class(user, class_dict),
        })

        while not revoked_event.is_set():
            raw_msg = await ws.receive_text()
            if revoked_event.is_set():
                break
            if len(raw_msg) > 4096:
                await ws.send_json({'type': 'error', 'error': 'payload_too_large'})
                continue
            try:
                frame = json.loads(raw_msg)
            except ValueError:
                await ws.send_json({'type': 'error', 'error': 'invalid_json'})
                continue
            if not isinstance(frame, dict):
                continue

            msg_type = frame.get('type')
            if msg_type == 'ping':
                expires_at = user.get('_session_expires_at')
                if isinstance(expires_at, (int, float)) and time.time() >= expires_at:
                    await revoke_and_close(4401)
                    break
                if not access_queue.empty():
                    while not access_queue.empty():
                        try:
                            access_queue.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                    ok_now, close_code = await _verify_ws_session_and_access(ws, user, class_uuid)
                    if not ok_now:
                        await revoke_and_close(close_code)
                        break
                await ws.send_json({'type': 'pong', 'ts': js_iso(datetime.now(timezone.utc))})
                continue

            ok_now, close_code = await _verify_ws_session_and_access(ws, user, class_uuid)
            if not ok_now:
                await revoke_and_close(close_code)
                break

            if msg_type == 'sync':
                after_cursor = frame.get('after')
                _, _, cursor_ok = parse_chat_cursor(after_cursor)
                if not cursor_ok:
                    await ws.send_json({'type': 'error', 'error': 'invalid_cursor', 'status': 400})
                    continue
                async with db.acquire() as con:
                    sync_data = await fetch_chat_messages(con, class_uuid, limit=50, after=after_cursor)
                await ws.send_json({'type': 'sync_result', **sync_data})
                continue

            if msg_type == 'send_message':
                async with db.acquire() as con:
                    fresh_class = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', class_uuid)
                    if not fresh_class:
                        await ws.send_json({'type': 'error', 'error': 'not_found'})
                        continue
                    msg, err, status_code = await create_chat_message(con, dict(fresh_class), user, frame.get('body'))
                if err:
                    await ws.send_json({'type': 'error', 'error': err, 'status': status_code})
                continue

            if msg_type == 'delete_message':
                target_id = str(frame.get('messageId') or '')
                async with db.acquire() as con:
                    fresh_class = await con.fetchrow('SELECT * FROM live_classes WHERE id = $1 LIMIT 1', class_uuid)
                    if not fresh_class:
                        await ws.send_json({'type': 'error', 'error': 'not_found'})
                        continue
                    ok, err, status_code = await moderate_delete_chat_message(con, dict(fresh_class), user, target_id)
                if not ok:
                    await ws.send_json({'type': 'error', 'error': err, 'status': status_code})
                continue
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        revoked_event.set()
        for t in (watch_task, outbound_task):
            t.cancel()
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        await chat_bus.unsubscribe(id, queue)
        await access_bus.unsubscribe(user_id_str, access_queue)


def install():
    core.app.include_router(router)
