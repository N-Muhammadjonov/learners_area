"""No shadowed handlers or modified SQL migrations in the delivery archive."""
import hashlib,json,re
from pathlib import Path
from starlette.routing import Match
from app import main as core

ROOT=Path(__file__).resolve().parents[1]

def test_no_shadowed_route_handler():
    for route in core.app.routes:
        if not route.path.startswith('/api/'):continue
        url=re.sub(r'\{[^}]+\}','11111111-1111-4111-8111-111111111111',route.path)
        for method in route.methods:
            scope={'type':'http','method':method,'path':url,'root_path':'','app':core.app}
            first=next((r for r in core.app.routes if method in getattr(r,'methods',[]) and r.matches(scope)[0]==Match.FULL),None)
            assert first is route, f'{method} {route.path} shadowed by {first.path if first else None}'

def test_sql_migrations_unchanged_from_original_sha256():
    manifest=json.loads((ROOT/'MIGRATION_AUDIT_260.json').read_text())
    expected=manifest['sql_sha256_by_filename']
    actual={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'migrations').glob('*.sql')}
    assert len(actual)==74
    assert {name:actual[name] for name in expected}==expected
    assert set(actual)-set(expected)=={
        '0066_notification_event_idempotency.sql','0067_assignment_deadline_indexes.sql',
        '0068_writing_model_pattern_capacity.sql','0069_video_progress_playback_duration.sql',
        '0071_shared_abuse_limits.sql','0072_riwi_core_and_governance.sql',
        '0073_riwi_assessments_and_security_signals.sql',
        '0074_riwi_speaking_sessions_and_activity_indexes.sql'}

def test_port_status_no_duplicates():
    status=json.loads((ROOT/'PORT_STATUS.json').read_text())
    methods={(m,r.path) for r in core.app.routes if r.path.startswith('/api/') for m in r.methods}
    ported={(e['method'],e['path']) for e in status['endpoints'] if e['status'].startswith('ported_')}
    missing={(e['method'],e['path']) for e in status['endpoints'] if e['status']=='not_ported'}
    assert len(methods)==len(ported)==status['ported_methods']==status['total_methods']
    assert len(missing)==status['unported_methods']==0
    assert ported==methods and not ported&missing
    assert len(status['endpoints'])==status['total_methods']
