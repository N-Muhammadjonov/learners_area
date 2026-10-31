"""Comprehensive unit, integration, security regression, migration consolidation,
multi-worker recovery, cursor pagination, and 100-real-WebSocket-client capacity tests
for the Learners Area Live Classes system.
"""
import asyncio
import datetime as dt
import json
import os
import pathlib
import socket
import sqlite3
import time
import uuid
from collections import defaultdict
from uuid import UUID
from unittest.mock import AsyncMock

import pytest
import uvicorn
import wsproto
from fastapi import HTTPException
from wsproto import ConnectionType, WSConnection
from wsproto.events import (
    AcceptConnection,
    CloseConnection,
    Message,
    Ping,
    Request as WSRequest,
    TextMessage,
)
from starlette.requests import Request

from app import main as core
from app import live_classes_port as lc
from app import center_admin_port as ca
from app import browser_staff_people as bsp
from app import browser_staff as bs
from app.security import issue_token


OWNER_ID = UUID("00000000-0000-4000-8000-000000000001")
AUTH_ADMIN_ID = UUID("00000000-0000-4000-8000-000000000002")
UNAUTH_ADMIN_ID = UUID("00000000-0000-4000-8000-000000000003")
TEACHER_A_ID = UUID("00000000-0000-4000-8000-000000000011")
TEACHER_B_ID = UUID("00000000-0000-4000-8000-000000000012")
STUDENT_1_ID = UUID("00000000-0000-4000-8000-000000000021")
STUDENT_2_ID = UUID("00000000-0000-4000-8000-000000000022")
STUDENT_3_NO_COURSE_ID = UUID("00000000-0000-4000-8000-000000000023")

CLASS_A_ID = UUID("11111111-1111-4111-8111-111111111101")
CLASS_B_ID = UUID("11111111-1111-4111-8111-111111111102")
CLASS_COURSE_ID = UUID("11111111-1111-4111-8111-111111111103")
CLASS_ROSTER_ID = UUID("11111111-1111-4111-8111-111111111104")
CLASS_ADMIN_ID = UUID("11111111-1111-4111-8111-111111111105")
COURSE_ID = UUID("22222222-2222-4222-8222-222222222201")


