"""Compare Python HTTP method coverage against a local extracted Next.js source."""
from pathlib import Path
import json
import re
import sys
from app.main import app


def next_path(path: str) -> str:
    path = path.removeprefix('src/app/api/').removesuffix('/route.ts')
    path = re.sub(r'\[\.\.\.([^]]+)\]', r'{\1:path}', path)
    return '/api/' + re.sub(r'\[([^]]+)\]', r'{\1}', path)


def audit(original: Path) -> dict:
    source = original / 'src/app/api'
    declared = []
    implemented = {(method, r.path) for r in app.routes for method in (r.methods or ()) if r.path.startswith('/api/')}
    for route in sorted(source.rglob('route.ts')):
        relative = route.relative_to(original).as_posix()
        path = next_path(relative)
        src = route.read_text(encoding='utf-8')
        methods = sorted(set(re.findall(r'export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b', src)))
        for method in methods:
            declared.append({'method': method, 'path': path, 'source': relative,
                             'status': 'ported_code_no_db_integration_test' if (method, path) in implemented else 'not_ported'})
    covered = sum(x['status'] != 'not_ported' for x in declared)
    return {'total_route_files': len(list(source.rglob('route.ts'))),
            'total_methods': len(declared), 'ported_methods': covered,
            'unported_methods': len(declared) - covered, 'endpoints': declared}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python -m tools.inspect_api path/to/extracted-nextjs-backend')
        raise SystemExit(2)
    print(json.dumps(audit(Path(sys.argv[1])), ensure_ascii=False, indent=2))
