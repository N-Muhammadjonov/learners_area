#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
python3 - <<'PY'
import re
import subprocess

base = 'f57647f9e939336fe83ae1d379af0beff3ad47b6'
def git(*args):
    return subprocess.check_output(['git', *args], text=True)
paths = set(git('diff', '--name-only', '--no-renames', base, 'HEAD').splitlines())
paths.update(git('diff', '--name-only', '--no-renames', base).splitlines())
paths.update(git('ls-files', '--others', '--exclude-standard').splitlines())
errors = []
for path in sorted(paths):
    if 'reading' in path.lower():
        errors.append(path)
    elif path.startswith('frontend/vanilla/js/i18n/'):
        errors.append(path)
    elif ('/brand/' in path and not path.startswith('frontend/vanilla/brand/landing/')) or path.endswith('.css'):
        errors.append(path)
    elif path == 'frontend/vanilla/index.html':
        from pathlib import Path
        strip = lambda value: re.sub(r'<!--public-content-start-->.*?<!--public-content-end-->', '', value, flags=re.S)
        if strip(git('show', base + ':' + path)) != strip(Path(path).read_text()):
            errors.append(path + ' (outside public fallback)')
if errors:
    raise SystemExit('Scope violation:\n' + '\n'.join(errors))
print('Scope check passed (' + str(len(paths)) + ' paths)')
PY