class InMemoryLiveClassesDB:
    """In-memory relational database double for Live Classes, Course Enrollments,
    Class Enrollments, Teacher Roster Links, Revocations, Messages, Attendance,
    and optional cross-worker pg_notify callback simulation.
    """

    def __init__(self, fail_access_check=False, fail_insert_message=False, fail_pg_notify=False):
        now = dt.datetime.now(dt.timezone.utc)
        self.fail_access_check = fail_access_check
        self.fail_insert_message = fail_insert_message
        self.fail_pg_notify = fail_pg_notify
        self.active_acquires = 0
        self.max_concurrent_acquires = 0
        self.pg_notify_listeners = []
        self.query_count = 0

        self.users = {
            OWNER_ID: {"id": OWNER_ID, "name": "Platform Owner", "email": "owner@la.uz", "role": "owner", "account_status": "active", "locale": "en", "onboarding_completed_at": now, "status_reason": None, "auth_version": 1},
            AUTH_ADMIN_ID: {"id": AUTH_ADMIN_ID, "name": "Authorized Admin", "email": "admin1@la.uz", "role": "admin", "account_status": "active", "locale": "en", "onboarding_completed_at": now, "status_reason": None, "auth_version": 1},
            UNAUTH_ADMIN_ID: {"id": UNAUTH_ADMIN_ID, "name": "Unauthorized Admin", "email": "admin2@la.uz", "role": "admin", "account_status": "active", "locale": "en", "onboarding_completed_at": now, "status_reason": None, "auth_version": 1},
            TEACHER_A_ID: {"id": TEACHER_A_ID, "name": "Ms. Madina", "email": "madina@la.uz", "role": "teacher", "account_status": "active", "locale": "en", "onboarding_completed_at": now, "status_reason": None, "auth_version": 1},
            TEACHER_B_ID: {"id": TEACHER_B_ID, "name": "Mr. Rustam", "email": "rustam@la.uz", "role": "teacher", "account_status": "active", "locale": "en", "onboarding_completed_at": now, "status_reason": None, "auth_version": 1},
            STUDENT_1_ID: {"id": STUDENT_1_ID, "name": "Ali Student", "email": "ali@la.uz", "role": "student", "account_status": "active", "locale": "en", "onboarding_completed_at": now, "status_reason": None, "auth_version": 1},
            STUDENT_2_ID: {"id": STUDENT_2_ID, "name": "Zarina Student", "email": "zarina@la.uz", "role": "student", "account_status": "active", "locale": "en", "onboarding_completed_at": now, "status_reason": None, "auth_version": 1},
            STUDENT_3_NO_COURSE_ID: {"id": STUDENT_3_NO_COURSE_ID, "name": "Unenrolled Student", "email": "no-course@la.uz", "role": "student", "account_status": "active", "locale": "en", "onboarding_completed_at": now, "status_reason": None, "auth_version": 1},
        }
        self.revoked_session_keys = set()
        self.courses = {
            COURSE_ID: {"id": COURSE_ID, "slug": "ielts", "title": "IELTS Intensive"},
        }
        self.course_enrollments = {
            (STUDENT_1_ID, COURSE_ID),
            (STUDENT_2_ID, COURSE_ID),
        }
        self.course_entitlements = set()

        self.classes = {
            CLASS_A_ID: {
                "id": CLASS_A_ID,
                "course_id": COURSE_ID,
                "title": "IELTS Academic Writing Task 2 Live",
                "topic": "Essay structure and coherence live workshop",
                "description": "Essay structure and coherence live workshop",
                "teacher_user_id": TEACHER_A_ID,
                "scheduled_at": now + dt.timedelta(minutes=30),
                "duration_minutes": 120,
                "meeting_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "recording_url": None,
                "youtube_video_id": "dQw4w9WgXcQ",
                "status": "upcoming",
                "recording_status": "none",
                "started_at": None,
                "ended_at": None,
                "recording_duration_seconds": None,
                "access_scope": "assigned",
                "created_at": now - dt.timedelta(days=1),
                "updated_at": now - dt.timedelta(hours=1),
            },
            CLASS_B_ID: {
                "id": CLASS_B_ID,
                "course_id": COURSE_ID,
                "title": "Speaking Part 3 Masterclass",
                "topic": "Other teacher class",
                "description": "Other teacher class",
                "teacher_user_id": TEACHER_B_ID,
                "scheduled_at": now + dt.timedelta(hours=2),
                "duration_minutes": 90,
                "meeting_url": "https://www.youtube.com/watch?v=M7lc1UVf-VE",
                "recording_url": None,
                "youtube_video_id": "M7lc1UVf-VE",
                "status": "live",
                "recording_status": "none",
                "started_at": now - dt.timedelta(minutes=10),
                "ended_at": None,
                "recording_duration_seconds": None,
                "access_scope": "assigned",
                "created_at": now - dt.timedelta(days=1),
                "updated_at": now - dt.timedelta(minutes=10),
            },
            CLASS_COURSE_ID: {
                "id": CLASS_COURSE_ID,
                "course_id": COURSE_ID,
                "title": "Course-Wide Listening Strategy Live",
                "topic": "Course-scoped class",
                "description": "Course-scoped class",
                "teacher_user_id": TEACHER_A_ID,
                "scheduled_at": now + dt.timedelta(hours=1),
                "duration_minutes": 60,
                "meeting_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "recording_url": None,
                "youtube_video_id": "dQw4w9WgXcQ",
                "status": "live",
                "recording_status": "none",
                "started_at": now - dt.timedelta(minutes=5),
                "ended_at": None,
                "recording_duration_seconds": None,
                "access_scope": "course",
                "created_at": now - dt.timedelta(days=1),
                "updated_at": now - dt.timedelta(minutes=5),
            },
            CLASS_ROSTER_ID: {
                "id": CLASS_ROSTER_ID,
                "course_id": COURSE_ID,
                "title": "Teacher A Roster Workshop",
                "topic": "Teacher roster scoped class",
                "description": "Teacher roster scoped class",
                "teacher_user_id": TEACHER_A_ID,
                "scheduled_at": now + dt.timedelta(hours=3),
                "duration_minutes": 60,
                "meeting_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "recording_url": None,
                "youtube_video_id": "dQw4w9WgXcQ",
                "status": "live",
                "recording_status": "none",
                "started_at": now - dt.timedelta(minutes=5),
                "ended_at": None,
                "recording_duration_seconds": None,
                "access_scope": "teacher_roster",
                "created_at": now - dt.timedelta(days=1),
                "updated_at": now - dt.timedelta(minutes=5),
            },
            CLASS_ADMIN_ID: {
                "id": CLASS_ADMIN_ID,
                "course_id": COURSE_ID,
                "title": "Admin-Hosted Orientation Live",
                "topic": "Admin assigned class",
                "description": "Admin assigned class",
                "teacher_user_id": AUTH_ADMIN_ID,
                "scheduled_at": now + dt.timedelta(hours=4),
                "duration_minutes": 60,
                "meeting_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "recording_url": None,
                "youtube_video_id": "dQw4w9WgXcQ",
                "status": "upcoming",
                "recording_status": "none",
                "started_at": None,
                "ended_at": None,
                "recording_duration_seconds": None,
                "access_scope": "assigned",
                "created_at": now - dt.timedelta(days=1),
                "updated_at": now - dt.timedelta(minutes=5),
            },
        }
        self.enrollments = {
            CLASS_A_ID: {STUDENT_1_ID},
            CLASS_B_ID: {STUDENT_2_ID},
            CLASS_ADMIN_ID: {STUDENT_1_ID},
        }
        self.teacher_links = {
            TEACHER_A_ID: {STUDENT_1_ID},
            TEACHER_B_ID: {STUDENT_2_ID},
            AUTH_ADMIN_ID: {STUDENT_1_ID},
            UNAUTH_ADMIN_ID: set(),
        }
        self.messages = []
        self.attendance = {
            (CLASS_A_ID, STUDENT_1_ID): {
                "id": UUID(int=901),
                "live_class_id": CLASS_A_ID,
                "user_id": STUDENT_1_ID,
                "joined_at": now - dt.timedelta(minutes=15),
                "last_seen_at": now - dt.timedelta(minutes=5),
                "left_at": None,
                "estimated_duration_seconds": 600,
                "session_count": 1,
            },
            (CLASS_B_ID, STUDENT_2_ID): {
                "id": UUID(int=902),
                "live_class_id": CLASS_B_ID,
                "user_id": STUDENT_2_ID,
                "joined_at": now - dt.timedelta(minutes=10),
                "last_seen_at": now - dt.timedelta(minutes=2),
                "left_at": None,
                "estimated_duration_seconds": 480,
                "session_count": 1,
            },
            (CLASS_ADMIN_ID, STUDENT_1_ID): {
                "id": UUID(int=903),
                "live_class_id": CLASS_ADMIN_ID,
                "user_id": STUDENT_1_ID,
                "joined_at": now - dt.timedelta(minutes=8),
                "last_seen_at": now - dt.timedelta(minutes=1),
                "left_at": None,
                "estimated_duration_seconds": 420,
                "session_count": 1,
            },
        }

    async def __aenter__(self):
        self.active_acquires += 1
        if self.active_acquires > self.max_concurrent_acquires:
            self.max_concurrent_acquires = self.active_acquires
        return self

    async def __aexit__(self, *args):
        self.active_acquires = max(0, self.active_acquires - 1)

    def transaction(self):
        return self

    async def fetchval(self, sql, *args):
        self.query_count += 1
        s = " ".join(sql.split())
        if "to_regclass('public.live_class_messages')" in s:
            return "live_class_messages"
        if "SELECT id FROM courses WHERE slug='ielts'" in s:
            return COURSE_ID
        if "SELECT name FROM users WHERE id = $1" in s:
            uid = UUID(str(args[0]))
            return self.users.get(uid, {}).get("name")
        if "SELECT 1 FROM live_class_enrollments WHERE live_class_id=$1 AND user_id=$2" in s:
            if self.fail_access_check:
                raise RuntimeError("Simulated DB error on live_class_enrollments")
            cid, uid = UUID(str(args[0])), UUID(str(args[1]))
            return 1 if uid in self.enrollments.get(cid, set()) else None
        if "SELECT 1 FROM teacher_student_links WHERE teacher_user_id=$1 AND student_user_id=$2" in s:
            if self.fail_access_check:
                raise RuntimeError("Simulated DB error on teacher_student_links")
            tid, uid = UUID(str(args[0])), UUID(str(args[1]))
            return 1 if uid in self.teacher_links.get(tid, set()) else None
        if "FROM enrollments WHERE user_id=$1 AND course_id=$2" in s:
            if self.fail_access_check:
                raise RuntimeError("Simulated DB error on enrollments")
            uid, cid = UUID(str(args[0])), UUID(str(args[1]))
            if (uid, cid) in self.course_enrollments or (uid, cid) in self.course_entitlements:
                return 1
            return None
        if "SELECT created_at FROM live_class_messages WHERE live_class_id = $1 AND sender_user_id = $2" in s:
            cid, uid = UUID(str(args[0])), UUID(str(args[1]))
            own = [m for m in self.messages if m["live_class_id"] == cid and m["sender_user_id"] == uid]
            if not own:
                return None
            own.sort(key=lambda m: m["created_at"], reverse=True)
            return own[0]["created_at"]
        if "SELECT count(*)::int FROM live_classes x" in s:
            if "WHERE teacher_user_id=$1" in s:
                tid = UUID(str(args[0]))
                return sum(1 for c in self.classes.values() if c["teacher_user_id"] == tid)
            return len(self.classes)
        if "SELECT pg_notify" in s:
            if self.fail_pg_notify:
                raise RuntimeError("Simulated pg_notify error")
            payload = str(args[0])
            for cb in list(self.pg_notify_listeners):
                cb(None, 0, "la_live_class_chat", payload)
            return None
        raise AssertionError(f"Unhandled fetchval SQL: {s}")

    async def fetchrow(self, sql, *args):
        self.query_count += 1
        s = " ".join(sql.split())
        if "FROM users WHERE id = $1 AND auth_version = $2" in s:
            uid, ver, skey = UUID(str(args[0])), int(args[1]), str(args[2])
            if skey in self.revoked_session_keys:
                return None
            u = self.users.get(uid)
            if not u or u.get("auth_version") != ver:
                return None
            return dict(u)
        if "SELECT id FROM courses WHERE slug=" in s:
            return {"id": COURSE_ID}
        if "SELECT course_id FROM live_classes WHERE id=$1" in s:
            cid = UUID(str(args[0]))
            c = self.classes.get(cid)
            return {"course_id": c["course_id"]} if c else None
        if "SELECT * FROM live_classes WHERE id=$1 AND teacher_user_id=$2" in s:
            cid, tid = UUID(str(args[0])), UUID(str(args[1]))
            c = self.classes.get(cid)
            if not c or c.get("teacher_user_id") != tid:
                return None
            return dict(c)
        if "SELECT * FROM live_classes WHERE id = $1" in s or "SELECT * FROM live_classes WHERE id=$1" in s or "SELECT * FROM live_classes x WHERE x.id=$1" in s:
            cid = UUID(str(args[0]))
            c = self.classes.get(cid)
            return dict(c) if c else None
        if "SELECT id FROM live_classes WHERE id = $1 FOR UPDATE" in s:
            cid = UUID(str(args[0]))
            return {"id": cid} if cid in self.classes else None
        if "INSERT INTO live_classes(" in s:
            new_id = UUID(int=500 + len(self.classes) + 1)
            course_id, teacher_id, title, topic, desc, sched, dur, m_url, yt_id, scope = args
            now = dt.datetime.now(dt.timezone.utc)
            self.classes[new_id] = {
                "id": new_id,
                "course_id": course_id,
                "title": title,
                "topic": topic,
                "description": desc,
                "teacher_user_id": teacher_id,
                "scheduled_at": sched,
                "duration_minutes": dur,
                "meeting_url": m_url,
                "recording_url": None,
                "youtube_video_id": yt_id,
                "status": "upcoming",
                "recording_status": "none",
                "started_at": None,
                "ended_at": None,
                "recording_duration_seconds": None,
                "access_scope": scope,
                "created_at": now,
                "updated_at": now,
            }
            return {"id": new_id}
        if "UPDATE live_classes SET " in s and "WHERE id=$1 RETURNING *" in s:
            cid = UUID(str(args[0]))
            c = self.classes.get(cid)
            if not c:
                return None
            clause = s.split("SET ")[1].split(" WHERE id=$1")[0]
            for i, item in enumerate(clause.split(", ")):
                col = item.split("=")[0].strip()
                c[col] = args[i + 1]
            return dict(c)
        if "FROM live_class_attendance WHERE live_class_id = $1 AND user_id = $2" in s or "FROM live_class_attendance WHERE live_class_id=$1 AND user_id=$2" in s:
            cid, uid = UUID(str(args[0])), UUID(str(args[1]))
            rec = self.attendance.get((cid, uid))
            return dict(rec) if rec else None
        if "INSERT INTO live_class_attendance(" in s:
            cid, uid, now = UUID(str(args[0])), UUID(str(args[1])), args[2]
            rec = {
                "id": UUID(int=900 + len(self.attendance) + 1),
                "live_class_id": cid,
                "user_id": uid,
                "joined_at": now,
                "last_seen_at": now,
                "left_at": None,
                "estimated_duration_seconds": 0,
                "session_count": 1,
            }
            self.attendance[(cid, uid)] = rec
            return dict(rec)
        if "UPDATE live_class_attendance SET last_seen_at = $3" in s:
            cid, uid, now, left_at, dur, sess = UUID(str(args[0])), UUID(str(args[1])), args[2], args[3], args[4], args[5]
            rec = self.attendance[(cid, uid)]
            rec["last_seen_at"] = now
            rec["left_at"] = left_at
            rec["estimated_duration_seconds"] = dur
            rec["session_count"] = sess
            return dict(rec)
        if "INSERT INTO live_class_messages(" in s:
            if self.fail_insert_message:
                raise RuntimeError("Simulated message INSERT error")
            cid, uid, body, now = UUID(str(args[0])), UUID(str(args[1])), args[2], args[3]
            # Mirror the atomic INSERT..SELECT live-state predicate. A class
            # can end after an earlier SELECT but before a chat INSERT.
            if "FROM live_classes WHERE id = $1 AND status = 'live'" in s and (
                self.classes.get(cid, {}).get('status') != 'live'
            ):
                return None
            mid = uuid.uuid4()
            msg = {
                "id": mid,
                "live_class_id": cid,
                "sender_user_id": uid,
                "body": body,
                "created_at": now,
                "is_deleted": False,
                "deleted_by_user_id": None,
                "deleted_at": None,
            }
            self.messages.append(msg)
            return dict(msg)
        if "UPDATE live_class_messages SET is_deleted = TRUE" in s:
            mid, cid, actor_id = UUID(str(args[0])), UUID(str(args[1])), UUID(str(args[2]))
            for m in self.messages:
                if m["id"] == mid and m["live_class_id"] == cid and not m["is_deleted"]:
                    m["is_deleted"] = True
                    m["deleted_by_user_id"] = actor_id
                    m["deleted_at"] = dt.datetime.now(dt.timezone.utc)
                    return {"id": mid}
            return None
        raise AssertionError(f"Unhandled fetchrow SQL: {s}")

    async def fetch(self, sql, *args):
        self.query_count += 1
        s = " ".join(sql.split())
        if "FROM live_classes l" in s and "AND l.status IN ('completed','recorded')" in s and "LIMIT $5" in s:
            course_id, uid, cursor_at, cursor_id, limit = args
            course_id, uid = UUID(str(course_id)), UUID(str(uid))
            records = [dict(c) for c in self.classes.values() if c['course_id'] == course_id and c['status'] in ('completed','recorded')]
            if 'l.teacher_user_id=$2::uuid' in s:
                records = [r for r in records if r['teacher_user_id'] == uid]
            elif 'COALESCE(l.access_scope' in s:
                def accessible(r):
                    scope = r.get('access_scope') or 'course'
                    if scope == 'course':
                        return (uid,course_id) in self.course_enrollments or (uid,course_id) in self.course_entitlements
                    if scope == 'assigned':
                        return uid in self.enrollments.get(r['id'],set())
                    return uid in self.teacher_links.get(r['teacher_user_id'],set()) if scope == 'teacher_roster' else False
                records = [r for r in records if accessible(r)]
            elif 'EXISTS (SELECT 1 FROM enrollments' in s:
                records = [r for r in records if (uid,course_id) in self.course_enrollments or (uid,course_id) in self.course_entitlements]
            records.sort(key=lambda r:(r['scheduled_at'],r['id']),reverse=True)
            if cursor_at is not None:
                records = [r for r in records if (r['scheduled_at'],r['id']) < (cursor_at, cursor_id)]
            return records[:limit]
        if "FROM live_classes l" in s and "ORDER BY l.scheduled_at DESC" in s:
            rows = []
            for c in self.classes.values():
                if "WHERE l.teacher_user_id=$1" in s:
                    tid = UUID(str(args[0]))
                    if c["teacher_user_id"] != tid:
                        continue
                att_count = sum(1 for (k_cid, _) in self.attendance if k_cid == c["id"])
                rows.append({**c, "attendees": att_count})
            rows.sort(key=lambda r: r["scheduled_at"], reverse=True)
            return rows
        if "FROM live_classes x" in s and "student_visible" in s:
            rows = []
            for c in self.classes.values():
                if "WHERE teacher_user_id=$1" in s:
                    tid = UUID(str(args[0]))
                    if c["teacher_user_id"] != tid:
                        continue
                rows.append({"id": c["id"], "title": c["title"], "student_visible": True})
            rows.sort(key=lambda r: (r["title"], str(r["id"])))
            return rows
        if "SELECT live_class_id, user_id FROM live_class_enrollments WHERE live_class_id = ANY($1::uuid[])" in s:
            wanted = {UUID(str(x)) for x in args[0]}
            out = []
            for cid in wanted:
                for uid in sorted(self.enrollments.get(cid, set()), key=str):
                    out.append({"live_class_id": cid, "user_id": uid})
            return out
        if "FROM live_class_enrollments e JOIN users u ON u.id = e.user_id WHERE e.live_class_id = $1" in s:
            cid = UUID(str(args[0]))
            uids = sorted(self.enrollments.get(cid, set()), key=str)
            return [{"id": uid, "name": self.users[uid]["name"], "email": self.users[uid]["email"]} for uid in uids if uid in self.users]
        if "SELECT u.id, u.name, u.email FROM users u JOIN teacher_student_links l" in s:
            tid = UUID(str(args[0]))
            linked = self.teacher_links.get(tid, set())
            return [{"id": uid, "name": self.users[uid]["name"], "email": self.users[uid]["email"]} for uid in sorted(linked, key=str) if uid in self.users]
        if "SELECT id, name, email FROM users WHERE role = 'student' AND account_status = 'active'" in s:
            return [{"id": uid, "name": u["name"], "email": u["email"]} for uid, u in sorted(self.users.items(), key=lambda x: str(x[0])) if u["role"] == "student" and u["account_status"] == "active"]
        if "FROM live_classes WHERE course_id=$1 AND status IN ('upcoming','live')" in s:
            cid = UUID(str(args[0]))
            rows = [dict(c) for c in self.classes.values() if c["course_id"] == cid and c["status"] in ("upcoming", "live")]
            rows.sort(key=lambda r: (0 if r["status"] == "live" else 1, r["scheduled_at"]))
            return rows
        if "FROM live_classes WHERE course_id=$1 AND status IN ('completed','recorded','cancelled')" in s:
            cid = UUID(str(args[0]))
            rows = [dict(c) for c in self.classes.values() if c["course_id"] == cid and c["status"] in ("completed", "recorded", "cancelled")]
            rows.sort(key=lambda r: r["scheduled_at"], reverse=True)
            return rows
        if "SELECT live_class_id,joined_at FROM live_class_attendance WHERE user_id=$1" in s:
            uid = UUID(str(args[0]))
            wanted = {UUID(str(x)) for x in args[1]}
            return [{"live_class_id": cid, "joined_at": rec["joined_at"]} for (cid, u), rec in self.attendance.items() if u == uid and cid in wanted]
        if "SELECT id,name FROM users WHERE id=ANY($1::uuid[])" in s:
            wanted = {UUID(str(x)) for x in args[0]}
            return [{"id": uid, "name": u["name"]} for uid, u in self.users.items() if uid in wanted]
        if "FROM material_links" in s or "material_blocks" in s:
            return []
        if "SELECT u.id FROM users u JOIN teacher_student_links l" in s:
            tid = UUID(str(args[0]))
            wanted = {UUID(str(x)) for x in args[1]}
            linked = self.teacher_links.get(tid, set())
            return [{"id": uid} for uid in wanted if uid in linked and self.users.get(uid, {}).get("role") == "student"]
        if "SELECT id FROM users WHERE role = 'student' AND id = ANY($1::uuid[])" in s or "SELECT id FROM users WHERE role='student' AND id=ANY($1::uuid[])" in s:
            wanted = {UUID(str(x)) for x in args[0]}
            return [{"id": uid} for uid in wanted if self.users.get(uid, {}).get("role") == "student"]
        if "FROM live_class_messages m JOIN users u" in s:
            cid = UUID(str(args[0]))
            limit = int(args[-1])
            msgs = [m for m in self.messages if m["live_class_id"] == cid and not m["is_deleted"]]
            if "(m.created_at > $2 OR (m.created_at = $2 AND m.id > $3))" in s:
                after_dt = args[1]
                after_id = str(args[2]).lower()
                msgs = [
                    m for m in msgs
                    if (m["created_at"] > after_dt) or (m["created_at"] == after_dt and str(m["id"]).lower() > after_id)
                ]
                msgs.sort(key=lambda m: (m["created_at"], str(m["id"]).lower()))
                msgs = msgs[:limit]
            elif "m.created_at > $2" in s:
                after_dt = args[1]
                msgs = [m for m in msgs if m["created_at"] > after_dt]
                msgs.sort(key=lambda m: (m["created_at"], str(m["id"]).lower()))
                msgs = msgs[:limit]
            elif "(m.created_at < $2 OR (m.created_at = $2 AND m.id < $3))" in s:
                before_dt = args[1]
                before_id = str(args[2]).lower()
                msgs = [
                    m for m in msgs
                    if (m["created_at"] < before_dt) or (m["created_at"] == before_dt and str(m["id"]).lower() < before_id)
                ]
                msgs.sort(key=lambda m: (m["created_at"], str(m["id"]).lower()), reverse=True)
                msgs = msgs[:limit]
            elif "m.created_at < $2" in s:
                before_dt = args[1]
                msgs = [m for m in msgs if m["created_at"] < before_dt]
                msgs.sort(key=lambda m: (m["created_at"], str(m["id"]).lower()), reverse=True)
                msgs = msgs[:limit]
            else:
                msgs.sort(key=lambda m: (m["created_at"], str(m["id"]).lower()), reverse=True)
                msgs = msgs[:limit]
            out = []
            for m in msgs:
                u = self.users.get(m["sender_user_id"], {})
                out.append({
                    **m,
                    "sender_name": u.get("name"),
                    "sender_role": u.get("role"),
                })
            return out
        if "FROM live_class_attendance a JOIN users u" in s:
            cid = UUID(str(args[0]))
            out = []
            for (k_cid, uid), rec in self.attendance.items():
                if k_cid == cid:
                    u = self.users.get(uid, {})
                    out.append({
                        **rec,
                        "user_id": uid,
                        "name": u.get("name"),
                        "email": u.get("email"),
                    })
            return out
        raise AssertionError(f"Unhandled fetch SQL: {s}")

    async def execute(self, sql, *args):
        self.query_count += 1
        s = " ".join(sql.split())
        if "INSERT INTO activity_events" in s:
            return "INSERT 0 1"
        if "UPDATE live_classes SET access_scope = $2" in s:
            cid, scope = UUID(str(args[0])), args[1]
            self.classes[cid]["access_scope"] = scope
            return "UPDATE 1"
        if "DELETE FROM live_class_enrollments WHERE live_class_id = $1" in s or "DELETE FROM live_class_enrollments WHERE live_class_id=$1" in s:
            cid = UUID(str(args[0]))
            self.enrollments[cid] = set()
            return "DELETE"
        if "INSERT INTO live_class_enrollments(" in s:
            cid, uid = UUID(str(args[0])), UUID(str(args[1]))
            self.enrollments.setdefault(cid, set()).add(uid)
            return "INSERT 0 1"
        if "UPDATE live_classes SET status = $2, recording_status = $3" in s:
            cid, st, rec_st, dur = UUID(str(args[0])), args[1], args[2], args[3]
            c = self.classes[cid]
            c["status"] = st
            c["recording_status"] = rec_st
            if dur is not None:
                c["recording_duration_seconds"] = dur
            return "UPDATE 1"
        raise AssertionError(f"Unhandled execute SQL: {s}")


