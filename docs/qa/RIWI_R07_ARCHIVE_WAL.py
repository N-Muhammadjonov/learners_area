#!/usr/bin/env python3
"""Archive only the owned local R07 cluster's WAL, with fsync and no overwrite."""
from pathlib import Path
import os
import re
import sys

root, source, name = Path(sys.argv[1]).resolve(strict=True), Path(sys.argv[2]), sys.argv[3]
assert root.parent == Path('/tmp').resolve(strict=True) and re.fullmatch(r'riwi-r07-pitr-[A-Za-z0-9_]+', root.name)
assert re.fullmatch(r'[A-F0-9]{24}(?:\.[A-F0-9]{8}\.backup)?|[A-F0-9]{8}\.history', name)
assert not source.is_symlink()
source = source.resolve(strict=True)
assert source.is_file() and source.is_relative_to(root / 'source/pg_wal')
assert source.name == name
directory = root / 'wal'
assert directory.is_dir() and not directory.is_symlink()
target = directory / name
raw = source.read_bytes()
if target.exists():
    assert target.is_file() and not target.is_symlink() and target.read_bytes() == raw
    with target.open('rb') as saved:
        os.fsync(saved.fileno())
else:
    with target.open('xb') as saved:
        os.chmod(target, 0o600)
        saved.write(raw)
        saved.flush()
        os.fsync(saved.fileno())
fd = os.open(directory, os.O_RDONLY)
try:
    os.fsync(fd)
finally:
    os.close(fd)
