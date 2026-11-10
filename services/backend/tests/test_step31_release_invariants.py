"""Release invariants: legacy routes remain present; Live Classes routes add safely."""
import hashlib
import json
import re
from pathlib import Path

from starlette.routing import Match
from app import main as core
from app import live_classes_port as live

ROOT = Path(__file__).resolve().parents[1]


def test_no_shadowed_route_handler():
    for route in core.app.routes:
        if not route.path.startswith('/api/'):
            continue
        url = re.sub(r'\{[^}]+\}', '11111111-1111-4111-8111-111111111111', route.path)
        for method in (getattr(route, 'methods', None) or ()):
            scope = {'type': 'http', 'method': method, 'path': url, 'root_path': '', 'app': core.app}
            first = next(
                (r for r in core.app.routes
                 if method in (getattr(r, 'methods', None) or ())
                 and r.matches(scope)[0] == Match.FULL),
                None,
            )
            assert first is route, f'{method} {route.path} shadowed by {first.path if first else None}'


def test_sql_migrations_unchanged_from_original_sha256():
    manifest = json.loads((ROOT / 'MIGRATION_AUDIT_260.json').read_text())
    expected = manifest['sql_sha256_by_filename']
    actual = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in (ROOT / 'migrations').glob('*.sql')
    }
    assert set(expected) <= set(actual), 'A baseline SQL migration is missing'
    assert {name: actual[name] for name in expected} == expected, 'A baseline SQL migration changed'
    approved_additions = {
        '0066_notification_event_idempotency.sql',
        '0067_assignment_deadline_indexes.sql',
        '0068_writing_model_pattern_capacity.sql',
        '0069_video_progress_playback_duration.sql',
        '0071_shared_abuse_limits.sql',
        '0072_ai_provider_admission.sql',
        '0073_live_classes_youtube_chat_attendance.sql',
        '0075_riwi_core_and_governance.sql',
        '0076_riwi_assessments_and_security_signals.sql',
        '0077_riwi_speaking_sessions_and_activity_indexes.sql',
        '0078_riwi_server_only_tables.sql',
        '0079_riwi_canonical_task_metadata.sql',
        '0080_study_plan.sql',
        '0081_monthly_study_plan.sql',
    }
    assert set(actual) - set(expected) == approved_additions
    assert len(actual) == len(expected) + len(approved_additions)


def test_port_status_no_duplicates():
    status=json.loads((ROOT/'PORT_STATUS.json').read_text())
    methods={(m,r.path) for r in core.app.routes if r.path.startswith('/api/')
             for m in (getattr(r,'methods',None) or ())}
    ported={(e['method'],e['path']) for e in status['endpoints'] if e['status'].startswith('ported_')}
    missing={(e['method'],e['path']) for e in status['endpoints'] if e['status']=='not_ported'}
    assert len(ported)==status['ported_methods']==status['total_methods']
    assert len(missing)==status['unported_methods']==0
    assert ported <= methods and not ported&missing
    # New Live Classes routes extend the historic port inventory; do not
    # require equality with a frozen pre-feature count.
    live={(m,p) for m,p in methods if p.startswith('/api/live-classes/')
          or p == '/api/live-classes' or p.startswith('/api/teacher/live-classes/')}
    assert live, 'Live Classes routes were not installed'