def make_req(method="GET", path="/", query="", headers=None):
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "query_string": query.encode("utf-8"),
        "headers": headers or [],
    })


def setup_env(monkeypatch, db, user_id, body=None):
    class Pool:
        def acquire(self):
            return db
    pool_mock = AsyncMock(return_value=Pool())
    user = db.users.get(user_id) if user_id else None
    monkeypatch.setattr(core, "pool", pool_mock)
    monkeypatch.setattr(core, "current_user", AsyncMock(return_value=user))
    monkeypatch.setattr(core, "payload", AsyncMock(return_value=body if body is not None else {}))
    import app.browser_common as bc
    monkeypatch.setattr(bc, "material_blocks", AsyncMock(return_value=[]))
    return pool_mock


# ---------------------------------------------------------------------------
# 1. YOUTUBE VALIDATION TESTS
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtube.com/watch?v=dQw4w9WgXcQ&feature=share", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ?t=10", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/live/M7lc1UVf-VE?si=abc", "M7lc1UVf-VE"),
    ("https://www.youtube.com/embed/M7lc1UVf-VE", "M7lc1UVf-VE"),
    ("https://studio.youtube.com/video/M7lc1UVf-VE/livestreaming", "M7lc1UVf-VE"),
])
def test_youtube_id_extraction_accepts_valid_urls_and_ids(raw, expected):
    vid, err = lc.extract_youtube_video_id(raw)
    assert err is None
    assert vid == expected
    assert lc.youtube_thumbnail_url(vid) == f"https://i.ytimg.com/vi/{expected}/hqdefault.jpg"


@pytest.mark.parametrize("bad_input,expected_err", [
    ("abcd-1234-efgh-5678-ijkl", "stream_key_forbidden"),
    ("rtmp://a.rtmp.youtube.com/live2/abcd-1234", "stream_key_forbidden"),
    ("https://vimeo.com/123456789", "invalid_youtube_url"),
    ("https://evil-youtube.com/watch?v=dQw4w9WgXcQ", "invalid_youtube_url"),
    ("javascript:alert(1)", "invalid_youtube_url"),
    ("short_id", "invalid_youtube_url"),
    ("https://www.youtube.com/watch?v=bad", "invalid_youtube_url"),
])
def test_youtube_id_extraction_rejects_invalid_and_stream_keys(bad_input, expected_err):
    vid, err = lc.extract_youtube_video_id(bad_input)
    assert vid is None
    assert err == expected_err


# ---------------------------------------------------------------------------
# 2. FIX 1 — STRICT FAIL-CLOSED STUDENT ACCESS CONTROL TESTS
# ---------------------------------------------------------------------------

def test_fix1_student_access_control_fail_closed_across_all_scopes(monkeypatch):
    db = InMemoryLiveClassesDB()

    # 1. Enrolled student in course scope -> allowed
    setup_env(monkeypatch, db, STUDENT_1_ID)
    assert asyncio.run(lc.get_live_class_detail_api(make_req(), str(CLASS_COURSE_ID))).status_code == 200

    # 2. Student with NO valid course entitlement in course scope -> denied (403)
    setup_env(monkeypatch, db, STUDENT_3_NO_COURSE_ID)
    assert asyncio.run(lc.get_live_class_detail_api(make_req(), str(CLASS_COURSE_ID))).status_code == 403
    assert asyncio.run(lc.get_live_class_chat(make_req(), str(CLASS_COURSE_ID))).status_code == 403
    setup_env(monkeypatch, db, STUDENT_3_NO_COURSE_ID, {"body": "Unauthorized"})
    assert asyncio.run(lc.post_live_class_chat(make_req("POST"), str(CLASS_COURSE_ID))).status_code == 403
    setup_env(monkeypatch, db, STUDENT_3_NO_COURSE_ID, {"action": "join"})
    assert asyncio.run(lc.post_live_class_attendance(make_req("POST"), str(CLASS_COURSE_ID))).status_code == 403

    # 3. Assigned student -> allowed; Unassigned student -> denied (403)
    setup_env(monkeypatch, db, STUDENT_1_ID)
    assert asyncio.run(lc.get_live_class_detail_api(make_req(), str(CLASS_A_ID))).status_code == 200
    setup_env(monkeypatch, db, STUDENT_2_ID)
    assert asyncio.run(lc.get_live_class_detail_api(make_req(), str(CLASS_A_ID))).status_code == 403

    # 4. Teacher roster scope: Student 1 (in Teacher A roster) -> allowed; Student 2 (belongs to Teacher B) -> denied (403)
    setup_env(monkeypatch, db, STUDENT_1_ID)
    assert asyncio.run(lc.get_live_class_detail_api(make_req(), str(CLASS_ROSTER_ID))).status_code == 200
    setup_env(monkeypatch, db, STUDENT_2_ID)
    assert asyncio.run(lc.get_live_class_detail_api(make_req(), str(CLASS_ROSTER_ID))).status_code == 403

    # 5. Database error during permission check -> NEVER allowed (strictly fail-closed across all scopes)
    db_err = InMemoryLiveClassesDB(fail_access_check=True)
    setup_env(monkeypatch, db_err, STUDENT_1_ID)
    for cid in (CLASS_COURSE_ID, CLASS_ROSTER_ID, CLASS_A_ID):
        assert asyncio.run(lc.get_live_class_detail_api(make_req(), str(cid))).status_code == 403
        assert asyncio.run(lc.get_live_class_chat(make_req(), str(cid))).status_code == 403


# ---------------------------------------------------------------------------
# 3. TASK 1 & PREVIOUS FIX 2 — ADMIN DATA EXPOSURE & ROLE PERMISSIONS TESTS
# ---------------------------------------------------------------------------

