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
    }
    assert set(actual) - set(expected) == approved_additions
    assert len(actual) == len(expected) + len(approved_additions)


def test_port_status_no_duplicates():
    status = json.loads((ROOT / 'PORT_STATUS.json').read_text())
    methods = {
        (method, route.path)
        for route in core.app.routes
        if route.path.startswith('/api/')
        for method in (getattr(route, 'methods', None) or ())
    }
    ported = {
        (entry['method'], entry['path'])
        for entry in status['endpoints']
        if entry['status'].startswith('ported_')
    }
    missing = {
        (entry['method'], entry['path'])
        for entry in status['endpoints']
        if entry['status'] == 'not_ported'
    }
    assert len(ported) == status['ported_methods'] == status['total_methods']
    assert len(missing) == status['unported_methods'] == 0
    assert len(status['endpoints']) == status['total_methods']
    assert ported <= methods, 'A legacy API endpoint was lost'
    assert not (ported & missing)

    # The immutable HTTP parity inventory covers the original API; Live Classes
    # adds new verified endpoints rather than rewriting the inventory.
    live_http = {
        (method, route.path)
        for route in live.router.routes
        if route.path.startswith('/api/')
        for method in (getattr(route, 'methods', None) or ())
    }
    assert live_http, 'Live Classes API was not installed'
    assert not (live_http & ported), 'A Live Classes route shadowed a legacy API endpoint'
    assert methods - ported == live_http, 'Unexpected untracked API endpoints'
