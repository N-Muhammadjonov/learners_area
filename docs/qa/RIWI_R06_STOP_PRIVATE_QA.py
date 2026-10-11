#!/usr/bin/env python3
"""Stop only R06's interrupted disposable PostgreSQL cluster in owner Terminal.

The command refuses a reused PID, different executable or data directory.
No database, file or production application is deleted.
"""
import json
from pathlib import Path
import subprocess

repo = Path(__file__).resolve().parents[2]
workspace = repo.parents[2]
pg_bin = workspace / 'work/native-postgres16/package/native/bin'
data = Path('/tmp/riwi-r06-native-full-z7w8wme7/round-2-2c54f8mo/data')
pid_file = data / 'postmaster.pid'
receipt = workspace / 'work/r06-current/cleanup-receipt.json'
expected = Path('/tmp').resolve() / 'riwi-r06-native-full-z7w8wme7/round-2-2c54f8mo/data'
assert data.resolve() == expected and data.name == 'data'
assert (pg_bin / 'pg_ctl').is_file() and (pg_bin / 'postgres').is_file()
if not pid_file.exists():
    result = {'status': 'NO_POSTMASTER_PID_FILE_NO_SIGNAL_SENT', 'data_directory': str(data)}
else:
    lines = pid_file.read_text().splitlines()
    assert len(lines) >= 2 and Path(lines[1]).resolve() == expected
    pid = int(lines[0]); assert pid > 1
    probe = subprocess.run(['/bin/ps', '-ww', '-p', str(pid), '-o', 'command='], text=True, capture_output=True, timeout=10)
    command = probe.stdout.strip()
    assert probe.returncode == 0 and str(pg_bin / 'postgres') in command and any(str(p) in command for p in [data, expected]), 'Refusing unverified or reused PID; inspect the private QA cluster manually.'
    stop = subprocess.run([str(pg_bin / 'pg_ctl'), '-D', str(data), '-w', '-t', '20', 'stop', '-m', 'fast'], timeout=30)
    assert stop.returncode == 0 and not pid_file.exists(), 'Private cluster shutdown was not confirmed.'
    result = {'status': 'PRIVATE_R06_CLUSTER_SHUTDOWN_CONFIRMED', 'data_directory': str(data), 'pid': pid, 'pg_ctl_exit': 0, 'postmaster_pid_file_removed': True}
receipt.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