def test_task1_and_fix2_admin_data_exposure_and_role_permissions(monkeypatch):
    db = InMemoryLiveClassesDB()
    db.classes[CLASS_A_ID]["status"] = "live"
    db.classes[CLASS_ADMIN_ID]["status"] = "live"
    msg_a = {"id": UUID(int=801), "live_class_id": CLASS_A_ID, "sender_user_id": STUDENT_1_ID, "body": "Q1", "created_at": dt.datetime.now(dt.timezone.utc), "is_deleted": False}
    msg_adm = {"id": UUID(int=802), "live_class_id": CLASS_ADMIN_ID, "sender_user_id": STUDENT_1_ID, "body": "Q2", "created_at": dt.datetime.now(dt.timezone.utc), "is_deleted": False}
    db.messages.extend([msg_a, msg_adm])

    # A. OWNER: can read all classes, rosters, assigned students, and attendance
    setup_env(monkeypatch, db, OWNER_ID)
    owner_list = asyncio.run(bsp.read(make_req(), db.users[OWNER_ID], "teacher-live-classes", {}))
    assert len(owner_list["classes"]) == 5
    assert {s["id"] for s in owner_list["availableStudents"]} == {str(STUDENT_1_ID), str(STUDENT_2_ID), str(STUDENT_3_NO_COURSE_ID)}
    owner_detail_a = asyncio.run(bsp.read(make_req(), db.users[OWNER_ID], "teacher-live-class", {"id": str(CLASS_A_ID)}))
    assert len(owner_detail_a["roster"]) == 1
    assert owner_detail_a["roster"][0]["userId"] == str(STUDENT_1_ID)
    assert len(owner_detail_a["assignedStudents"]) == 1

    # B. TEACHER A: can read own classes & roster; CANNOT read Teacher B's CLASS_B_ID or Admin's CLASS_ADMIN_ID
    setup_env(monkeypatch, db, TEACHER_A_ID)
    ta_list = asyncio.run(bsp.read(make_req(), db.users[TEACHER_A_ID], "teacher-live-classes", {}))
    ta_class_ids = {c["id"] for c in ta_list["classes"]}
    assert ta_class_ids == {str(CLASS_A_ID), str(CLASS_COURSE_ID), str(CLASS_ROSTER_ID)}
    assert str(CLASS_B_ID) not in ta_class_ids
    assert str(CLASS_ADMIN_ID) not in ta_class_ids
    assert [s["id"] for s in ta_list["availableStudents"]] == [str(STUDENT_1_ID)]
    ta_detail_own = asyncio.run(bsp.read(make_req(), db.users[TEACHER_A_ID], "teacher-live-class", {"id": str(CLASS_A_ID)}))
    assert len(ta_detail_own["roster"]) == 1
    with pytest.raises(HTTPException) as exc_tb:
        asyncio.run(bsp.read(make_req(), db.users[TEACHER_A_ID], "teacher-live-class", {"id": str(CLASS_B_ID)}))
    assert exc_tb.value.status_code == 404

    # C. AUTHORIZED ADMIN (AUTH_ADMIN_ID): can read ONLY CLASS_ADMIN_ID; never receives Teacher A or Teacher B classes or student IDs
    setup_env(monkeypatch, db, AUTH_ADMIN_ID)
    auth_admin_list = asyncio.run(bsp.read(make_req(), db.users[AUTH_ADMIN_ID], "teacher-live-classes", {}))
    assert [c["id"] for c in auth_admin_list["classes"]] == [str(CLASS_ADMIN_ID)]
    assert [s["id"] for s in auth_admin_list["availableStudents"]] == [str(STUDENT_1_ID)]
    auth_admin_detail = asyncio.run(bsp.read(make_req(), db.users[AUTH_ADMIN_ID], "teacher-live-class", {"id": str(CLASS_ADMIN_ID)}))
    assert auth_admin_detail["liveClass"]["id"] == str(CLASS_ADMIN_ID)
    assert len(auth_admin_detail["roster"]) == 1
    for forbidden_cid in (CLASS_A_ID, CLASS_B_ID, CLASS_COURSE_ID, CLASS_ROSTER_ID):
        with pytest.raises(HTTPException) as exc_forb:
            asyncio.run(bsp.read(make_req(), db.users[AUTH_ADMIN_ID], "teacher-live-class", {"id": str(forbidden_cid)}))
        assert exc_forb.value.status_code == 404

    # D. UNRELATED ADMIN (UNAUTH_ADMIN_ID): receives ZERO classes, ZERO student IDs, and 404/403 on all class details & attendance
    setup_env(monkeypatch, db, UNAUTH_ADMIN_ID)
    unauth_admin_list = asyncio.run(bsp.read(make_req(), db.users[UNAUTH_ADMIN_ID], "teacher-live-classes", {"page": "1", "teacher": str(TEACHER_A_ID)}))
    assert unauth_admin_list["classes"] == []
    assert unauth_admin_list["availableStudents"] == []
    for cid in (CLASS_A_ID, CLASS_B_ID, CLASS_COURSE_ID, CLASS_ROSTER_ID, CLASS_ADMIN_ID):
        with pytest.raises(HTTPException) as exc_unauth:
            asyncio.run(bsp.read(make_req(), db.users[UNAUTH_ADMIN_ID], "teacher-live-class", {"id": str(cid)}))
        assert exc_unauth.value.status_code == 404
        assert asyncio.run(lc.get_teacher_class_attendance(make_req("GET"), str(cid))).status_code == 403
        assert asyncio.run(lc.get_live_class_detail_api(make_req("GET"), str(cid))).status_code == 403
    unauth_student_view = json.loads(asyncio.run(lc.list_live_classes_api(make_req("GET"))).body)
    assert unauth_student_view["upcoming"] == []
    assert unauth_student_view["past"] == []
    assert asyncio.run(bs.managed_owners(db, db.users[UNAUTH_ADMIN_ID], "live_class")) == []

    # E. STUDENT: cannot retrieve staff-only roster, enrollment, or attendance endpoints
    setup_env(monkeypatch, db, STUDENT_1_ID)
    with pytest.raises(HTTPException) as exc_stu_list:
        asyncio.run(bsp.read(make_req(), db.users[STUDENT_1_ID], "teacher-live-classes", {}))
    assert exc_stu_list.value.status_code == 403
    with pytest.raises(HTTPException) as exc_stu_det:
        asyncio.run(bsp.read(make_req(), db.users[STUDENT_1_ID], "teacher-live-class", {"id": str(CLASS_A_ID)}))
    assert exc_stu_det.value.status_code == 403
    assert asyncio.run(lc.get_teacher_class_attendance(make_req("GET"), str(CLASS_A_ID))).status_code == 403

    # F. Mutation checks for Student, Unrelated Admin, Authorized Admin, Teacher, and Owner
    setup_env(monkeypatch, db, STUDENT_1_ID, {"title": "Student Class", "scheduledAt": "2026-11-01T10:00:00Z", "durationMinutes": 60})
    assert asyncio.run(ca.create_live_class(make_req("POST"))).status_code == 403
    for actor_id in (UNAUTH_ADMIN_ID, TEACHER_B_ID):
        setup_env(monkeypatch, db, actor_id, {"title": "Tampered Title"})
        assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 403
        setup_env(monkeypatch, db, actor_id, {"studentIds": [str(STUDENT_1_ID)]})
        assert asyncio.run(lc.assign_live_class_students(make_req("POST"), str(CLASS_A_ID))).status_code == 403
        assert asyncio.run(lc.check_live_class_recording(make_req("POST"), str(CLASS_A_ID))).status_code == 403
        assert asyncio.run(lc.delete_live_class_chat_message(make_req("DELETE"), str(CLASS_A_ID), str(msg_a["id"]))).status_code == 403

    setup_env(monkeypatch, db, TEACHER_A_ID, {"title": "Updated by Teacher A"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 200
    assert asyncio.run(lc.delete_live_class_chat_message(make_req("DELETE"), str(CLASS_A_ID), str(msg_a["id"]))).status_code == 200

    setup_env(monkeypatch, db, AUTH_ADMIN_ID, {"title": "Updated by Auth Admin"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_ADMIN_ID))).status_code == 200
    assert asyncio.run(lc.delete_live_class_chat_message(make_req("DELETE"), str(CLASS_ADMIN_ID), str(msg_adm["id"]))).status_code == 200


# ---------------------------------------------------------------------------
# 4. FIX 6 — STRICT CLASS LIFECYCLE & RECORDING STATE MACHINE TESTS
# ---------------------------------------------------------------------------

def test_fix6_class_lifecycle_state_machine_rejects_invalid_and_allows_valid(monkeypatch):
    db = InMemoryLiveClassesDB()

    setup_env(monkeypatch, db, TEACHER_A_ID, {"status": "recording_ready"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 400
    assert asyncio.run(lc.check_live_class_recording(make_req("POST"), str(CLASS_A_ID))).status_code == 409

    setup_env(monkeypatch, db, TEACHER_A_ID, {"status": "cancelled"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 200
    setup_env(monkeypatch, db, TEACHER_A_ID, {"status": "live"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 400
    setup_env(monkeypatch, db, TEACHER_A_ID, {"recordingStatus": "ready"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 400

    setup_env(monkeypatch, db, TEACHER_A_ID, {"status": "scheduled"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 200
    setup_env(monkeypatch, db, TEACHER_A_ID, {"status": "live"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 200

    setup_env(monkeypatch, db, TEACHER_A_ID, {"status": "recording_ready"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 400

    setup_env(monkeypatch, db, TEACHER_A_ID, {"status": "completed"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 200
    assert db.classes[CLASS_A_ID]["recording_status"] == "processing"

    setup_env(monkeypatch, db, TEACHER_A_ID, {"status": "recording_unavailable"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 200
    assert db.classes[CLASS_A_ID]["recording_status"] == "unavailable"

    setup_env(monkeypatch, db, TEACHER_A_ID, {"status": "recording_ready"})
    assert asyncio.run(ca.update_live_class(make_req("PATCH"), str(CLASS_A_ID))).status_code == 200
    assert db.classes[CLASS_A_ID]["status"] == "recorded"
    assert db.classes[CLASS_A_ID]["recording_status"] == "ready"


# ---------------------------------------------------------------------------
# 5. TASK 2, TASK 3 & PREVIOUS FIX 5 — ATTENDANCE CONSOLIDATION & MIGRATION AUDIT
# ---------------------------------------------------------------------------

def test_task3_attendance_session_consolidation_examples_a_b_c_d_and_edge_cases():
    # Example A — Overlapping intervals (Tab A: 10:00–10:30, Tab B: 10:10–10:40)
    # Expected: Duration = 2,400 seconds (40 mins, NOT 60 mins), Distinct sessions = 1 (NOT 2)
    ex_a = lc.consolidate_attendance_records([
        {
            "id": "tab-a",
            "live_class_id": "class-1",
            "user_id": "student-a",
            "joined_at": "2026-10-30T10:00:00Z",
            "last_seen_at": "2026-10-30T10:30:00Z",
            "left_at": "2026-10-30T10:30:00Z",
            "estimated_duration_seconds": 1800,
            "session_count": 1,
        },
        {
            "id": "tab-b",
            "live_class_id": "class-1",
            "user_id": "student-a",
            "joined_at": "2026-10-30T10:10:00Z",
            "last_seen_at": "2026-10-30T10:40:00Z",
            "left_at": "2026-10-30T10:40:00Z",
            "estimated_duration_seconds": 1800,
            "session_count": 1,
        },
    ])
    assert ex_a["estimated_duration_seconds"] == 2400
    assert ex_a["session_count"] == 1
    assert len(ex_a["session_history"]) == 2

    # Example B — Separate visits (10:00–10:30 and 11:00–11:20)
    # Expected: Duration = 3,000 seconds, Distinct sessions = 2
    ex_b = lc.consolidate_attendance_records([
        {
            "id": "visit-1",
            "live_class_id": "class-1",
            "user_id": "student-b",
            "joined_at": "2026-10-30T10:00:00Z",
            "last_seen_at": "2026-10-30T10:30:00Z",
            "left_at": "2026-10-30T10:30:00Z",
            "estimated_duration_seconds": 1800,
            "session_count": 1,
        },
        {
            "id": "visit-2",
            "live_class_id": "class-1",
            "user_id": "student-b",
            "joined_at": "2026-10-30T11:00:00Z",
            "last_seen_at": "2026-10-30T11:20:00Z",
            "left_at": "2026-10-30T11:20:00Z",
            "estimated_duration_seconds": 1200,
            "session_count": 1,
        },
    ])
    assert ex_b["estimated_duration_seconds"] == 3000
    assert ex_b["session_count"] == 2
    assert len(ex_b["session_history"]) == 2

    # Example C — Small interruption (10:00:00–10:30:00 and 10:30:03–10:50:00, 3s gap <= 5s tolerance)
    # Expected: Distinct sessions = 1, Duration = 2,997 seconds (only actual covered time counted)
    ex_c = lc.consolidate_attendance_records([
        {
            "id": "part-1",
            "live_class_id": "class-1",
            "user_id": "student-c",
            "joined_at": "2026-10-30T10:00:00Z",
            "last_seen_at": "2026-10-30T10:30:00Z",
            "left_at": "2026-10-30T10:30:00Z",
            "estimated_duration_seconds": 1800,
            "session_count": 1,
        },
        {
            "id": "part-2",
            "live_class_id": "class-1",
            "user_id": "student-c",
            "joined_at": "2026-10-30T10:30:03Z",
            "last_seen_at": "2026-10-30T10:50:00Z",
            "left_at": "2026-10-30T10:50:00Z",
            "estimated_duration_seconds": 1197,
            "session_count": 1,
        },
    ])
    assert ex_c["session_count"] == 1
    assert ex_c["estimated_duration_seconds"] == 2997

    # Example D — Legacy incomplete data (missing last_seen_at, left_at, and 0 duration)
    # Preserves all known timestamps, marks incomplete=True, never fabricates duration
    ex_d = lc.consolidate_attendance_records([
        {
            "id": "leg-1",
            "live_class_id": "class-1",
            "user_id": "student-d",
            "joined_at": "2026-10-30T10:00:00Z",
            "last_seen_at": None,
            "left_at": None,
            "estimated_duration_seconds": 0,
            "session_count": 1,
        },
        {
            "id": "leg-2-dup-click",
            "live_class_id": "class-1",
            "user_id": "student-d",
            "joined_at": "2026-10-30T10:00:02Z",
            "last_seen_at": None,
            "left_at": None,
            "estimated_duration_seconds": 0,
            "session_count": 1,
        },
        {
            "id": "leg-3-later-rejoin",
            "live_class_id": "class-1",
            "user_id": "student-d",
            "joined_at": "2026-10-30T10:45:00Z",
            "last_seen_at": None,
            "left_at": None,
            "estimated_duration_seconds": 0,
            "session_count": 1,
        },
    ])
    assert ex_d["estimated_duration_seconds"] == 0
    assert ex_d["session_count"] == 2
    assert len(ex_d["session_history"]) == 3
    assert all(h["incomplete"] is True and h["lastSeenAt"] is None for h in ex_d["session_history"])

    # Out-of-order rows + contained interval (10:15–10:25 passed before 10:00–10:50)
    ex_ooo = lc.consolidate_attendance_records([
        {
            "id": "inner",
            "live_class_id": "class-1",
            "user_id": "student-e",
            "joined_at": "2026-10-30T10:15:00Z",
            "last_seen_at": "2026-10-30T10:25:00Z",
            "left_at": "2026-10-30T10:25:00Z",
            "estimated_duration_seconds": 600,
            "session_count": 1,
        },
        {
            "id": "outer",
            "live_class_id": "class-1",
            "user_id": "student-e",
            "joined_at": "2026-10-30T10:00:00Z",
            "last_seen_at": "2026-10-30T10:50:00Z",
            "left_at": None,
            "estimated_duration_seconds": 3000,
            "session_count": 1,
        },
    ])
    assert ex_ooo["estimated_duration_seconds"] == 3000
    assert ex_ooo["session_count"] == 1
    assert ex_ooo["left_at"] is None


def test_attendance_merger_preserves_existing_history_of_every_duplicate_row():
    # Old migrations may already have archived sessions on multiple rows.
    # The keeper must retain every entry from all rows, not only its own array.
    keeper_old = [
        {"id": "legacy-keeper-1", "meta": {"nested": [1, {"ok": True}]}},
        None,
    ]
    secondary_old = [
        {"id": "legacy-secondary-1", "lastSeenAt": None},
        ["nested", "array"],
        "original-scalar",
    ]
    result = lc.consolidate_attendance_records([
        {
            "id": "row-secondary", "live_class_id": "class-1", "user_id": "student-history",
            "joined_at": "2026-10-30T10:10:00Z", "last_seen_at": "2026-10-30T10:40:00Z",
            "left_at": "2026-10-30T10:40:00Z", "estimated_duration_seconds": 1800,
            "session_count": 1, "session_history": secondary_old,
        },
        {
            "id": "row-keeper", "live_class_id": "class-1", "user_id": "student-history",
            "joined_at": "2026-10-30T10:00:00Z", "last_seen_at": "2026-10-30T10:30:00Z",
            "left_at": "2026-10-30T10:30:00Z", "estimated_duration_seconds": 1800,
            "session_count": 1, "session_history": keeper_old,
        },
    ])
    entries = result["session_history"]
    assert entries[:2] == keeper_old
    assert entries[2]["id"] == "row-keeper"
    assert entries[3:6] == secondary_old
    assert entries[6]["id"] == "row-secondary"
    assert len(entries) == len(keeper_old) + len(secondary_old) + 2
    assert result["estimated_duration_seconds"] == 2400
    assert result["session_count"] == 1
    # Legacy non-array JSONB values must not be silently dropped either.
    scalar = lc.consolidate_attendance_records([
        {"id": "s1", "joined_at": "2026-10-30T10:00:00Z", "session_history": {"legacy": True}},
        {"id": "s2", "joined_at": "2026-10-30T10:00:01Z", "session_history": "old-history"},
    ])
    assert scalar["session_history"][0] == {"legacy": True}
    assert scalar["session_history"][2] == "old-history"


def test_task2_and_fix5_migration_0072_sql_relational_and_static_schema_verification():
    repo_root = pathlib.Path(__file__).resolve().parents[3]
    drizzle_sql = (repo_root / "drizzle" / "0072_live_classes_youtube_chat_attendance.sql").read_text(encoding="utf-8")
    backend_sql = (repo_root / "services" / "backend" / "migrations" / "0072_live_classes_youtube_chat_attendance.sql").read_text(encoding="utf-8")
    assert drizzle_sql == backend_sql, "Drizzle and backend migration 0072 SQL files must be identical"

    # Static verification of PostgreSQL DDL, constraints, indexes, and RLS in 0072
    for required_fragment in (
        "ALTER TABLE public.live_classes",
        "live_classes_youtube_video_id_chk",
        "live_classes_recording_status_chk",
        "live_classes_recording_duration_chk",
        "live_classes_access_scope_chk",
        "CREATE TABLE IF NOT EXISTS public.live_class_enrollments",
        "CREATE TABLE IF NOT EXISTS public.live_class_messages",
        "ADD COLUMN IF NOT EXISTS session_history jsonb NOT NULL DEFAULT '[]'::jsonb",
        "CROSS JOIN LATERAL jsonb_array_elements(",
        "WHEN o.session_history IS NOT NULL THEN jsonb_build_array(o.session_history)",
        "WITH ORDINALITY AS h(entry, ordinality)",
        "JSONB_AGG(entry ORDER BY rn, source_order, entry_order) AS full_history",
        "session_history = h.full_history",
        "JOIN consolidated_history h",
        "WHEN o.joined_at > o.prev_max_session_end_at + INTERVAL '5 seconds' THEN o.row_session_count",
        "CREATE UNIQUE INDEX IF NOT EXISTS live_class_attendance_class_user_uidx",
        "ALTER TABLE public.live_class_enrollments ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE public.live_class_messages ENABLE ROW LEVEL SECURITY;",
    ):
        assert required_fragment in drizzle_sql, f"Missing required SQL fragment: {required_fragment}"

    # Ensure every duplicate row contributes its own prior JSON history and a row snapshot;
    # reading only the keeper's history would silently lose secondary rows' archives.
    assert "target.session_history || c.merged_history" not in drizzle_sql
    assert "FROM duplicate_groups o" in drizzle_sql
    assert "UNION ALL" in drizzle_sql

    # Verify relational window-function consolidation logic in SQLite with Example A, B, C, D
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript("""
    CREATE TABLE live_class_attendance (
      id TEXT PRIMARY KEY,
      live_class_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      last_seen_at INTEGER,
      left_at INTEGER,
      estimated_duration_seconds INTEGER NOT NULL DEFAULT 0,
      session_count INTEGER NOT NULL DEFAULT 1,
      session_history TEXT NOT NULL DEFAULT '[]'
    );
    """)
    rows_to_seed = [
        # Student A (Example A: Overlapping tabs 10:00-10:30 [0..1800] and 10:10-10:40 [600..2400]) -> dur=2400, sessions=1
        ("a-1", "class-a", "student-a", 0, 1800, 1800, 1800, 1, "[]"),
        ("a-2", "class-a", "student-a", 600, 2400, 2400, 1800, 1, "[]"),
        # Student B (Example B: Separate visits [0..1800] and [3600..4800]) -> dur=3000, sessions=2
        ("b-1", "class-a", "student-b", 0, 1800, 1800, 1800, 1, "[]"),
        ("b-2", "class-a", "student-b", 3600, 4800, 4800, 1200, 1, "[]"),
        # Student C (Example C: Small 3s interruption [0..1800] and [1803..3000]) -> dur=2997, sessions=1
        ("c-1", "class-a", "student-c", 0, 1800, 1800, 1800, 1, "[]"),
        ("c-2", "class-a", "student-c", 1803, 3000, 3000, 1197, 1, "[]"),
        # Student D (Example D: Legacy incomplete rows at 1000, 1002, and 3700) -> dur=0, sessions=2
        ("d-1", "class-a", "student-d", 1000, None, None, 0, 1, "[]"),
        ("d-2", "class-a", "student-d", 1002, None, None, 0, 1, "[]"),
        ("d-3", "class-a", "student-d", 3700, None, None, 0, 1, "[]"),
        # Historical archives exist on both the keeper and a secondary duplicate row.
        ("e-1", "class-a", "student-e", 0, 1800, 1800, 1800, 1,
         json.dumps([{"id": "archived-e1", "nested": [1, 2]}, None])),
        ("e-2", "class-a", "student-e", 600, 2400, 2400, 1800, 1,
         json.dumps([{"id": "archived-e2", "flag": False}, ["child", "array"], "scalar"])),
    ]
    con.executemany("INSERT INTO live_class_attendance VALUES (?,?,?,?,?,?,?,?,?)", rows_to_seed)

    def run_sql_consolidation():
        dups = con.execute("""
        WITH base_rows AS (
          SELECT
            id, live_class_id, user_id, joined_at,
            last_seen_at AS raw_last_seen_at,
            left_at,
            MAX(0, COALESCE(estimated_duration_seconds, 0)) AS recorded_duration_seconds,
            MAX(1, COALESCE(session_count, 1)) AS row_session_count,
            (last_seen_at IS NULL AND left_at IS NULL AND COALESCE(estimated_duration_seconds, 0) <= 0) AS is_incomplete,
            MAX(
              joined_at,
              COALESCE(last_seen_at, joined_at),
              COALESCE(left_at, joined_at),
              joined_at + MAX(0, COALESCE(estimated_duration_seconds, 0))
            ) AS effective_end_at,
            CASE
              WHEN COALESCE(estimated_duration_seconds, 0) > 0 THEN joined_at + MAX(0, COALESCE(estimated_duration_seconds, 0))
              ELSE MAX(joined_at, COALESCE(last_seen_at, joined_at), COALESCE(left_at, joined_at))
            END AS dur_end_at
          FROM live_class_attendance
        ),
        ordered_rows AS (
          SELECT
            b.*,
            ROW_NUMBER() OVER (PARTITION BY live_class_id, user_id ORDER BY joined_at ASC, effective_end_at ASC, id ASC) AS rn,
            COUNT(*) OVER (PARTITION BY live_class_id, user_id) AS group_size,
            MAX(effective_end_at) OVER (PARTITION BY live_class_id, user_id ORDER BY joined_at ASC, effective_end_at ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max_session_end_at,
            MAX(dur_end_at) OVER (PARTITION BY live_class_id, user_id ORDER BY joined_at ASC, dur_end_at ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max_dur_end_at
          FROM base_rows b
        )
        SELECT o.*,
          CASE
            WHEN o.rn = 1 THEN o.row_session_count
            WHEN o.prev_max_session_end_at IS NULL THEN o.row_session_count
            WHEN o.joined_at > o.prev_max_session_end_at + 5 THEN o.row_session_count
            ELSE 0
          END AS distinct_session_increment,
          CASE
            WHEN o.dur_end_at <= o.joined_at THEN 0
            WHEN o.prev_max_dur_end_at IS NULL OR o.joined_at >= o.prev_max_dur_end_at THEN (o.dur_end_at - o.joined_at)
            WHEN o.dur_end_at <= o.prev_max_dur_end_at THEN 0
            ELSE MAX(0, o.dur_end_at - o.prev_max_dur_end_at)
          END AS non_overlapping_duration_seconds
        FROM ordered_rows o WHERE o.group_size > 1 ORDER BY live_class_id, user_id, rn
        """).fetchall()

        groups = defaultdict(list)
        for r in dups:
            groups[(r["live_class_id"], r["user_id"])].append(dict(r))

        for (cid, uid), items in groups.items():
            keep_id = items[0]["id"]
            min_joined = min(x["joined_at"] for x in items)
            max_seen = max(x["effective_end_at"] for x in items)
            latest_left = sorted(items, key=lambda x: (x["effective_end_at"], x["rn"]), reverse=True)[0]["left_at"]
            total_dur = min(86400, sum(x["non_overlapping_duration_seconds"] for x in items))
            total_sess = max(1, sum(x["distinct_session_increment"] for x in items))
            hist = []
            for x in items:
                prior = json.loads(con.execute(
                    "SELECT session_history FROM live_class_attendance WHERE id=?", (x["id"],)
                ).fetchone()[0])
                hist.extend(prior)
                hist.append({
                    "id": x["id"],
                    "joinedAt": x["joined_at"],
                    "lastSeenAt": x["raw_last_seen_at"],
                    "effectiveEndAt": x["effective_end_at"],
                    "leftAt": x["left_at"],
                    "estimatedDurationSeconds": x["recorded_duration_seconds"],
                    "incomplete": bool(x["is_incomplete"]),
                })
            # Archived entries from *each* row precede that row's new snapshot.
            # Group consolidation is idempotent once secondary rows are removed.
            con.execute(
                "UPDATE live_class_attendance SET joined_at=?, last_seen_at=?, left_at=?, estimated_duration_seconds=?, session_count=?, session_history=? WHERE id=?",
                (min_joined, max_seen, latest_left, total_dur, total_sess, json.dumps(hist), keep_id),
            )
            con.execute("DELETE FROM live_class_attendance WHERE live_class_id=? AND user_id=? AND id<>?", (cid, uid, keep_id))

        con.execute("UPDATE live_class_attendance SET last_seen_at = joined_at WHERE last_seen_at IS NULL")

    run_sql_consolidation()
    con.execute("CREATE UNIQUE INDEX IF NOT EXISTS live_class_attendance_class_user_uidx ON live_class_attendance (live_class_id, user_id)")
    # Re-run to verify idempotency
    run_sql_consolidation()

    sa = dict(con.execute("SELECT * FROM live_class_attendance WHERE user_id='student-a'").fetchone())
    assert sa["estimated_duration_seconds"] == 2400 and sa["session_count"] == 1

    sb = dict(con.execute("SELECT * FROM live_class_attendance WHERE user_id='student-b'").fetchone())
    assert sb["estimated_duration_seconds"] == 3000 and sb["session_count"] == 2

    sc = dict(con.execute("SELECT * FROM live_class_attendance WHERE user_id='student-c'").fetchone())
    assert sc["estimated_duration_seconds"] == 2997 and sc["session_count"] == 1

    sd = dict(con.execute("SELECT * FROM live_class_attendance WHERE user_id='student-d'").fetchone())
    assert sd["estimated_duration_seconds"] == 0 and sd["session_count"] == 2
    assert len(json.loads(sd["session_history"])) == 3

    se = dict(con.execute("SELECT * FROM live_class_attendance WHERE user_id='student-e'").fetchone())
    stored = json.loads(se["session_history"])
    assert len(stored) == 7
    assert stored[0] == {"id": "archived-e1", "nested": [1, 2]}
    assert stored[1] is None
    assert stored[2]["id"] == "e-1"
    assert stored[3] == {"id": "archived-e2", "flag": False}
    assert stored[4] == ["child", "array"]
    assert stored[5] == "scalar"
    assert stored[6]["id"] == "e-2"
    # No history is duplicated on a second migration run.
    assert len(json.loads(con.execute(
        "SELECT session_history FROM live_class_attendance WHERE user_id='student-e'"
    ).fetchone()[0])) == 7


# ---------------------------------------------------------------------------
# 6. TASK 5 — CHAT CURSOR PAGINATION (120 MESSAGES + EDGE CASES)
# ---------------------------------------------------------------------------

def test_task5_chat_cursor_pagination_120_messages_and_edge_cases(monkeypatch):
    db = InMemoryLiveClassesDB()
    db.classes[CLASS_A_ID]["status"] = "live"
    base_time = dt.datetime(2026, 10, 30, 14, 0, 0, tzinfo=dt.timezone.utc)

    # 1. Invalid cursors -> HTTP 400
    setup_env(monkeypatch, db, STUDENT_1_ID)
    for bad_q in (
        "after=not-a-timestamp",
        "after=2026-10-30T14:00:00Z|not-a-uuid",
        "before=invalid-date",
        "before=2026-10-30T14:00:00Z&after=2026-10-30T14:01:00Z",
    ):
        r_bad = asyncio.run(lc.get_live_class_chat(make_req("GET", query=bad_q), str(CLASS_A_ID)))
        assert r_bad.status_code == 400

    # 2. Unauthorized user -> HTTP 403
    setup_env(monkeypatch, db, STUDENT_2_ID)
    assert asyncio.run(lc.get_live_class_chat(make_req("GET", query=f"after={lc.js_iso(base_time)}"), str(CLASS_A_ID))).status_code == 403

    # 3. 0 new messages -> empty list, hasMore=False
    setup_env(monkeypatch, db, STUDENT_1_ID)
    r_empty = json.loads(asyncio.run(lc.get_live_class_chat(make_req("GET", query=f"after={lc.js_iso(base_time)}&limit=50"), str(CLASS_A_ID))).body)
    assert r_empty["messages"] == []
    assert r_empty["hasMore"] is False

    # 4. Helper to seed N messages after base_time
    def seed_messages(count, same_timestamp_range=None):
        db.messages.clear()
        expected_ids = []
        for i in range(1, count + 1):
            mid = UUID(f"00000000-0000-4000-8000-{i:012d}")
            if same_timestamp_range and same_timestamp_range[0] <= i <= same_timestamp_range[1]:
                ts = base_time + dt.timedelta(seconds=same_timestamp_range[0])
            else:
                ts = base_time + dt.timedelta(seconds=i)
            db.messages.append({
                "id": mid,
                "live_class_id": CLASS_A_ID,
                "sender_user_id": TEACHER_A_ID,
                "body": f"Msg #{i}",
                "created_at": ts,
                "is_deleted": False,
                "deleted_by_user_id": None,
                "deleted_at": None,
            })
            expected_ids.append(str(mid))
        return expected_ids

    # 5. Exactly 50 messages -> 1 page of 50 with hasMore=False
    ids_50 = seed_messages(50)
    p1_50 = json.loads(asyncio.run(lc.get_live_class_chat(make_req("GET", query=f"after={lc.js_iso(base_time)}&limit=50"), str(CLASS_A_ID))).body)
    assert len(p1_50["messages"]) == 50
    assert p1_50["hasMore"] is False
    assert [m["id"] for m in p1_50["messages"]] == ids_50

    # 6. Exactly 100 messages -> Page 1 (50, hasMore=True), Page 2 (50, hasMore=False)
    ids_100 = seed_messages(100)
    p1_100 = json.loads(asyncio.run(lc.get_live_class_chat(make_req("GET", query=f"after={lc.js_iso(base_time)}&limit=50"), str(CLASS_A_ID))).body)
    assert len(p1_100["messages"]) == 50 and p1_100["hasMore"] is True
    p2_100 = json.loads(asyncio.run(lc.get_live_class_chat(make_req("GET", query=f"after={p1_100['nextAfter']}&limit=50"), str(CLASS_A_ID))).body)
    assert len(p2_100["messages"]) == 50 and p2_100["hasMore"] is False
    assert [m["id"] for m in p1_100["messages"] + p2_100["messages"]] == ids_100

    # 7. 120 messages while disconnected (including identical timestamps spanning the Page 1 -> Page 2 boundary!)
    # Expected: Page 1 = 50 (hasMore=True), Page 2 = 50 (hasMore=True), Page 3 = 20 (hasMore=False)
    ids_120 = seed_messages(120, same_timestamp_range=(45, 60))
    cursor = lc.js_iso(base_time)
    page_sizes = []
    has_more_flags = []
    recovered = []

    while True:
        res = json.loads(asyncio.run(lc.get_live_class_chat(make_req("GET", query=f"after={cursor}&limit=50"), str(CLASS_A_ID))).body)
        page_sizes.append(len(res["messages"]))
        has_more_flags.append(res["hasMore"])
        recovered.extend(res["messages"])
        # Delete the 50th message right after Page 1 is fetched to verify deleted messages do not break continuation
        if len(page_sizes) == 1:
            db.messages[49]["is_deleted"] = True
        if not res["hasMore"]:
            break
        cursor = res["nextAfter"]

    assert page_sizes == [50, 50, 20]
    assert has_more_flags == [True, True, False]
    assert len(recovered) == 120
    assert [m["id"] for m in recovered] == ids_120
    assert len({m["id"] for m in recovered}) == 120


def test_live_chat_cursor_preserves_microseconds_across_pages(monkeypatch):
    """Microsecond events in one millisecond must not repeat or skip on either direction."""
    db = InMemoryLiveClassesDB()
    db.classes[CLASS_A_ID]['status'] = 'live'
    setup_env(monkeypatch, db, STUDENT_1_ID)
    base = dt.datetime(2026, 10, 30, 14, 0, 0, tzinfo=dt.timezone.utc)

    # 120 messages all occur within ONE millisecond. Reverse UUID order to
    # catch accidental `(rounded_millisecond, id)` comparisons.
    for i in range(120):
        db.messages.append({
            'id': UUID(f'00000000-0000-4000-8000-{120 - i:012d}'),
            'live_class_id': CLASS_A_ID,
            'sender_user_id': TEACHER_A_ID,
            'body': f'Microsecond message {i}',
            'created_at': base + dt.timedelta(microseconds=101 + 5 * i),
            'is_deleted': False,
        })
    expected_ids = [str(row['id']) for row in db.messages]
    assert lc.js_iso(db.messages[0]['created_at']) == lc.js_iso(db.messages[-1]['created_at'])
    assert lc.chat_iso(db.messages[0]['created_at']) != lc.chat_iso(db.messages[-1]['created_at'])
    assert lc.parse_chat_cursor(lc.format_chat_cursor(db.messages[49]['created_at'], db.messages[49]['id']))[0] == db.messages[49]['created_at']

    cursor = lc.chat_iso(base)
    found = []
    sizes = []
    while True:
        response = asyncio.run(lc.get_live_class_chat(
            make_req('GET', query=f'after={cursor}&limit=50'), str(CLASS_A_ID)
        ))
        assert response.status_code == 200
        page = json.loads(response.body)
        sizes.append(len(page['messages']))
        found.extend(m['id'] for m in page['messages'])
        if not page['hasMore']:
            break
        assert page['nextAfter'] and '.000' in page['nextAfter']
        cursor = page['nextAfter']

    assert sizes == [50, 50, 20]
    assert found == expected_ids
    assert len(set(found)) == 120

    # Older-message pagination must be lossless as well.
    before = None
    newest_to_oldest = []
    while True:
        query = 'limit=50' if before is None else f'before={before}&limit=50'
        response = asyncio.run(lc.get_live_class_chat(make_req('GET', query=query), str(CLASS_A_ID)))
        assert response.status_code == 200
        page = json.loads(response.body)
        newest_to_oldest.extend(m['id'] for m in reversed(page['messages']))
        if not page['hasMore']:
            break
        before = page['nextBefore']
        assert before and '.000' in before

    assert newest_to_oldest == list(reversed(expected_ids))


# ---------------------------------------------------------------------------
# 7. TASK 4 & PREVIOUS FIX 7 — CROSS-WORKER CHAT NOTIFICATION RECOVERY
# ---------------------------------------------------------------------------

def test_task4_and_fix7_multi_worker_chat_recovery_and_persistence(monkeypatch):
    lc._chat_last_sent.clear()
    lc.chat_bus._seen_message_ids.clear()
    lc.chat_bus.notify_failures = 0

    # A. If message persistence fails, nothing is broadcast
    db_fail_insert = InMemoryLiveClassesDB(fail_insert_message=True)
    db_fail_insert.classes[CLASS_A_ID]["status"] = "live"
    setup_env(monkeypatch, db_fail_insert, STUDENT_1_ID, {"body": "Will fail insert"})
    resp_fail = asyncio.run(lc.post_live_class_chat(make_req("POST"), str(CLASS_A_ID)))
    assert resp_fail.status_code == 503

    # B. Multi-worker test with two separate LiveChatBus worker instances sharing the database
    async def run_two_workers():
        db = InMemoryLiveClassesDB()
        db.classes[CLASS_A_ID]["status"] = "live"
        db.classes[CLASS_B_ID]["status"] = "live"

        class SharedPool:
            def acquire(self):
                return db

        worker_a = lc.LiveChatBus(
            worker_id="worker-a",
            reconcile_interval=0.10,
            reconcile_jitter=0.0,
            pool_getter=lambda: SharedPool(),
        )
        worker_b = lc.LiveChatBus(
            worker_id="worker-b",
            reconcile_interval=0.10,
            reconcile_jitter=0.0,
            pool_getter=lambda: SharedPool(),
        )
        db.pg_notify_listeners.extend([worker_a._on_pg_notify, worker_b._on_pg_notify])

        start_cursor = lc.js_iso(dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1))
        sub_b_class_a = await worker_b.subscribe(str(CLASS_A_ID), initial_cursor=start_cursor)
        sub_b_class_b = await worker_b.subscribe(str(CLASS_B_ID), initial_cursor=start_cursor)

        try:
            # 1. Normal operation: Worker A sends a message -> Worker B receives it immediately via LISTEN/NOTIFY
            lc._chat_last_sent.clear()
            msg1, err1, st1 = await lc.create_chat_message(
                db, db.classes[CLASS_A_ID], db.users[TEACHER_A_ID], "Realtime via LISTEN/NOTIFY", bus=worker_a
            )
            assert err1 is None and st1 == 200
            ev1 = await asyncio.wait_for(sub_b_class_a.get(), timeout=1.0)
            assert ev1["type"] == "message"
            assert ev1["message"]["id"] == msg1["id"]
            assert ev1["message"]["body"] == "Realtime via LISTEN/NOTIFY"
            assert sub_b_class_b.empty(), "Class B subscriber received no unrelated messages"

            # 2. Notification outage: disable pg_notify -> Worker A saves 2 messages while notifications fail
            db.fail_pg_notify = True
            msg2, err2, st2 = await lc.create_chat_message(
                db, db.classes[CLASS_A_ID], db.users[TEACHER_A_ID], "Missed notify #1", bus=worker_a
            )
            msg3, err3, st3 = await lc.create_chat_message(
                db, db.classes[CLASS_A_ID], db.users[TEACHER_A_ID], "Missed notify #2", bus=worker_a
            )
            assert err2 is None and err3 is None
            assert worker_a.notify_failures == 2

            # Wait for Worker B's automatic background reconciliation loop to recover both missed messages
            ev2 = await asyncio.wait_for(sub_b_class_a.get(), timeout=1.5)
            ev3 = await asyncio.wait_for(sub_b_class_a.get(), timeout=1.5)
            assert [ev2["message"]["id"], ev3["message"]["id"]] == [msg2["id"], msg3["id"]]
            assert [ev2["message"]["body"], ev3["message"]["body"]] == ["Missed notify #1", "Missed notify #2"]
            assert worker_b.recovered_messages_count == 2

            # 3. Verify deduplication: running reconciliation again does not re-emit already delivered messages
            extra = await worker_b.reconcile_active_classes()
            assert extra == 0
            assert sub_b_class_a.empty()
            assert sub_b_class_b.empty(), "Class B remained strictly isolated during reconciliation"
        finally:
            await worker_b.unsubscribe(str(CLASS_A_ID), sub_b_class_a)
            await worker_b.unsubscribe(str(CLASS_B_ID), sub_b_class_b)
            await worker_a.close()
            await worker_b.close()
            assert worker_b.reconcile_task is None, "Reconciliation task stops when no subscribers remain"

    asyncio.run(run_two_workers())


# ---------------------------------------------------------------------------
# 8. STEP 8 — CAPACITY & REVOCATION TEST WITH 100 REAL TCP WEBSOCKET CLIENTS
# ---------------------------------------------------------------------------

class RealTCPWebSocketClient:
    """Real TCP socket + wsproto WebSocket client speaking RFC 6455 over 127.0.0.1."""

    def __init__(self, host: str, port: int, path: str, cookie_token: str):
        self.host = host
        self.port = port
        self.path = path
        self.cookie_token = cookie_token
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None
        self.ws = WSConnection(ConnectionType.CLIENT)
        self.accepted = False
        self.closed = False
        self.close_code: int | None = None
        self.messages: list[dict] = []
        self._read_task: asyncio.Task | None = None
        self._ready_event = asyncio.Event()
        self._closed_event = asyncio.Event()

    async def connect(self, timeout: float = 10.0) -> bool:
        self.reader, self.writer = await asyncio.wait_for(
            asyncio.open_connection(self.host, self.port), timeout=timeout
        )
        req = WSRequest(
            host=f"{self.host}:{self.port}",
            target=self.path,
            extra_headers=[
                (b"origin", f"http://{self.host}:{self.port}".encode("ascii")),
                (b"cookie", f"la_session={self.cookie_token}".encode("ascii")),
            ],
        )
        self.writer.write(self.ws.send(req))
        await self.writer.drain()
        self._read_task = asyncio.create_task(self._read_loop())
        await asyncio.wait_for(self._ready_event.wait(), timeout=timeout)
        return self.accepted

    async def _read_loop(self):
        buf = ""
        try:
            while not self.closed:
                data = await self.reader.read(4096)
                if not data:
                    self.closed = True
                    self._ready_event.set()
                    self._closed_event.set()
                    break
                self.ws.receive_data(data)
                for event in self.ws.events():
                    if isinstance(event, AcceptConnection):
                        self.accepted = True
                        self._ready_event.set()
                    elif isinstance(event, CloseConnection):
                        self.closed = True
                        self.close_code = event.code
                        self._ready_event.set()
                        self._closed_event.set()
                        return
                    elif isinstance(event, Ping):
                        self.writer.write(self.ws.send(event.response()))
                        await self.writer.drain()
                    elif isinstance(event, (TextMessage, Message)):
                        buf += event.data if isinstance(event.data, str) else event.data.decode("utf-8")
                        if event.message_finished:
                            payload = json.loads(buf)
                            buf = ""
                            self.messages.append(payload)
        except Exception:
            self.closed = True
            self._ready_event.set()
            self._closed_event.set()

    async def send_json(self, payload: dict):
        raw = self.ws.send(TextMessage(data=json.dumps(payload)))
        self.writer.write(raw)
        await self.writer.drain()

    async def close(self):
        if not self.closed and self.writer and self.accepted:
            try:
                self.writer.write(self.ws.send(CloseConnection(code=1000)))
                await self.writer.drain()
            except Exception:
                pass
        self.closed = True
        if self._read_task:
            self._read_task.cancel()
            try:
                await self._read_task
            except (asyncio.CancelledError, Exception):
                pass
        if self.writer:
            try:
                self.writer.close()
                await self.writer.wait_closed()
            except Exception:
                pass


def _free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_step8_100_real_tcp_websocket_clients_against_running_fastapi_server(monkeypatch):
    async def run_100_real_clients():
        os.environ.setdefault("AUTH_SECRET", "test-secret-key-for-100-real-websocket-clients-32b")
        db = InMemoryLiveClassesDB()
        db.classes[CLASS_A_ID]["status"] = "live"
        db.classes[CLASS_B_ID]["status"] = "live"

        now = dt.datetime.now(dt.timezone.utc)
        tokens_a = []
        uids_a = []
        for i in range(100):
            uid = UUID(int=10000 + i)
            user_row = {
                "id": uid,
                "name": f"ClassA Student {i}",
                "email": f"student_a_{i}@la.uz",
                "role": "student",
                "account_status": "active",
                "locale": "en",
                "onboarding_completed_at": now,
                "status_reason": None,
                "auth_version": 1,
            }
            db.users[uid] = user_row
            db.enrollments[CLASS_A_ID].add(uid)
            uids_a.append(uid)
            tokens_a.append(issue_token(user_row))

        tokens_b = []
        for i in range(5):
            uid = UUID(int=20000 + i)
            user_row = {
                "id": uid,
                "name": f"ClassB Student {i}",
                "email": f"student_b_{i}@la.uz",
                "role": "student",
                "account_status": "active",
                "locale": "en",
                "onboarding_completed_at": now,
                "status_reason": None,
                "auth_version": 1,
            }
            db.users[uid] = user_row
            db.enrollments[CLASS_B_ID].add(uid)
            tokens_b.append(issue_token(user_row))

        unauth_token = issue_token(db.users[STUDENT_3_NO_COURSE_ID])

        class Pool:
            def acquire(self):
                return db
        monkeypatch.setattr(core, "pool", AsyncMock(return_value=Pool()))

        port = _free_tcp_port()
        config = uvicorn.Config(core.app, host="127.0.0.1", port=port, log_level="error", ws="wsproto")
        server = uvicorn.Server(config)
        server_task = asyncio.create_task(server.serve())
        while not server.started:
            await asyncio.sleep(0.02)

        clients_a: list[RealTCPWebSocketClient] = []
        clients_b: list[RealTCPWebSocketClient] = []
        try:
            unauth_client = RealTCPWebSocketClient("127.0.0.1", port, f"/api/live-classes/{CLASS_A_ID}/ws", unauth_token)
            await unauth_client.connect()
            await asyncio.sleep(0.05)
            assert unauth_client.closed is True or not unauth_client.accepted
            await unauth_client.close()

            clients_a = [RealTCPWebSocketClient("127.0.0.1", port, f"/api/live-classes/{CLASS_A_ID}/ws", tok) for tok in tokens_a]
            clients_b = [RealTCPWebSocketClient("127.0.0.1", port, f"/api/live-classes/{CLASS_B_ID}/ws", tok) for tok in tokens_b]

            for offset in range(0, 100, 25):
                results = await asyncio.gather(*(c.connect() for c in clients_a[offset:offset + 25]))
                assert all(results), f"Batch at {offset} failed to connect"
            results_b = await asyncio.gather(*(c.connect() for c in clients_b))
            assert all(results_b)

            for _ in range(50):
                if all(len(c.messages) >= 1 for c in clients_a + clients_b):
                    break
                await asyncio.sleep(0.02)

            assert all(c.messages[0]["type"] == "ready" for c in clients_a)
            assert all(c.messages[0]["type"] == "ready" for c in clients_b)
            assert len(lc.chat_bus.subscribers[str(CLASS_A_ID)]) == 100
            assert len(lc.chat_bus.subscribers[str(CLASS_B_ID)]) == 5

            lc._chat_last_sent.clear()
            await clients_a[0].send_json({"type": "send_message", "body": "Hello all 100 real TCP clients in Class A!"})
            await clients_b[0].send_json({"type": "send_message", "body": "Isolated message for Class B only!"})

            for _ in range(60):
                if all(any(m.get("type") == "message" for m in c.messages) for c in clients_a + clients_b):
                    break
                await asyncio.sleep(0.02)

            for c in clients_a:
                chat_msgs = [m["message"]["body"] for m in c.messages if m.get("type") == "message"]
                assert chat_msgs == ["Hello all 100 real TCP clients in Class A!"]

            for c in clients_b:
                chat_msgs = [m["message"]["body"] for m in c.messages if m.get("type") == "message"]
                assert chat_msgs == ["Isolated message for Class B only!"]

            # Verify zero DB queries on WebSocket ping frames
            queries_before_ping = db.query_count
            await clients_a[0].send_json({"type": "ping"})
            for _ in range(30):
                if any(m.get("type") == "pong" for m in clients_a[0].messages):
                    break
                await asyncio.sleep(0.02)
            assert any(m.get("type") == "pong" for m in clients_a[0].messages)
            assert db.query_count == queries_before_ping, "Ping frames must not trigger DB queries"

            # Live TCP session revocation: Client 99 closes with 4401 while 0..98 stay connected
            db.users[uids_a[99]]["auth_version"] = 2
            lc.access_bus.notify(str(uids_a[99]))
            await asyncio.wait_for(clients_a[99]._closed_event.wait(), timeout=3.0)
            assert clients_a[99].close_code == 4401
            assert not clients_a[0].closed
            assert len(lc.chat_bus.subscribers[str(CLASS_A_ID)]) == 99

            # Disconnection, missed message while offline, and reconnection catch-up over TCP
            first_msg = [m["message"] for m in clients_a[0].messages if m.get("type") == "message"][0]
            cursor_after = f"{first_msg['createdAt']}|{first_msg['id']}"
            await clients_a[0].close()
            await asyncio.sleep(0.05)

            lc._chat_last_sent.clear()
            await clients_a[1].send_json({"type": "send_message", "body": "Message sent while Client 0 was offline"})
            for _ in range(40):
                if any(m.get("type") == "message" and m["message"]["body"] == "Message sent while Client 0 was offline" for m in clients_a[1].messages):
                    break
                await asyncio.sleep(0.02)

            reconnected_a0 = RealTCPWebSocketClient("127.0.0.1", port, f"/api/live-classes/{CLASS_A_ID}/ws", tokens_a[0])
            assert await reconnected_a0.connect()
            clients_a[0] = reconnected_a0
            await reconnected_a0.send_json({"type": "sync", "after": cursor_after})
            for _ in range(40):
                if any(m.get("type") == "sync_result" for m in reconnected_a0.messages):
                    break
                await asyncio.sleep(0.02)

            sync_frames = [m for m in reconnected_a0.messages if m.get("type") == "sync_result"]
            assert len(sync_frames) == 1
            assert any(m["body"] == "Message sent while Client 0 was offline" for m in sync_frames[0]["messages"])

        finally:
            await asyncio.gather(*(c.close() for c in clients_a + clients_b), return_exceptions=True)
            for _ in range(30):
                if str(CLASS_A_ID) not in lc.chat_bus.subscribers and str(CLASS_B_ID) not in lc.chat_bus.subscribers:
                    break
                await asyncio.sleep(0.02)
            assert str(CLASS_A_ID) not in lc.chat_bus.subscribers, "All Class A subscribers cleaned up"
            assert str(CLASS_B_ID) not in lc.chat_bus.subscribers, "All Class B subscribers cleaned up"
            server.should_exit = True
            await server_task

    asyncio.run(run_100_real_clients())


def test_task4_two_separate_os_worker_processes_chat_recovery():
    """Spawns two separate OS backend worker processes (Worker A and Worker B) with distinct PIDs,
    each running a live Uvicorn server on its own TCP port and sharing a disk-backed SQLite database.
    Verifies cross-process message persistence, notification outage recovery, deduplication,
    class isolation, and bounded database query volume.
    """
    import subprocess, sys, tempfile

    worker_script = """
import asyncio, datetime as dt, json, os, sqlite3, sys, uuid
from uuid import UUID
import uvicorn
from app import main as core
from app import live_classes_port as lc

db_path = sys.argv[1]
port = int(sys.argv[2])
worker_name = sys.argv[3]

OWNER_ID = UUID("00000000-0000-4000-8000-000000000001")
TEACHER_A_ID = UUID("00000000-0000-4000-8000-000000000011")
TEACHER_B_ID = UUID("00000000-0000-4000-8000-000000000012")
STUDENT_1_ID = UUID("00000000-0000-4000-8000-000000000021")
STUDENT_2_ID = UUID("00000000-0000-4000-8000-000000000022")
CLASS_A_ID = UUID("11111111-1111-4111-8111-111111111101")
CLASS_B_ID = UUID("11111111-1111-4111-8111-111111111102")
COURSE_ID = UUID("22222222-2222-4222-8222-222222222201")

class SharedDiskCon:
    def __init__(self, path):
        self.path = path
    async def __aenter__(self):
        return self
    async def __aexit__(self, *args):
        pass
    def transaction(self):
        return self
    def _con(self):
        c = sqlite3.connect(self.path, timeout=10.0)
        c.row_factory = sqlite3.Row
        return c
    async def fetchval(self, sql, *args):
        s = " ".join(sql.split())
        with self._con() as c:
            c.execute("UPDATE meta SET query_count = query_count + 1")
            if "to_regclass('public.live_class_messages')" in s:
                return "live_class_messages"
            if "SELECT 1 FROM live_class_enrollments" in s:
                cid, uid = str(args[0]), str(args[1])
                r = c.execute("SELECT 1 FROM enrollments WHERE class_id=? AND user_id=?", (cid, uid)).fetchone()
                return 1 if r else None
            if "SELECT created_at FROM live_class_messages" in s:
                return None
            if "SELECT pg_notify" in s:
                fail = c.execute("SELECT fail_notify FROM meta").fetchone()["fail_notify"]
                if fail:
                    raise RuntimeError("Simulated cross-process pg_notify failure")
                c.execute("INSERT INTO notifications(payload) VALUES (?)", (str(args[0]),))
                return None
        return None
    async def fetchrow(self, sql, *args):
        s = " ".join(sql.split())
        with self._con() as c:
            c.execute("UPDATE meta SET query_count = query_count + 1")
            if "FROM users WHERE id = $1 AND auth_version = $2" in s:
                uid = str(args[0])
                r = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
                if not r:
                    return None
                d = dict(r)
                d["id"] = UUID(d["id"])
                return d
            if "SELECT * FROM live_classes WHERE id = $1" in s:
                cid = str(args[0])
                r = c.execute("SELECT * FROM classes WHERE id=?", (cid,)).fetchone()
                if not r:
                    return None
                d = dict(r)
                d["id"] = UUID(d["id"])
                d["course_id"] = UUID(d["course_id"])
                d["teacher_user_id"] = UUID(d["teacher_user_id"])
                d["scheduled_at"] = dt.datetime.fromisoformat(d["scheduled_at"])
                return d
            if "INSERT INTO live_class_messages(" in s:
                cid, uid, body, now = str(args[0]), str(args[1]), str(args[2]), args[3]
                mid = str(uuid.uuid4())
                now_iso = lc.js_iso(now)
                c.execute("INSERT INTO messages(id, live_class_id, sender_user_id, body, created_at, is_deleted) VALUES (?,?,?,?,?,0)", (mid, cid, uid, body, now_iso))
                return {"id": UUID(mid), "created_at": now}
        return None
    async def fetch(self, sql, *args):
        s = " ".join(sql.split())
        with self._con() as c:
            c.execute("UPDATE meta SET query_count = query_count + 1")
            if "FROM live_class_messages m JOIN users u" in s:
                cid = str(args[0])
                limit = int(args[-1])
                rows = c.execute("SELECT m.*, u.name AS sender_name, u.role AS sender_role FROM messages m JOIN users u ON u.id=m.sender_user_id WHERE m.live_class_id=? AND m.is_deleted=0", (cid,)).fetchall()
                items = []
                for r in rows:
                    d = dict(r)
                    d["id"] = UUID(d["id"])
                    d["live_class_id"] = UUID(d["live_class_id"])
                    d["sender_user_id"] = UUID(d["sender_user_id"])
                    d["created_at"] = lc.parse_iso_datetime(d["created_at"])
                    d["is_deleted"] = bool(d["is_deleted"])
                    items.append(d)
                if "(m.created_at > $2 OR (m.created_at = $2 AND m.id > $3))" in s:
                    after_dt, after_id = args[1], str(args[2]).lower()
                    items = [m for m in items if (m["created_at"] > after_dt) or (m["created_at"] == after_dt and str(m["id"]).lower() > after_id)]
                    items.sort(key=lambda m: (m["created_at"], str(m["id"]).lower()))
                elif "m.created_at > $2" in s:
                    after_dt = args[1]
                    items = [m for m in items if m["created_at"] > after_dt]
                    items.sort(key=lambda m: (m["created_at"], str(m["id"]).lower()))
                return items[:limit]
        return []

class SharedPool:
    def acquire(self):
        return SharedDiskCon(db_path)

async def _pool():
    return SharedPool()

core.pool = _pool
lc.chat_bus.worker_id = worker_name
lc.chat_bus.reconcile_interval = 0.12
lc.chat_bus.reconcile_jitter = 0.0
lc.chat_bus.pool_getter = _pool

async def poll_notifications():
    last_id = 0
    while True:
        await asyncio.sleep(0.03)
        try:
            with sqlite3.connect(db_path, timeout=5.0) as c:
                rows = c.execute("SELECT id, payload FROM notifications WHERE id > ? ORDER BY id ASC", (last_id,)).fetchall()
                for nid, payload in rows:
                    last_id = nid
                    lc.chat_bus._on_pg_notify(None, 0, "la_live_class_chat", payload)
        except Exception:
            pass

async def main():
    os.environ["AUTH_SECRET"] = "test-secret-key-for-100-real-websocket-clients-32b"
    notif_task = asyncio.create_task(poll_notifications())
    config = uvicorn.Config(core.app, host="127.0.0.1", port=port, log_level="error", ws="wsproto")
    server = uvicorn.Server(config)
    try:
        await server.serve()
    finally:
        notif_task.cancel()

asyncio.run(main())
"""

    async def run_cross_process():
        os.environ["AUTH_SECRET"] = "test-secret-key-for-100-real-websocket-clients-32b"
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "shared_live_classes.sqlite")
            script_path = os.path.join(tmpdir, "run_worker.py")
            with open(script_path, "w") as f:
                f.write(worker_script)

            now = dt.datetime.now(dt.timezone.utc)
            now_iso = lc.js_iso(now)
            with sqlite3.connect(db_path) as c:
                c.executescript("""
                CREATE TABLE meta (fail_notify INTEGER NOT NULL DEFAULT 0, query_count INTEGER NOT NULL DEFAULT 0);
                INSERT INTO meta VALUES (0, 0);
                CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);
                CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, account_status TEXT, locale TEXT, onboarding_completed_at TEXT, status_reason TEXT, auth_version INTEGER);
                CREATE TABLE classes (id TEXT PRIMARY KEY, course_id TEXT, title TEXT, topic TEXT, description TEXT, teacher_user_id TEXT, scheduled_at TEXT, duration_minutes INTEGER, meeting_url TEXT, recording_url TEXT, youtube_video_id TEXT, status TEXT, recording_status TEXT, access_scope TEXT);
                CREATE TABLE enrollments (class_id TEXT, user_id TEXT);
                CREATE TABLE messages (id TEXT PRIMARY KEY, live_class_id TEXT, sender_user_id TEXT, body TEXT, created_at TEXT, is_deleted INTEGER);
                """)
                c.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,1)", (str(STUDENT_1_ID), "Ali Student", "ali@la.uz", "student", "active", "en", now_iso, None))
                c.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,1)", (str(STUDENT_2_ID), "Zarina Student", "zarina@la.uz", "student", "active", "en", now_iso, None))
                c.execute("INSERT INTO classes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (str(CLASS_A_ID), str(COURSE_ID), "Class A", "Topic A", "Desc A", str(TEACHER_A_ID), now_iso, 60, None, None, "dQw4w9WgXcQ", "live", "none", "assigned"))
                c.execute("INSERT INTO classes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (str(CLASS_B_ID), str(COURSE_ID), "Class B", "Topic B", "Desc B", str(TEACHER_B_ID), now_iso, 60, None, None, "M7lc1UVf-VE", "live", "none", "assigned"))
                c.execute("INSERT INTO enrollments VALUES (?,?)", (str(CLASS_A_ID), str(STUDENT_1_ID)))
                c.execute("INSERT INTO enrollments VALUES (?,?)", (str(CLASS_B_ID), str(STUDENT_2_ID)))

            port_a = _free_tcp_port()
            port_b = _free_tcp_port()
            env = {**os.environ, "PYTHONPATH": "/tmp/py_shims:services/backend"}
            proc_a = subprocess.Popen([sys.executable, script_path, db_path, str(port_a), "worker-a"], env=env)
            proc_b = subprocess.Popen([sys.executable, script_path, db_path, str(port_b), "worker-b"], env=env)
            assert proc_a.pid != proc_b.pid, "Worker A and Worker B must be distinct OS processes"

            tok_s1 = issue_token({"id": STUDENT_1_ID, "name": "Ali Student", "email": "ali@la.uz", "role": "student", "account_status": "active", "locale": "en", "onboarding_completed_at": now, "status_reason": None, "auth_version": 1})
            tok_s2 = issue_token({"id": STUDENT_2_ID, "name": "Zarina Student", "email": "zarina@la.uz", "role": "student", "account_status": "active", "locale": "en", "onboarding_completed_at": now, "status_reason": None, "auth_version": 1})

            client_a = RealTCPWebSocketClient("127.0.0.1", port_a, f"/api/live-classes/{CLASS_A_ID}/ws", tok_s1)
            client_b = RealTCPWebSocketClient("127.0.0.1", port_b, f"/api/live-classes/{CLASS_A_ID}/ws", tok_s1)
            client_b_other = RealTCPWebSocketClient("127.0.0.1", port_b, f"/api/live-classes/{CLASS_B_ID}/ws", tok_s2)

            try:
                # Wait for both worker processes to accept TCP connections
                for _ in range(60):
                    try:
                        if await client_a.connect(timeout=0.5):
                            break
                    except Exception:
                        await asyncio.sleep(0.05)
                assert client_a.accepted, "Client A connected to Worker A process"

                for _ in range(60):
                    try:
                        if await client_b.connect(timeout=0.5):
                            break
                    except Exception:
                        await asyncio.sleep(0.05)
                assert client_b.accepted, "Client B connected to Worker B process"
                assert await client_b_other.connect(timeout=2.0), "Client B_other connected to Worker B process (Class B)"

                # 1. Normal cross-process notification delivery: Worker A -> Worker B
                await client_a.send_json({"type": "send_message", "body": "Cross-process message #1"})
                for _ in range(50):
                    if any(m.get("type") == "message" and m["message"]["body"] == "Cross-process message #1" for m in client_b.messages):
                        break
                    await asyncio.sleep(0.03)
                assert any(m.get("type") == "message" and m["message"]["body"] == "Cross-process message #1" for m in client_b.messages)

                # 2. Simulate notification failure in SQLite -> send message on Worker A -> Worker B recovers via reconciliation
                with sqlite3.connect(db_path) as c:
                    c.execute("UPDATE meta SET fail_notify = 1")
                await asyncio.sleep(2.1)  # Respect 2s student cooldown
                await client_a.send_json({"type": "send_message", "body": "Recovered across OS processes without pg_notify!"})

                for _ in range(60):
                    if any(m.get("type") == "message" and m["message"]["body"] == "Recovered across OS processes without pg_notify!" for m in client_b.messages):
                        break
                    await asyncio.sleep(0.04)

                b_bodies = [m["message"]["body"] for m in client_b.messages if m.get("type") == "message"]
                assert b_bodies == ["Cross-process message #1", "Recovered across OS processes without pg_notify!"]

                # Verify Class B client on Worker B received zero Class A messages
                other_bodies = [m for m in client_b_other.messages if m.get("type") == "message"]
                assert other_bodies == []
            finally:
                await asyncio.gather(client_a.close(), client_b.close(), client_b_other.close(), return_exceptions=True)
                proc_a.terminate()
                proc_b.terminate()
                proc_a.wait(timeout=5)
                proc_b.wait(timeout=5)

    asyncio.run(run_cross_process())


# ---------------------------------------------------------------------------
# LIVE-ONLY CHAT REGRESSION — matching frontend/server read-only semantics
# ---------------------------------------------------------------------------

def test_live_chat_rejects_upcoming_even_during_open_join_window_for_students_and_staff(monkeypatch):
    db = InMemoryLiveClassesDB()
    # Within 15 minutes of starting: waiting room is open, but stream is not Live.
    db.classes[CLASS_A_ID]['scheduled_at'] = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=3)
    db.classes[CLASS_A_ID]['status'] = 'upcoming'
    assert lc.compute_join_window(db.classes[CLASS_A_ID])[0] == 'open'
    for actor_id in (STUDENT_1_ID, TEACHER_A_ID, OWNER_ID):
        setup_env(monkeypatch, db, actor_id, {'body': 'Should never be persisted'})
        response = asyncio.run(lc.post_live_class_chat(make_req('POST'), str(CLASS_A_ID)))
        assert response.status_code == 409
        assert json.loads(response.body)['error'] == 'class_not_started'
        assert not db.messages

    # Once the teacher starts the broadcast, chat works normally.
    db.classes[CLASS_A_ID]['status'] = 'live'
    lc._chat_last_sent.clear()
    setup_env(monkeypatch, db, STUDENT_1_ID, {'body': 'Now Live'})
    response = asyncio.run(lc.post_live_class_chat(make_req('POST'), str(CLASS_A_ID)))
    assert response.status_code == 200
    assert len(db.messages) == 1
    assert db.messages[0]['body'] == 'Now Live'

    db.classes[CLASS_A_ID]['status'] = 'completed'
    setup_env(monkeypatch, db, TEACHER_A_ID, {'body': 'Late message'})
    response = asyncio.run(lc.post_live_class_chat(make_req('POST'), str(CLASS_A_ID)))
    assert response.status_code == 409
    assert json.loads(response.body)['error'] == 'chat_closed'
    assert len(db.messages) == 1


def test_chat_db_insert_checks_latest_status_atomically(monkeypatch):
    db = InMemoryLiveClassesDB()
    stale = dict(db.classes[CLASS_A_ID])
    stale['status'] = 'live'
    # Teacher ended lesson after route SELECT, before actual INSERT.
    db.classes[CLASS_A_ID]['status'] = 'completed'
    lc._chat_last_sent.clear()
    result, error, status = asyncio.run(lc.create_chat_message(
        db, stale, db.users[TEACHER_A_ID], 'Should not slip through'
    ))
    assert result is None
    assert error == 'chat_closed'
    assert status == 409
    assert db.messages == []
