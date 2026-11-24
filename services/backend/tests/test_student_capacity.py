"""Exercise real PostgreSQL and application endpoints in the existing CI job."""
from pathlib import Path
import json
import os
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]


def test_student_capacity(capsys):
    if not os.getenv('CI'):
        pytest.skip('The isolated PostgreSQL service is provided by the backend CI job.')
    result = subprocess.run(
        [sys.executable, str(ROOT / 'tests/load_simulation.py')],
        cwd=ROOT, capture_output=True, text=True, timeout=80,
    )
    with capsys.disabled():
        print(result.stdout, end='')
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report['registered_students'] == 10_000
    assert report['active_student_journeys'] == 1_000
    assert report['concurrent_virtual_students'] >= 100
    assert not report['admission_retries'], report['admission_retries']
