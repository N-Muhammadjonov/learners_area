"""Bounded, read-only account packets generated from the authoritative ledger."""
from __future__ import annotations

import csv
from datetime import timezone
import hashlib
import io
import json
import re
import unicodedata
from uuid import UUID
import zipfile

from asyncpg import Connection

from . import tuition_ledger as ledger

MAX_ACCOUNTS = 20
MONEY_FIELDS = ('chargedMinor', 'creditedMinor', 'allocatedMinor', 'receivableMinor',
                'balanceDueMinor', 'collectedMinor', 'refundedMinor', 'advanceMinor', 'overdueMinor')
FIELDS = ('studentUserId', 'studentName', 'currency', *MONEY_FIELDS, 'asOf')


def parse_students(value: str) -> list[UUID]:
    parts = value.split(',')
    if not 1 <= len(parts) <= MAX_ACCOUNTS:
        raise ValueError('invalid_account_selection')
    try:
        students = [UUID(part) for part in parts]
    except (ValueError, TypeError) as exc:
        raise ValueError('invalid_account_selection') from exc
    if len(set(students)) != len(students):
        raise ValueError('invalid_account_selection')
    return sorted(students, key=str)


def csv_bytes(rows: list[dict]) -> bytes:
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(FIELDS)
    # Only text is escaped. Negative numeric balances remain actual numbers.
    def cell(value):
        return "'" + value if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')) else value
    writer.writerows([cell(row[field]) for field in FIELDS] for row in rows)
    return output.getvalue().encode('utf-8-sig')


async def read_accounts(conn: Connection, students: list[UUID]) -> list[dict]:
    """Caller owns a repeatable-read, read-only transaction for the whole packet."""
    if not 1 <= len(students) <= MAX_ACCOUNTS or len(set(students)) != len(students):
        raise ValueError('invalid_account_selection')
    users = await conn.fetch("SELECT id,name FROM users WHERE id=ANY($1::uuid[]) AND role='student'", students)
    names = {row['id']: row['name'] for row in users}
    if len(names) != len(students):
        raise LookupError('student_not_found')
    stamp = (await conn.fetchval('SELECT transaction_timestamp()')).astimezone(timezone.utc).isoformat()
    result = []
    for student in students:
        position = await ledger.student_position(conn, student)
        result.append({**position, 'studentName': names[student], 'asOf': stamp})
    return result


def build_packet(rows: list[dict]) -> tuple[bytes, str]:
    if not rows or len(rows) > MAX_ACCOUNTS:
        raise ValueError('invalid_account_selection')
    def filename(row: dict) -> str:
        name = unicodedata.normalize('NFKC', row['studentName'] or '')
        label = re.sub(r'[^\w-]+', '-', name).strip('-_') or 'student'
        label = label.encode('utf-8')[:80].decode('utf-8', errors='ignore')
        return f'accounts/{label}-{UUID(row["studentUserId"])}.csv'
    files = {filename(row): csv_bytes([row]) for row in rows}
    files['accounts.csv'] = csv_bytes(rows)
    fingerprint = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    manifest = {'schemaVersion': 1, 'packetId': fingerprint, 'scope': 'current_ledger_positions',
                'observedAt': rows[0]['asOf'], 'accountCount': len(rows), 'currency': ledger.CURRENCY,
                'amountUnit': 'whole_UZS',
                'historicalOpeningBalanceIncluded': False, 'fiscalDocument': False,
                'totals': {field: sum(row[field] for row in rows) for field in MONEY_FIELDS},
                'files': [{'name': name, 'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)}
                          for name, content in sorted(files.items())]}
    files['manifest.json'] = json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2).encode()
    # Stable archive metadata makes repeated rendering of the same snapshot identical.
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as output:
        for name, content in sorted(files.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o600 << 16
            output.writestr(entry, content)
    return archive.getvalue(), 'account-balances-' + fingerprint[:16] + '.zip'
