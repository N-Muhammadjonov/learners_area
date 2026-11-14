"""Exact current API contract plus the preserved historic port inventory."""
import json
from pathlib import Path


def assert_current_routes(app):
    root = Path(__file__).parent
    expected = json.loads((root / 'current-route-inventory.json').read_text())
    actual = [{'method': method, 'path': route.path, 'name': route.name}
              for route in app.routes if route.path.startswith('/api/')
              for method in getattr(route, 'methods', ())]
    keys = lambda rows: {(row['method'], row['path'], row['name']) for row in rows}
    assert len(actual) == len({(row['method'], row['path']) for row in actual})
    assert keys(actual) == keys(expected), sorted(keys(actual) ^ keys(expected))
    historic = json.loads((root.parent / 'PORT_STATUS.json').read_text())
    preserved = {(row['method'], row['path']) for row in historic['endpoints']}
    current = {(row['method'], row['path']) for row in actual}
    assert preserved <= current
    assert len(preserved) == historic['total_methods'] == historic['ported_methods']
    assert historic['unported_methods'] == 0
    return current
