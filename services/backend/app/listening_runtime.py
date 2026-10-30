"""Immutable browser assets compiled from the pinned main Listening adapters.

No Node process is needed to serve a course. The files contain browser HTML/JS,
not server-side application code. Their checksums prevent silent asset drift.
"""
import hashlib
import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'assets' / 'listening'


@lru_cache(maxsize=1)
def manifest():
    return json.loads((ROOT / 'manifest.json').read_text())


@lru_cache(maxsize=8)
def runtime(number: int):
    key = f'test-{number:02d}'
    expected = manifest()['entries'][key]
    data = (ROOT / (key + '.json')).read_bytes()
    if len(data) != expected['bytes'] or hashlib.sha256(data).hexdigest() != expected['runtimeSha256']:
        raise ValueError('listening_runtime_checksum')
    return json.loads(data)
